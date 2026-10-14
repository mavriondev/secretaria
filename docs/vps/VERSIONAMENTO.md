# VPS, GitHub e desenvolvimento

## Identificação permanente no diagnóstico administrativo

O administrador da empresa encontra **Versão em execução** no diagnóstico de voz
das configurações. Gestores, donos e visitantes não recebem estes metadados;
a disponibilidade usada na conversa continua contendo somente o aviso de voz.

- **VPS:** `prepare` extrai um commit revisado pelo SHA completo, gera um
  identificador público da release e registra a data de preparação. Um manifesto
  público `.runtime-version.json` na release contém somente `schema`,
  `installation`, `revision`, `buildId` e `builtAt`. É criado pelo atualizador,
  nunca importado do checkout, e incorporado ao bundle da API durante o build.
  As releases ficam protegidas contra escrita pelo usuário da aplicação.
- **Replit:** cada build da API gera um identificador público aleatório e uma
  data. Não afirma um SHA Git: a árvore de desenvolvimento pode conter edições
  ainda não commitadas. Um reinício que recompila cria outro build; apenas
  reiniciar o mesmo bundle preserva sua identificação.
- **Sem metadados:** exibe **Versão não identificada**, sem inferir revisão pelo
  conteúdo, por um nome de branch ou pela referência mais recente do GitHub.
  Uma instalação não reconhecida também informa esse limite. Um frontend novo
  consultando uma API antiga sem o campo mostra o mesmo aviso.

A API captura o identificador do seu próprio bundle uma única vez ao iniciar.
Não consulta o GitHub, não lê a referência Git atual a cada diagnóstico e não
reabre um manifesto compartilhado. `activate` registra a identificação e a data
da ativação no estado protegido após a verificação de saúde; o diagnóstico
exibe a hora de **início do processo**, que não é a hora do upload ao GitHub.
`rollback` e `recover` apontam para a release anterior e reiniciam seu bundle,
portanto restauram a identificação anterior; releases legadas continuam sem
identificação. Nenhuma reversão desta identificação restaura dados do banco.

O campo identifica o **servidor em execução**. Em uma release VPS preparada
pela rotina, API e frontend são compilados do mesmo snapshot. No Replit,
o frontend de desenvolvimento pode mudar independentemente do build da API.
Publicar ou conciliar commits no GitHub, sem preparar e ativar código, não
atualiza uma instalação.

Não são usados hashes de Secrets, configuração, banco, caminhos privados,
remotes ou tokens como identificador. O manifesto público não substitui nem
expõe o estado privado de atualização, backups ou configuração de execução.
Um manifesto presente mas inválido interrompe o build; não é ignorado para
inventar uma identidade. Não edite o manifesto ou o bundle de uma release
selada: para trocar o código, prepare outra release.

Verificações offline (sem SSH, banco ou geração de voz):

```sh
python -m unittest discover -s scripts -p 'test_vps_update.py'
node --test artifacts/api-server/runtime-build.test.mjs
pnpm --filter @workspace/api-server exec tsx --test src/tests/runtime-version.test.ts src/tests/voice-status.test.ts
```

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


## Atualização ativada em 13 de outubro de 2026

- `drift` contra `b9e37b3365fbab6daaa50d7cf32d27fcb482a0db`: nenhum arquivo só na
  VPS ou diferente na VPS; nenhuma branch `vps-sync` foi necessária.
- Antes da ativação, dois ajustes na rotina entraram na branch
  `claude/ajustes-secretaria` (chmod do lock, `sbin` no PATH fixo e aceitação do
  Node 20 do sistema, compartilhado com outros sites da VPS via pm2).
- Commit ativado: `8fafa902571dcbe92fad18e3cd5129ebef0743ae`, versão
  `20261013T193036Z-8fafa902571d`; código anterior guardado em
  `/tato/releases/legacy-…`; backup do banco anterior em `/tato/backups/update-….dump`.
- `GET /api/healthz` responde `{"status":"ok","versao":"8fafa902…"}` local e por
  HTTPS. Nginx, serviço e timer de renovação continuaram ativos; usuários,
  empresas e registros preservados. Nenhuma chamada paga de voz foi feita.
- A partir daqui, a referência para o próximo `drift` é o commit ativado.

## Mudanças de desenvolvimento anteriores à atualização

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

## Mudanças de desenvolvimento anteriores à atualização

A referência Replit comparada foi
`1ab7d074ef89732746326e85c87716e1b957d274`. Ela contém mudanças posteriores na integração
ElevenLabs, diagnóstico administrativo, aviso ao gestor antes do microfone,
contratos gerados de API e rotina de atualização segura com backups/reversão.

Essas mudanças pertencem ao desenvolvimento. **Não foram instaladas na VPS
durante a sincronização com GitHub.** A atualização de produção é outra operação,
com autorização explícita, revisão do schema e os cuidados do README.

## Marco implantado em 13 de outubro de 2026

- Branch `marco/implantado-20261013` criada em `8fafa902571dcbe92fad18e3cd5129ebef0743ae`, o commit ativado na VPS (release `20261013T193036Z-8fafa902571d`).
- **Referência do `drift`:** sempre o commit ativado por último (`python3 scripts/update-vps.py status` mostra a versão ativa; o SHA está no nome da release). Marcos já ativados depois do inicial: `0aea2306b87d…`, `977f092a026a…`, `61edf739d56b…` (auditoria geral, 14/10) o commit de velocidade de 14/10 (gzip no Nginx, `cache` nas métricas, etapas de espera na tela) `025d23b61c95…` (prioridade na OpenAI e ajustes de resposta, 14/10), `7ab4c2daf50c…` e `1f198bee8347…` (pacote Sankhya em bigint e alargamento dos espelhos existentes, inclusive a cópia de preparo de carga completa, 14/10), `cc26fc7db1ba…` (microfone reaproveitado entre conversas da mesma sessão da tela, 14/10). O commit inicial `8fafa902…` permanece em `marco/implantado-20261013` apenas como histórico.
- A VPS é a instalação oficial; o Replit é só desenvolvimento (ver `docs/vps/README.md`, "Ambiente oficial").
