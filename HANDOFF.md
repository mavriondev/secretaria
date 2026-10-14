# Tato — instalação pública

- Endereço principal escolhido pelo dono: **https://www.oitato.com.br/** (sem `/tato/`).
- `https://oitato.com.br/` redireciona para `www`; API para clientes: `https://www.oitato.com.br/api/ingestao`.
- IP antigo mantém `/tato/api/` e `/api/` para integrações. Não retirar sem autorização do dono.
- `VITE_PUBLIC_APP_URL` define a origem dos links compartilháveis na compilação. Requisições e cookies continuam na origem da navegação.
- `LISTEN_HOST=127.0.0.1` na VPS; não expor porta 5004. Desenvolvimento continua em `0.0.0.0`.
- Instalações PWA e assinaturas push são por origem: reinstalar pelo domínio e permitir notificações novamente.
- HSTS começa com sete dias, sem `includeSubDomains`/`preload`. Ver `docs/vps/DOMINIO.md` antes de aumentar.
- Procedimento de versão, backup e reversão: `docs/vps/README.md` e `FLUXO-DE-VERSOES.md`.
- Configurações Nginx: `docs/vps/tato-dominio.nginx.conf` e `tato.https.nginx.conf`.
- Senhas/chaves ficam fora do Git; este documento não contém credenciais.
