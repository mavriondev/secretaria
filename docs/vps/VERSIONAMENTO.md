# VPS, GitHub e desenvolvimento

## Comparação em 13 de outubro de 2026

A instalação foi consultada por SSH **somente em leitura**. Não houve implantação,
reinicialização de serviço, migração, acesso ao conteúdo de configuração secreta
ou mudança de dados.

### Versão instalada

- Código: `/tato/app`; API systemd executa `/usr/bin/node dist/index.mjs` a partir
  de `/tato/app/artifacts/api-server`, na porta 5004.
- Frontend: `/tato/`, servido pelo Nginx com HTTPS público válido no IP.
- O código/manifests da aplicação coincide com a referência local
  `4e15dd482da2c7f8aa7e924feb0ad1f00a8d69f5`.
- Depois dessa referência, a VPS recebeu seis mudanças de documentação/modelos:
  README da VPS, bootstrap Nginx com ACME, modelo HTTPS, wrapper Certbot,
  serviço e timer de renovação. Não são mudanças da lógica do assistente.
- A VPS não contém um checkout `.git`: **não afirmar que um SHA Git já estava
  instalado**. A referência acima foi confirmada por igualdade de conteúdo.
- Inventário: 329 arquivos de código/manifests/documentação. SHA-256 do manifesto
  ordenado `caminho + NUL + sha256(conteúdo) + LF`:
  `d27f3c8452c9d719b56c77347f15ac22ace6fc7e7fbe95203a503fe07644f73b`.
- Bundle API instalado:
  `2e8a24654f1535314e62dad79317d932cf12c07cd15045e19dd40be518e64c5d`.
- HTML de entrada do frontend instalado:
  `2fea27df595a54c9b14419560f5e8018fa6ed92d4876edb9822f7d0202cf0b9f`.

Os hashes de build registram os arquivos encontrados; não substituem uma
reprodução determinística do build. Não foram enviados bundles ao GitHub.

### Infraestrutura ativa

Os cinco arquivos públicos ativos coincidem byte a byte com os modelos
`tato.https.nginx.conf`, `tato.service`, `tato-certbot`,
`tato-certificate-renew.service` e `tato-certificate-renew.timer`.
O serviço e o timer estavam ativos; `nginx -t` passou e `/tato/` respondeu
HTTP 200 sem ignorar a validação TLS.

Nunca substituir o host HTTPS pelo modelo HTTP de bootstrap. O Certbot isolado,
os diretórios privados, a configuração de execução e a renovação continuam na VPS.
O README nesta branch pode descrever ferramentas futuras; a presença de um guia
no GitHub **não comprova instalação**.

## Destinos e preservação de histórico

- `main`: snapshot público correspondente à instalação consultada, incluindo
  HTTPS, renovação e instalação inicial; documentação de rastreabilidade pode
  ser acrescentada sem modificar a VPS.
- `claude/ajustes-secretaria`: desenvolvimento conciliado, preservando os commits
  do Claude e recebendo os ajustes da VPS e as mudanças recentes do Replit.
- `claude/prompts`: não alterar.
- Repositório privado de comunicação: não consultar nem alterar nesta operação.

Antes da conciliação, os destinos eram:

| Branch | SHA |
| --- | --- |
| `main` | `0ba1ac491067528babbcc630b97017ccbadd6a3e` |
| `claude/ajustes-secretaria` | `7fbeae2672ceabfb7cdfd403233386c0f9174cea` |
| `claude/prompts` | `db6b4535b48c4b17505703c20c29ba6cac35661d` |

A referência da VPS é descendente do trabalho do Claude; não foi necessário
resetar ou reescrever seus commits. Usar somente atualizações fast-forward,
com novas consultas remotas antes de atualizar referências, nunca force-push.

## Mudanças de desenvolvimento ainda não instaladas

A referência Replit comparada foi
`1ab7d074ef89732746326e85c87716e1b957d274`. Ela contém mudanças posteriores na integração
ElevenLabs, diagnóstico administrativo, aviso ao gestor antes do microfone,
contratos gerados de API e rotina de atualização segura com backups/reversão.

Essas mudanças pertencem ao desenvolvimento. **Não foram instaladas na VPS
durante a sincronização com GitHub.** A atualização de produção é outra operação,
com autorização explícita, revisão do schema e os cuidados do README.

## Limite de exportação

O inventário usa `scripts/export-vps-source.py`, com `VPS_SSH_PASSWORD` somente
no ambiente do processo SSH. Os arquivos gerados ficam em
`generated-artifacts/vps-sync/`, ignorados, com permissões restritas.
Os testes offline estão em `scripts/test_vps_export.py`.

Nunca exportar `.env`, configuração de execução, chaves, certificados privados,
bancos, dumps, usuários, registros de conversas, anexos, dependências, builds
ou metadados internos do Replit. Modelos públicos contêm apenas caminhos e opções.
O conteúdo é verificado em memória contra valores de credenciais disponíveis e
assinaturas sensíveis; a saída não contém esses valores. Apenas fixtures negativas
específicas já revisadas são aceitas, nunca credenciais reais.

## Marco implantado em 13 de outubro de 2026

- Branch `marco/implantado-20261013` criada em `8fafa902571dcbe92fad18e3cd5129ebef0743ae`, o commit ativado na VPS (release `20261013T193036Z-8fafa902571d`).
- **Referência do `drift` a partir daqui:** `--revision 8fafa902571dcbe92fad18e3cd5129ebef0743ae` (ou o checkout de `marco/implantado-20261013`), até a próxima ativação, quando o novo commit ativado passa a ser a referência.
- A VPS é a instalação oficial; o Replit é só desenvolvimento (ver `docs/vps/README.md`, "Ambiente oficial").
