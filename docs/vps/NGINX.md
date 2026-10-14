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
e compara o `Content-Type` com a tabela acima; imprime a lista e falha com código 1 se algum estiver errado.
O `activate` executa a mesma verificação ao final (depois de o código já estar ativo: um tipo errado é problema do
Nginx, não motivo para reverter o código) e termina com erro visível se encontrar algo.
