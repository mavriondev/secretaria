# Tato na VPS

## Instalação atual

- Diretório de código: `/tato/app`.
- Frontend de produção: `/tato/app/artifacts/erp-voice-assistant/dist/public`.
- Endereço: `https://187.77.232.164/tato/`. HTTP redireciona para HTTPS.
- Serviço systemd: `tato`, executado pelo usuário de sistema `tato`, não por root.
- API: porta `5004`; acesso externo pela rota `/tato/api/` do Nginx.
- Banco PostgreSQL separado: `tato`. A instalação inicial copiou o banco deste projeto, sem modificar os outros bancos da VPS.
- Configuração de execução: `/tato/config/tato.env`, protegida por permissões de arquivo. Nunca incluir seu conteúdo em Git, relatórios ou chat.
- Backup da migração inicial: `/tato/backups/migration.dump`, restrito a root.

O Nginx usa um virtual host específico para o IP; os virtual hosts dos domínios existentes não foram editados. Não foi aberta a porta 5004 no firewall: a API é acessada pelo proxy HTTPS na porta 443.

## Limitações e cuidados

O IP tem certificado público válido da Let's Encrypt e o login foi confirmado em um navegador móvel de teste, sem ignorar erros de certificado. Cookies de sessão usam `Secure`, `HttpOnly` e `Path=/tato/`. O navegador reconhece contexto seguro e disponibiliza a API do microfone; isso não comprova que a integração de voz foi instalada ou configurada.

A API de texto usa `OPENAI_API_KEY`. Voz e transcrição usam `ELEVENLABS_API_KEY` quando disponível; sem essa chave, somente no Replit usam a conexão existente. A chave direta tem prioridade, sem fallback para outra conta em caso de erro. Não copie tokens internos do Replit para a VPS.

## ElevenLabs fora do Replit

Crie uma chave específica para a VPS na ElevenLabs, com acesso à síntese de voz (Text to Speech/Text to Dialogue) e **Speech to Text**. A emissão de token de uso único do Scribe precisa dessa última permissão; Voices Write e Models Read não são necessários. Se usar uma lista de IPs permitidos, inclua o IP de saída da VPS. Configure uma cota adequada na chave.

Forneça a chave somente pelo fluxo de Secrets, nunca pelo chat, argumentos de comandos, código ou Git. Na VPS, o administrador deve inserir `ELEVENLABS_API_KEY` no arquivo já existente `/tato/config/tato.env`, fora de `/tato/app`, preservando as demais variáveis. Não copie nem imprima o arquivo. Mantenha o diretório com acesso restrito e o arquivo como `root:root`, modo `0600`; o systemd lê `EnvironmentFile` antes de executar como `tato`. Nenhuma chave pode chegar ao frontend.

Com os Secrets `ELEVENLABS_API_KEY` e `VPS_SSH_PASSWORD` disponíveis ao processo, `python scripts/configure-vps-elevenlabs.py` instala somente essa variável por SSH no arquivo existente, de forma atômica, sem expor credenciais em argumentos ou saída. Preserva as demais configurações e recusa arquivos simbólicos. Não publica código, não reinicia o serviço e não altera o banco. O SSH aceita a primeira chave do host, mas recusa mudanças posteriores; confirme a identidade da VPS no provisionamento inicial.

Após a integração deste código na instalação, uma reinicialização do serviço carrega a configuração. Ausência da chave fora do Replit falha explicitamente; `invalid_api_key` (inclusive com HTTP 400) indica chave inválida, `missing_permissions` indica escopo insuficiente, HTTP 401 indica autorização, 403 indica permissões/IPs, 402 ou 429 indica limites, e demais falhas indicam indisponibilidade. As mensagens não incluem respostas do provedor ou credenciais.

### Uma rodada curta de confirmação

Os testes locais de transporte não consomem créditos. Para confirmar a conta real, execute **uma vez**, após configurar a chave, no diretório `artifacts/api-server`, com Node que suporte `--env-file`:

```sh
# Executar como administrador; não usar set -x nem imprimir o ambiente.
node --env-file=/tato/config/tato.env --import tsx src/scripts/check-elevenlabs.ts --confirm-paid
```

A rodada gera uma frase curta em PCM 24 kHz pelo modelo existente `eleven_v4_turbo` e envia o áudio em memória ao `scribe_v2_realtime` para confirmar a transcrição. Não grava áudio, token ou chave, não acessa ERP e não repete chamadas automaticamente. Se falhar, corrija a causa antes de autorizar outra tentativa; não use isso como monitor recorrente. Cancelamento e prazo máximo encerram as conexões.

Essa confirmação servidor→ElevenLabs não comprova captura pelo navegador. O requisito de HTTPS foi atendido nesta VPS; a integração de voz ainda deve ser verificada separadamente após sua atualização. A ausência de gravação no Tato não garante retenção zero no provedor; esta depende do plano/contrato ElevenLabs.

O agendador foi desativado nesta cópia (`CARGA_AGENDADOR=off`) para não duplicar cargas enquanto Replit e VPS coexistem. Escolha qual instalação executará as cargas antes de habilitá-lo.

As instalações Replit e VPS passam a ter bancos independentes. Alterações feitas em um deles não são sincronizadas automaticamente. A migração inicial não muda o banco original.

## Operação

### Certificado público para o IP, sem domínio

A opção de IP foi escolhida porque o usuário informou não ter domínio para esta instalação. Referência oficial: https://letsencrypt.org/2026/03/11/shorter-certs-certbot

- Certbot 5.8.0 instalado isoladamente em `/opt/tato-acme-client`, com wrapper root-owned `/usr/local/sbin/tato-certbot`. Não atualiza o Certbot 4.0.0 que renova os outros sites.
- Não coloque esse cliente sob uma pasta gravável pelo usuário da aplicação: ele é executado como root para renovar o certificado.
- Configuração/chaves TLS: `/etc/letsencrypt-tato`, restrita a root. Logs e estado também usam diretórios próprios.
- Certificado: `/etc/letsencrypt-tato/live/tato-ip/`, SAN contendo o IP e perfil `shortlived`. Chaves privadas nunca devem entrar em Git ou relatórios.
- Validação HTTP-01: `/tato/acme-webroot/.well-known/acme-challenge/`, publicada somente pela rota ACME da porta 80. Não desligue o Nginx para renovar.
- `tato-certificate-renew.timer` verifica renovação duas vezes ao dia. O perfil tem validade de aproximadamente seis dias; renovação automática é obrigatória.
- `tato-certificate-renew.service` recarrega o Nginx apenas depois de validar a configuração. A renovação simulada com o hook foi confirmada.
- O host TLS do IP é `default_server`: navegadores normalmente não enviam SNI para IP literal. Os sites por domínio continuam com seus certificados selecionados por SNI. Não adicione um listener exclusivo para o IP que retire esses domínios da seleção.
- Configuração Nginx anterior: `/tato/config/tato.nginx.before-https`. A configuração ativa é a versão HTTPS; **atualizações não devem substituí-la pelo modelo HTTP de bootstrap**.

Emissão inicial (somente após instalar o cliente e publicar a rota ACME):

```sh
tato-certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --webroot --webroot-path /tato/acme-webroot \
  --ip-address 187.77.232.164 --cert-name tato-ip \
  --config-dir /etc/letsencrypt-tato --work-dir /var/lib/letsencrypt-tato \
  --logs-dir /var/log/letsencrypt-tato
```

Depois da emissão, use `tato.https.nginx.conf`, valide `nginx -t` e recarregue. Não instale certificados de staging como se fossem certificados confiáveis.

```sh
systemctl status tato
systemctl restart tato
journalctl -u tato --since "10 minutes ago"
nginx -t
systemctl list-timers tato-certificate-renew.timer
journalctl -u tato-certificate-renew.service
```

Antes de atualizações, faça um backup do banco e preserve a configuração protegida. Não restaure o dump inicial sobre um banco com dados novos.

Para compilar o frontend no caminho correto:

```sh
PORT=5004 BASE_PATH=/tato/ NODE_ENV=production pnpm --filter @workspace/erp-voice-assistant run build
pnpm --filter @workspace/api-server run build
```

Se uma atualização exigir `db push`, restaure as views e os papéis de consulta logo depois com `db:access`, sem reseedar os dados do ERP.

Os modelos do navegador (ONNX/WASM) fazem parte do build; não remova esses arquivos de `assets/`.

## Instalação inicial reproduzível

`scripts/deploy-vps.py` instala código, cria um banco novo e copia o banco original. Consome credenciais somente por variáveis de ambiente. Recusa banco ou papel já existente e não deve ser usado como rotina de atualização.

Os modelos de systemd e Nginx estão neste diretório. Instale-os nos destinos respectivos, valide com `nginx -t` e só então inicie/recarregue os serviços.
