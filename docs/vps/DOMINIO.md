# Trocar o IP por um domínio (checklist)

Hoje o Tato responde em `https://187.77.232.164/tato/` com certificado Let's Encrypt de curta duração para IP (perfil `shortlived`, ~6 dias, renovado pelo `tato-certificate-renew.timer`). Com um domínio, o certificado passa a ter 90 dias e o endereço deixa de depender do IP. Nada aqui compra domínio nem cria conta; o dono decide quando.

## Domínio escolhido: `www.oitato.com.br`, app na raiz (estado em 14/10/2026)

Decisão do dono: **o prefixo `/tato/` deixa de existir**. `https://www.oitato.com.br/` abre direto a tela de login; a API fica em `/api/`; `oitato.com.br` e `http://` redirecionam para `https://www.oitato.com.br`.

- O domínio `oitato.com.br` está registrado (DNS do Registro.br, `a.auto.dns.br`/`b.auto.dns.br`), mas **ainda sem registro A**: `www.oitato.com.br` não resolve.
- **Já feito na VPS** (14/10): `/etc/nginx/sites-available/tato-dominio` ligado em `sites-enabled` com o host de porta 80 para os dois nomes (rota ACME em `/tato/acme-webroot` + redirecionamento 308). Os blocos HTTPS estão **comentados** até existir o certificado. Backup do host do IP: `/etc/nginx/sites-available/tato.bak-20261014-dominio`.
- **Já feito no código** (commit da raiz, 14/10): `scripts/update-vps.py` compila com `BASE_PATH=/`, exige `/assets/` no `index.html`, confere a saúde pelo host `www.oitato.com.br` e faz o `smoke` em `https://www.oitato.com.br/`; o kit de integração (`public/integracao/*`) aponta para `https://www.oitato.com.br/api`. O app já era independente do prefixo (`BASE_URL` do Vite: rotas, manifest, service worker, cookies `Path=/`).
- **Falta, pelo dono, no painel do Registro.br** (Meus domínios → oitato.com.br → Editar zona / DNS): dois registros tipo **A**, TTL 300 (ou o padrão), sem CDN/proxy na frente:
  - nome em branco (ou `@`, o domínio `oitato.com.br`) → `187.77.232.164`
  - `www` → `187.77.232.164`

  Conferir: `curl -s "https://dns.google/resolve?name=www.oitato.com.br&type=A"` deve trazer o IP.

### Virada (quem opera a VPS, depois do DNS; ~5 minutos de indisponibilidade)
1. Confirmar na própria VPS que `getent hosts www.oitato.com.br` e `oitato.com.br` dão `187.77.232.164`.
2. Certificado de 90 dias (a conta ACME já existe em `--config-dir`):
   ```sh
   tato-certbot certonly --non-interactive --agree-tos --webroot --webroot-path /tato/acme-webroot \
     -d www.oitato.com.br -d oitato.com.br --cert-name tato-dominio \
     --config-dir /etc/letsencrypt-tato --work-dir /var/lib/letsencrypt-tato --logs-dir /var/log/letsencrypt-tato
   ```
3. Em `/tato/src`: `git fetch && git checkout <SHA da raiz>`; `drift` contra o commit ativo; `prepare` (gera a versão compilada para a raiz, sem tocar no que está no ar).
4. Nginx, em sequência: gravar `tato-dominio` a partir de `docs/vps/tato-dominio.nginx.conf` **com os blocos HTTPS descomentados**; gravar `tato` a partir de `docs/vps/tato.https.nginx.conf` (host do IP vira redirecionamento + `/tato/api/`); `nginx -t`; `systemctl reload nginx`.
5. `activate --release <ID> --confirm-production --ack-schema-compatible` (a saúde é conferida em `www.oitato.com.br`; o `smoke` percorre os 22 arquivos estáticos na raiz).
6. Testes: `https://www.oitato.com.br/api/healthz`; `https://www.oitato.com.br/` abre o login; `https://oitato.com.br/` → `www`; `https://187.77.232.164/tato/` → domínio; `https://187.77.232.164/tato/api/healthz` continua `ok` (job do cliente); login, voz e PWA pelo domínio (instalar o app de novo no celular: o atalho antigo do IP deixa de valer). `tato-certbot renew --dry-run` com os mesmos diretórios.
7. Se algo falhar no `activate`, ele volta sozinho ao código anterior; para voltar também o Nginx, religar os backups `tato.bak-20261014-dominio` e desativar os blocos HTTPS de `tato-dominio`.

### Depois da virada
- HSTS no host do domínio (passo 5 abaixo) só depois de alguns dias de HTTPS confirmado.
- Avisar o técnico do cliente para trocar `TATO_URL` para `https://www.oitato.com.br/api/ingestao`; quando ninguém mais usar o IP, aposentar o host do IP e o certificado `tato-ip` (passo 8 abaixo).
- Monitor externo: trocar a URL para `https://www.oitato.com.br/api/healthz` (ver `MONITOR-EXTERNO.md`).
- O restante da lista original abaixo continua como referência (`www.oitato.com.br` no lugar de `tato.<dominio>`; o item 6 "nada muda no código" já não vale: a raiz foi a escolha).

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
