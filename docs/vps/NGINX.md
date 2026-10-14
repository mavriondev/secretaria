# Nginx do Tato na VPS

Arquivo: `/etc/nginx/sites-available/tato` (ligado em `sites-enabled`). Ele não faz parte das versões do código:
é configuração do servidor, alterada à mão, com backup antes de cada mudança. O certificado, o redirecionamento
para HTTPS e o proxy da API não são tratados aqui.

## Tipos de conteúdo (obrigatório para a voz)

O reconhecimento de fala roda no navegador com `onnxruntime-web`: o build entrega um módulo ES (`.mjs`) e um
WebAssembly (`.wasm`) em `/tato/assets/`. O navegador **recusa** o módulo se ele vier como
`application/octet-stream` (erro "'application/octet-stream' is not a valid JavaScript MIME type" e o orbe em
"Não consegui ouvir"). O `mime.types` do Nginx 1.26 instalado não tem entrada para `.mjs` nem para
`.webmanifest`, e o `default_type` do servidor é `application/octet-stream`.

O bloco `server` do Tato traz, logo depois de `root /tato/web;`:

```nginx
    # Tato ships ES modules (.mjs) and WebAssembly for the on-device speech classifier.
    # The packaged mime.types has no entry for .mjs or .webmanifest; without these the
    # browser refuses the module ("not a valid JavaScript MIME type") and voice fails.
    include /etc/nginx/mime.types;
    types { text/javascript mjs; application/manifest+json webmanifest; }
```

Por que os dois: uma diretiva `types` dentro de `server` **substitui** a tabela herdada do `http`; o `include`
traz a tabela padrão de volta e o `types` acrescenta só o que falta. Resultado esperado:

| Extensão | Content-Type |
| --- | --- |
| `.wasm` | `application/wasm` |
| `.mjs`, `.js` | `text/javascript` / `application/javascript` |
| `.css` | `text/css` |
| `.json`, `manifest.json` | `application/json` |
| `.png` / `.svg` | `image/png` / `image/svg+xml` |
| `.html`, `sw.js` | `text/html`, `application/javascript` |
| `.onnx` (modelo) | qualquer um (é carregado por `fetch`, não como módulo) |

## Cache (para nenhum aparelho ficar preso em arquivo ruim)

Os arquivos de `/tato/assets/` têm hash no nome e podem viver um ano no navegador — **mas só quando saíram com o tipo
certo**. Um `map` no topo do arquivo decide o `Cache-Control` pelo par `uri|Content-Type`; qualquer outra combinação
(por exemplo `.mjs` como `application/octet-stream`) sai **sem** `Cache-Control`, e o navegador não a guarda por um ano:

```nginx
map "$uri|$sent_http_content_type" $tato_assets_cache {
    default "";
    "~\.(m?js)\|(text|application)/javascript$"    "public, max-age=31536000, immutable";
    "~\.wasm\|application/wasm$"                    "public, max-age=31536000, immutable";
    "~\.css\|text/css$"                             "public, max-age=31536000, immutable";
    "~\.onnx\|application/octet-stream$"            "public, max-age=31536000, immutable";
    "~\.(png|svg|jpg|webp|woff2?|ttf)\|(image|font)/" "public, max-age=31536000, immutable";
}
# ... dentro do server:
    location /tato/assets/ {
        try_files $uri =404;
        add_header Cache-Control $tato_assets_cache;
    }
```

`index.html`, `sw.js`, `manifest.json`, `offline.html` (tudo fora de `assets/`) ficam no `location /tato/` com
`Cache-Control: no-cache`: o navegador sempre revalida e enxerga o service worker novo na abertura seguinte.
O `smoke` confere os dois cabeçalhos em todos os arquivos.

No lado do app, o service worker só guarda em cache respostas com o tipo certo, descarta entradas antigas inválidas,
refaz o pedido com `cache: 'reload'` quando a rede devolve tipo errado e tem um `CACHE_EPOCH` (em `vite.config.ts`)
que, ao subir, apaga todos os caches `tato-*` e muda o nome de todos os assets.

Backups desta configuração: `tato.bak-20261014-mime` (antes dos tipos), `tato.bak-20261014-cache` (antes do cache) e
`tato.bak-20261014-frame` (antes dos cabeçalhos contra enquadramento) e `tato.bak-20261014-gzip` (antes da compressão). O `location /tato/` também envia `X-Frame-Options: DENY`
e `Content-Security-Policy: frame-ancestors 'none'`: o app nunca é mostrado dentro de um frame de outro site.
`docs/vps/tato.https.nginx.conf` é a cópia fiel do arquivo instalado (`/etc/nginx/sites-available/tato`); alterar um sem o outro cria desvio.

## Compressão (medida em 14/10/2026)

O `nginx.conf` global só tem `gzip on`, que vale apenas para `text/html`. Antes do ajuste, o JS principal saía inteiro
(1,1 MB; 0,3 MB com gzip), o runtime do reconhecimento de fala no aparelho também (`ort-wasm`: 14,2 MB; 3,7 MB com gzip)
e cada resposta JSON da API ia sem compressão. O bloco do Tato agora declara os tipos que realmente serve:

```nginx
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json application/manifest+json application/wasm application/octet-stream image/svg+xml;
```

A compressão é feita a cada pedido (o `.wasm` custa ~0,8 s de CPU no servidor, uma vez por aparelho e por versão, porque
o arquivo fica um ano no cache). Se um dia pesar, a alternativa é gerar `.gz` no build e ligar `gzip_static`
(módulo presente no Nginx instalado). Backup antes do ajuste: `tato.bak-20261014-gzip`.

## Como alterar com segurança

```sh
cp -a /etc/nginx/sites-available/tato /etc/nginx/sites-available/tato.bak-$(date +%Y%m%d)
# editar
nginx -t && systemctl reload nginx
python3 /tato/src/scripts/update-vps.py smoke   # confere todos os arquivos estáticos
```

Para reverter: copie o `.bak-...` de volta, `nginx -t`, `systemctl reload nginx`.

## Verificação automática

`scripts/update-vps.py smoke` percorre todos os arquivos do build ativo, pede cada um ao Nginx público com `HEAD`
e compara o `Content-Type` com a tabela acima e o `Cache-Control` com a regra da seção de cache (assets bem tipados:
`max-age=31536000, immutable`; `index.html`/`sw.js`/`manifest.json`/`offline.html`: `no-cache`); imprime a lista e
falha com código 1 se algum estiver errado.
O `activate` executa a mesma verificação ao final (depois de o código já estar ativo: um tipo errado é problema do
Nginx, não motivo para reverter o código) e termina com erro visível se encontrar algo.
