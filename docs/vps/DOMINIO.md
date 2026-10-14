# Trocar o IP por um domínio (checklist)

Hoje o Tato responde em `https://187.77.232.164/tato/` com certificado Let's Encrypt de curta duração para IP (perfil `shortlived`, ~6 dias, renovado pelo `tato-certificate-renew.timer`). Com um domínio, o certificado passa a ter 90 dias e o endereço deixa de depender do IP. Nada aqui compra domínio nem cria conta; o dono decide quando.

## Domínio escolhido: `www.oitato.com.br` (estado em 14/10/2026)

- O domínio `oitato.com.br` está registrado (servidores de nome `a.auto.dns.br`/`b.auto.dns.br`, o DNS do Registro.br), mas **ainda sem registro A**: `www.oitato.com.br` não resolve.
- **Já feito na VPS** (14/10): `/etc/nginx/sites-available/tato-dominio` (cópia em `docs/vps/tato-dominio.nginx.conf`), ligado em `sites-enabled`, com o host de porta 80 para `www.oitato.com.br` e `oitato.com.br`: rota ACME em `/tato/acme-webroot` e redirecionamento 308 para `https://www.oitato.com.br`. Os blocos HTTPS estão **comentados** até existir o certificado. Backup do host do IP: `/etc/nginx/sites-available/tato.bak-20261014-dominio`. O host do IP não mudou.
- **Falta, pelo dono, no painel do Registro.br** (Meus domínios → oitato.com.br → Editar zona / DNS): dois registros tipo **A**, TTL 300 (ou o padrão):
  - nome em branco (ou `@`, o domínio `oitato.com.br`) → `187.77.232.164`
  - `www` → `187.77.232.164`
  Sem CDN/proxy na frente. A propagação costuma levar de minutos a algumas horas. Conferir: `curl -s "https://dns.google/resolve?name=www.oitato.com.br&type=A"` deve trazer o IP.
- **Depois do DNS, na VPS** (quem opera):
  ```sh
  tato-certbot certonly --non-interactive --agree-tos --webroot --webroot-path /tato/acme-webroot \
    -d www.oitato.com.br -d oitato.com.br --cert-name tato-dominio \
    --config-dir /etc/letsencrypt-tato --work-dir /var/lib/letsencrypt-tato --logs-dir /var/log/letsencrypt-tato
  ```
  (a conta ACME já existe no `--config-dir`; não precisa de e-mail novo). Em seguida descomentar os dois blocos HTTPS de `/etc/nginx/sites-available/tato-dominio`, `nginx -t`, `systemctl reload nginx`, e testar `https://www.oitato.com.br/tato/api/healthz`, `https://www.oitato.com.br/` (deve cair em `/tato/`) e `https://oitato.com.br/` (deve ir para `www`). Depois `tato-certbot renew --dry-run` com os mesmos diretórios para confirmar que o timer renova os dois nomes.
- Decisão: o prefixo `/tato/` continua (nada muda no código, cookies, PWA e no endereço de ingestão); `https://www.oitato.com.br/` redireciona para `/tato/`. Servir na raiz do domínio é uma mudança separada, se o dono quiser.
- Os passos 5 a 8 abaixo (HSTS, endereço de ingestão do cliente, instruções de acesso, aposentar o host do IP) continuam valendo, com `www.oitato.com.br` no lugar de `tato.<dominio>`.

1. **Registrar o domínio** (ou usar um subdomínio de um domínio que o dono já tenha, por exemplo `tato.<dominio>`). Em registradores brasileiros (`.com.br`) o custo é de ~R$ 40/ano; `.com` ~US$ 10–15/ano.
2. **DNS**: criar um registro **A** `tato.<dominio>` → `187.77.232.164` (TTL 300). Sem proxy/CDN na frente na primeira emissão (validação HTTP-01 precisa chegar direto ao Nginx). Conferir com `dig +short tato.<dominio>` antes de seguir.
3. **Nginx**: a partir de `docs/vps/tato.https.nginx.conf`, criar um `server` separado para o novo nome (`server_name tato.<dominio>;`), com a mesma rota ACME (`/tato/acme-webroot`) na porta 80. Não editar os hosts dos outros sites nem retirar o `default_server` do IP enquanto o IP ainda for usado. `nginx -t` antes de recarregar.
4. **Certificado de 90 dias** (cliente isolado já instalado):
   ```sh
   tato-certbot certonly --non-interactive --agree-tos -m <email do dono> --webroot --webroot-path /tato/acme-webroot \
     -d tato.<dominio> --cert-name tato-dominio \
     --config-dir /etc/letsencrypt-tato --work-dir /var/lib/letsencrypt-tato --logs-dir /var/log/letsencrypt-tato
   ```
   Apontar `ssl_certificate`/`ssl_certificate_key` do novo host para `/etc/letsencrypt-tato/live/tato-dominio/`. O timer existente renova os dois nomes; conferir com `tato-certbot renew --dry-run` (mesmos `--config-dir/--work-dir/--logs-dir`).
5. **HSTS**: só depois de confirmar o HTTPS no domínio, adicionar no host do domínio `add_header Strict-Transport-Security "max-age=31536000" always;` (sem `includeSubDomains` se outros subdomínios não forem HTTPS). Não colocar HSTS no host do IP.
6. **Aplicação**: nada muda no código (o prefixo continua `/tato/`); os cookies já são `Secure; Path=/tato/`. Testar `https://tato.<dominio>/tato/api/healthz` e o login.
7. **Atualizar quem usa o endereço**: o job de envio do cliente (`TATO_URL=https://tato.<dominio>/tato/api/ingestao`) e o endereço mostrado na tela Recebimento (ele usa `window.location.origin`, então basta o dono acessar pelo domínio); o endereço do analista/gestor nas instruções de acesso; `docs/vps/README.md`.
8. **Depois da troca**: manter o host do IP por alguns dias redirecionando (`return 301 https://tato.<dominio>$request_uri;`), depois desativar o certificado de IP (`tato-certbot delete --cert-name tato-ip …`) e o `default_server` correspondente, se nenhum outro site depender dele.
