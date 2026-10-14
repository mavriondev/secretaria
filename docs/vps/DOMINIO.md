# Domínio público do Tato

O endereço principal escolhido pelo dono é **https://www.oitato.com.br/**.
O login abre na raiz, sem `/tato/`. `https://oitato.com.br/` e HTTP redirecionam para o principal.

## Estado confirmado em 14/10/2026

- DNS do Registro.br: apex A para a VPS; `www` é CNAME para o apex.
- Certificado Let's Encrypt `tato-dominio`, SAN `oitato.com.br` e `www.oitato.com.br`, válido até 12/01/2027.
- Certificado e chave ficam em `/etc/letsencrypt-tato/live/tato-dominio/`, fora do Git.
- Host Nginx `/etc/nginx/sites-available/tato-dominio` ativo, HTTPS habilitado.
- Cópia da configuração: `docs/vps/tato-dominio.nginx.conf`.
- Certificado do IP permanece separado para compatibilidade das integrações.
- Renovação pelo `tato-certificate-renew.timer`; deploy hook testa/recarrega Nginx.

## Configuração da aplicação

`scripts/update-vps.py` compila com `BASE_PATH=/` e `VITE_PUBLIC_APP_URL=https://www.oitato.com.br`.
Essa última variável governa links de redefinição de senha e a URL de envio exibida aos técnicos.
Requisições autenticadas continuam na origem atual; a variável não redireciona cookies para outra origem.

Na VPS, `LISTEN_HOST=127.0.0.1` impede acesso direto à API 5004.
`VAPID_SUBJECT` usa o contato público do domínio, preservando as chaves e assinaturas existentes na respectiva origem.
Nenhum segredo deve ser colocado neste documento.

## Compatibilidade

- App antigo no IP: redireciona para o domínio.
- `/tato/api/` no IP: continua proxy para a API, sem redirecionar POST.
- `/api/` no IP: também aceito para integrações.
- API atual dos clientes: `https://www.oitato.com.br/api/ingestao`.
- Links `/tato/...` no domínio redirecionam para o mesmo caminho sem o prefixo.
- Não retirar os caminhos antigos enquanto o dono não confirmar a troca dos clientes.

## PWA e notificações

O manifest tem `id`, `start_url` e `scope` iguais a `/`. O worker é `/sw.js`, escopo `/`, CACHE_EPOCH 2.
O worker não armazena respostas de API nem dados das empresas.
Instalações e permissões do IP não migram para o domínio: abrir o domínio, instalar novamente e permitir notificações.
No iPhone, push exige instalação na tela inicial e suporte do sistema; Chromium de teste não comprova comportamento de iPhone real.

## HSTS

Após confirmação do certificado e cadeia nos dois nomes, o host HTTPS inicia com:

```nginx
add_header Strict-Transport-Security "max-age=604800" always;
```

Prazo inicial de sete dias, sem `includeSubDomains` e sem `preload`.
Após pelo menos sete dias de HTTPS e renovação confirmados, o dono pode autorizar a troca para
`max-age=15552000` (seis meses) ou `max-age=31536000` (um ano), nos dois hosts HTTPS e nas
localizações que declaram `add_header`, testando `nginx -t` antes de recarregar.
Para reduzir o prazo, publicar um `max-age` menor (ou zero) por HTTPS; clientes offline só recebem a mudança ao voltar.

## Reversão

Atualização pelo fluxo `prepare` → backup → `activate`, com código anterior preservado.
Configuração Nginx tem backup datado antes da troca. Reverter Nginx separadamente se necessário:
restaurar os dois arquivos anteriores, executar `nginx -t` e recarregar. Não restaurar dados sem autorização.
