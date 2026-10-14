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

Controle de gasto (opcional, em `/tato/config/tato.env`): `ELEVENLABS_TTS_USD_PER_1K_CHARS` (padrão 0,15) e `ELEVENLABS_STT_USD_PER_HOUR` (padrão 0,40) são os preços estimados usados no livro-razão `custos_ia`; `RITMO_POR_MINUTO` (padrão 20) é o número de chamadas pagas por pessoa por minuto antes de a API responder 429. Os tetos diários (plataforma e padrão por empresa) são configurados pelo dono na tela Diagnóstico, não por variável.

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

## Ambiente oficial: a VPS

**Uma empresa real só é carregada em um ambiente: a VPS.** A VPS é a instalação oficial (cargas agendadas, endpoint de recebimento `/tato/api/ingestao`, dados reais). O Replit é só desenvolvimento e teste: nunca recebe dados de cliente real e mantém `CARGA_AGENDADOR=off` (variável de ambiente do projeto; conferida em 13/10/2026). Na VPS, `CARGA_AGENDADOR` também está `off` em `/tato/config/tato.env` até o dono decidir habilitar o agendador; o envio por REST (chave `tato_env_…`) não depende do agendador e já está ativo.

Onde o dono vê o recebimento: Plataforma → empresa → **Recebimento** (`CompanyRecebimento`): botão "Gerar chave de envio"/"Gerar nova chave" (a chave aparece uma única vez), prefixo e data da chave ativa, endereço de envio, "Revogar" e a lista "última recepção" por tabela (`espelho_controle` do banco da empresa). O job do cliente consulta `GET /api/ingestao/estado` e envia `POST /api/ingestao/tabelas/<TABELA>` (até 20.000 linhas ou 15 MB por lote; Nginx: `client_max_body_size 16m`, `proxy_read_timeout 360s`).

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

## Atualização segura da instalação existente

Use **`scripts/update-vps.py`**, executado localmente como root na VPS. Não use
`deploy-vps.py`: aquele programa é apenas para instalação inicial. A nova rotina
não faz SSH, não transfere Secrets do Replit, não envia alterações ao GitHub e
não cria, substitui ou reseeda bancos. Não execute uma ação de produção sem
autorização explícita do responsável.

### Preparação e requisitos

- Use um checkout Git **separado de `/tato/app`** com um commit revisado. A rotina
  exporta somente código/manifests desse commit, não arquivos locais modificados,
  `.env`, chaves, dumps, anexos ou metadados internos. O checkout não precisa de
  credenciais disponíveis ao atualizador; ele não busca nem envia commits.
- Node `/usr/bin/node` 20.6+ (o Node do sistema desta VPS, compartilhado com
  outros sites), LTS 22.12+ ou 24.x, e pnpm **10.26.1** precisam estar
  instalados. A rotina não atualiza Node, pnpm, PostgreSQL, Nginx ou systemd.
  `pg_dump` deve ter a mesma versão principal do PostgreSQL local.
- `/tato/config/tato.env` continua sendo o único arquivo de configuração:
  **root:root 0600**, sem link simbólico. A instalação inicial antiga usava 0640;
  ajuste apenas permissões, sem copiar, imprimir ou substituir seu conteúdo:
  ```sh
  chown root:root /tato/config /tato/config/tato.env
  chmod 0700 /tato/config
  chmod 0600 /tato/config/tato.env
  ```
- O banco configurado deve continuar sendo `tato`, usuário `tato`, PostgreSQL
  local porta 5432; a API deve continuar na porta 5004. Configuração diferente
  é recusada, não corrigida automaticamente. O serviço deve estar ativo antes
  de ativar/reverter, usar o usuário `tato` e o diretório documentado. O link
  `/tato/web/tato` também precisa continuar apontando para o frontend em
  `/tato/app`; configurações diferentes são recusadas antes da parada.
- Reserve espaço para o checkout, dependências, builds, versão anterior e dump.
  Não remova versões antigas nem backups durante uma atualização. A rotina
  não apaga automaticamente nenhum deles.
- O atualizador torna `/tato` e `/tato/releases` root:root 0755, para impedir que
  o processo `tato` altere o controle da atualização. `/tato/runtime` permanece
  inalterado e é o destino das escritas do serviço.

No checkout revisado, execute (substitua os valores exemplificativos):

```sh
python3 scripts/update-vps.py prepare \
  --source /caminho/checkout-revisado \
  --revision SHA_COMPLETO_DE_40_CARACTERES
```

`prepare` não para o serviço nem toca no banco. Instala com lockfile congelado e
compila API/frontend em `/tato/releases/<versao>`, como usuário `tato`, com
ambiente mínimo **sem Secrets de produção** e cache de build separado. Valida o
JavaScript, o prefixo `/tato/`, modelos ONNX/WASM e versões de Node/pnpm. Sela a
versão como código somente leitura e registra o SHA e as versões das ferramentas
em `/tato/state`. Um build que falha não pode ser ativado; sua pasta pode ser
inspecionada/removida manualmente, sem tocar em `/tato/app`.

O código de um commit e seus scripts de dependências precisam ser confiáveis:
isso não é um isolamento de código malicioso. A rotina omite a saída dos
subprocessos mesmo em falhas; nunca use `set -x`, despeje ambientes ou publique
logs/arquivos privados para diagnosticar problemas.

### Migração aditiva (quando a versão nova acrescenta colunas ou tabelas)

Mudanças de schema chegam como SQL **aditivo e idempotente** em
`lib/db/migracao-aditiva.sql` (só `ADD COLUMN IF NOT EXISTS` /
`CREATE TABLE IF NOT EXISTS`; `scripts/gerar-migracao-aditiva.py` gera o
arquivo a partir do schema). O `activate` aplica esse arquivo sozinho, depois
do backup e antes de ligar o serviço, com o papel `tato`. Se quiser aplicá-la
**antes** do `activate` (para conferir com calma), use a versão preparada e o
usuário da aplicação, pelo mesmo mecanismo que a rotina usa para as views:

```sh
systemd-run --quiet --wait --pipe --collect \
  --property=User=tato --property=Group=tato \
  --property=WorkingDirectory=/tato/releases/VERSAO_PREPARADA/artifacts/api-server \
  --property=EnvironmentFile=/tato/config/tato.env \
  --property=UMask=0077 --property=NoNewPrivileges=yes \
  /usr/bin/node --import tsx src/scripts/migracao-aditiva.ts
```

O código anterior continua funcionando com as colunas novas, por isso a
reversão de código (abaixo) não exige desfazer nada. Rodar duas vezes não
altera o banco.

### Tipos de conteúdo do Nginx

Depois de cada `activate` a rotina confere, pelo endereço público, o
`Content-Type` de todos os arquivos estáticos do build (`.mjs`, `.wasm`, `.js`,
`.css`, `.json`, imagens, `sw.js`) e falha de forma visível se algum vier
errado; `python3 scripts/update-vps.py smoke` roda a mesma conferência a
qualquer momento. A configuração necessária está em `docs/vps/NGINX.md`.

### Troca autorizada

Revise primeiro a compatibilidade do **schema atual com ambos os códigos**.
Não há `db push` automático nem `--force`. Se houver mudança incompatível,
**não confirme compatibilidade**: esta rotina não é adequada até existir uma
migração revisada que mantenha o código anterior utilizável.

Depois da autorização explícita e de terminar conversas/cargas em andamento:

```sh
python3 scripts/update-vps.py activate --release VERSAO_EMITIDA_POR_PREPARE \
  --confirm-production --ack-schema-compatible
```

Há uma breve indisponibilidade. A rotina valida ferramentas/configuração e
`nginx -t`, para `tato`, cria um dump consistente do banco **atual** em
`/tato/backups/update-<id>.dump` (diretório root 0700, arquivo root 0600) e
verifica seu catálogo com `pg_restore --list` antes de trocar o código. Isso
valida o formato do dump, não substitui um ensaio de restauração separado.
Outros escritores externos devem estar pausados na janela de manutenção;
parar `tato` não desativa integrações externas.

Na primeira atualização, move o diretório original para
`/tato/releases/legacy-<id>` e transforma `/tato/app` em link para a versão
ativa. Nas seguintes, substitui esse link atomicamente. O link existente
`/tato/web/tato → /tato/app/artifacts/erp-voice-assistant/dist/public` continua
válido; arquivos de Nginx/systemd e configurações HTTPS não são substituídos.

Restaura views/papéis com `db:access` usando o arquivo protegido via systemd,
confirma leitura das duas views com o papel restrito, inicia o serviço e testa
API e frontend local pelo Nginx. Não faz chamadas pagas de voz. Se falhar,
recupera o código anterior e suas views, **sem restaurar nenhum dump**.
O conteúdo do arquivo de configuração é comparado em memória, sem gravar seu
conteúdo ou hash em relatórios.

### Reversão somente do código

Com nova autorização explícita:

```sh
python3 scripts/update-vps.py rollback \
  --confirm-production --ack-schema-compatible
```

Volta à versão anterior registrada na última troca, faz um novo backup dos
dados atuais e verifica sua saúde. Os dados, usuários, configurações e registros
criados depois da atualização **não voltam no tempo**. Não use
`migration.dump` nem um dump de atualização para uma simples reversão de código.
Restaurar banco é outra operação, potencialmente destrutiva, fora desta rotina.

Se faltar energia ou o processo for interrompido na troca, o estado fica em
`/tato/state/pending.json`. Não tente outra ativação nem apague esse estado:

```sh
python3 scripts/update-vps.py recover \
  --confirm-production --ack-schema-compatible
```

`recover` retoma o código anterior, inclusive se a interrupção aconteceu entre
mover o diretório original e criar o primeiro link. Se a recuperação também
falhar, o estado é preservado para intervenção manual; não é declarado sucesso.
A rotina impede duas execuções simultâneas por lock.

### Se um administrador executar schema push separadamente

Essa manutenção exige backup protegido e análise de alterações/destruição
**antes** do push, com escritores pausados. Não aceite descarte de dados nem
use seed para resolver views ausentes. Mesmo um push parcialmente falho pode
ter removido as views: execute a restauração antes de reabrir o serviço:

```sh
python3 scripts/update-vps.py restore-views \
  --confirm-production --ack-schema-compatible
```

Esse comando executa a mesma inicialização idempotente de `db:access`, confirma
as views com o papel de leitura e não carrega dados de demonstração. Confirme
também que o código anterior ainda funciona com o schema; reversão do link
**não desfaz migrations**. Mantenha a manutenção suspensa se essa verificação
falhar.

### Verificação local da rotina (sem VPS)

```sh
python3 -m unittest discover -s scripts -p 'test_vps_update.py'
```

Os testes usam arquivos temporários e processos simulados. Não acessam a VPS,
Secrets, PostgreSQL real, systemd ou provedores de voz.

## Backup cifrado para fora da VPS

Rotina `tato-backup` (modelo em `docs/vps/tato-backup.py`, instalado em `/usr/local/sbin/tato-backup`; unidades `tato-backup.service`/`tato-backup.timer`, diário às 03:30 UTC). Requer os pacotes Debian `age` e `rclone`.

- `tato-backup run`: `pg_dump --format=custom` do banco `tato`, conferido com `pg_restore --list`, cifrado com a chave pública `age` (`BACKUP_CHAVE_PUBLICA` em `/tato/config/tato.env`) e guardado em `/tato/backups/externo/tato-<classe>-<AAAAMMDD>.dump.age`; `/tato/config/tato.env` vai cifrado à parte (`tato-env-<AAAAMMDD>.age`). Com `BACKUP_DESTINO` (remoto do `rclone`, formato `nome:caminho`, configuração em `/tato/config/rclone.conf`, root 0600) os arquivos são enviados para fora da VPS. Retenção local e remota: 7 diários, 4 semanais (domingo), 6 mensais (dia 1). Uma cópia em claro fica em `/tato/backups/diario` (root 0700), com a mesma retenção, para o `restore-test`.
- `tato-backup restore-test [arquivo]`: restaura o dump local mais recente (ou um arquivo decifrado informado) em um banco temporário, lista a contagem de cada tabela comparada com o banco atual e apaga o banco temporário.
- `tato-backup status`: o que existe localmente e no destino. Nenhum comando imprime chaves, senhas ou endereços de conexão.

Chave: a privada deve ficar **só com o dono, fora da VPS**. Gere no computador do dono (`age-keygen -o tato-backup.key`; a linha `# public key: age1…` é a pública) e coloque a pública em `BACKUP_CHAVE_PUBLICA`. Enquanto o dono não entrega a sua, há um par provisório em `/tato/config/backup-age-key.txt` (root 0600) só para provar a rotina; troque-o pela chave do dono e apague o arquivo. Para decifrar fora da VPS: `age -d -i tato-backup.key -o tato.dump tato-diario-AAAAMMDD.dump.age` e `pg_restore --no-owner --dbname <banco vazio> tato.dump`.

Destino sugerido (nenhuma conta criada; decisão do dono): o banco cifrado hoje tem ~0,2 MB por cópia; mesmo a 50 MB por cópia, 17 cópias ocupam < 1 GB. **Cloudflare R2** tem 10 GB/mês e saída gratuitos (custo estimado: R$ 0; precisa de conta Cloudflare com cartão cadastrado). **Backblaze B2** dá 10 GB grátis e depois ~US$ 6/TB-mês (custo estimado: R$ 0 a ~R$ 0,05/mês). Outro servidor próprio via SFTP também funciona com o mesmo `rclone` (custo: o do servidor). Configuração: `rclone config --config /tato/config/rclone.conf` como root, depois `BACKUP_DESTINO="r2:tato-backups"` e `tato-backup run`.
