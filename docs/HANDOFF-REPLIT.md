# Roteiro para atualizar o Replit (branch `claude/ajustes-secretaria`)

## O que mudou
1. **Consulta livre guardada** (`consultar_dados`): o modelo escreve um `SELECT` a partir da pergunta, sobre as views da **ficha de implantação**. Validador estático (`sql-guard.ts`) + banco somente leitura (`free-query.ts`, papel `erp_free_reader`).
2. **Ficha de implantação** (`ficha.ts`, `ficha-gerar.ts`, script `ficha:gerar`): descreve views, colunas e significado dos códigos. A IA não depende de nenhum ERP.
3. **Fatos a partir das linhas** (`free-facts.ts`): valores, datas e nomes formatados pelo código; o modelo só usa marcadores. **Composição objetiva** (`free-turn.ts`): uma chamada no máximo, validador e resposta determinística de reserva; nível 0 e "conciso" não chamam o modelo.
4. **Reparo limitado**: se a consulta falha, até 2 correções pelo modelo; tudo fica no log.
5. **Dados de demonstração de frota** (3 tabelas, 3 views), carregados por `demo:setup`.
6. Já na branch desde o primeiro commit: `comparar_com` do faturamento (provisório), filtro de empresa em `vw_titulos_receber`, correção do `acceptsSuggestion`, alerta de custo por turno (`TURN_COST_ALERT_USD`).

## Segunda atualização (13/10): login e base multiempresa
- Agora **todo acesso exige login**. Tabelas novas (`empresas`, `usuarios`, `sessoes`) e a coluna `empresa_id` em conhecimento, logs e documentos.
- **Depois do `push`, rode sempre `demo:setup`**: o `drizzle-kit push` apaga as views, e o `demo:setup` as recria.
- Crie as contas iniciais (a senha temporária aparece uma vez; é trocada no primeiro acesso):
```
pnpm --filter @workspace/api-server run usuario:criar -- dono voce@exemplo.com "Seu Nome"
pnpm --filter @workspace/api-server run usuario:criar -- administrador gestor@empresa.com "Nome" 1
```
- Entre como administrador (empresa 1) para usar o app como antes. O dono entra em `/plataforma` e cadastra empresas novas, que ficam sem base conectada (o assistente recusa perguntas para elas).
- Atrás de proxy HTTPS o cookie sai com `Secure` (usa `X-Forwarded-Proto`). O servidor confia no proxy (`trustProxy`).

## Comandos depois de puxar a branch
```
pnpm install
pnpm --filter @workspace/db run push        # cria frota_*, coluna TGFFIN.CODEMP
pnpm --filter @workspace/api-server run demo:setup   # carrega frota e views, concede o papel erp_free_reader
pnpm --filter @workspace/api-server run test          # 100+ testes (precisam de DATABASE_URL)
```
Variáveis opcionais: `FICHA_PATH` (ficha do cliente; sem ela vale a de demonstração), `TURN_COST_ALERT_USD` (padrão 0,08), `OPENAI_SERVICE_TIER` (`priority` dobra o preço das chamadas de texto em troca de latência menor; `auto`/ausente = nível normal; reversível só por configuração, ver `docs/vps/README.md`).

Testes que chamam um provedor pago de verdade (hoje só `tests/modelo-ao-vivo.test.ts`, uma chamada mínima) só rodam com `TESTES_PAGOS=1`; sem a variável são pulados com a mensagem "teste pago". Todo o resto da suíte usa simulações e não gasta. Sob o executor de testes do Node o ritmo por minuto já nasce alto (1000); não é preciso exportar `RITMO_POR_MINUTO`.

Guard de SQL livre (`sql-guard.ts`): subconsultas `EXISTS`/`ANY` em leitura são aceitas por decisão do dono (auditoria geral, item A-10); não são uma falha a corrigir.

## O que foi testado aqui e o que NÃO foi
- Testado: typecheck do projeto todo, build, servidor sobe e responde `/healthz`, todos os testes (com modelo simulado) contra um Postgres 16 local, inclusive recusa de escrita e de tabelas fora da ficha.
- **Não testado: nenhuma chamada real à OpenAI, voz, ElevenLabs ou o front-end.** Por isso, ao rodar no Replit, confira em especial:
  - se o esquema `strict` da ferramenta `consultar_dados` (array `formatos`, `maxItems`) é aceito pela API;
  - se o modelo escolhe `consultar_dados` para perguntas de frota e as ferramentas oficiais para faturamento;
  - se o SQL gerado usa só as views e colunas da ficha na primeira tentativa (veja `parameters._executions[].tentativas` no log);
  - a latência e o custo reais por turno (uma resposta livre faz 1 chamada de roteamento + até 1 de composição + reparos se houver erro).
- Perguntas para validar com dados de frota: "qual caminhão está com defeito?", "quais ficaram parados em agosto?", "algum caminhão em rota sem entrega concluída?", "o que diz a observação da carreta UIO3C45?".

## Pendências conhecidas (não feitas nesta branch)
- Laço de agente que encadeia várias consultas observando cada resultado.
- Pesquisa de mercado restrita a fontes aprovadas por empresa (hoje a pesquisa pública já existente continua igual).
- Custo de voz e transcrição no log por turno.
- `comparar_com` genérico: hoje existe só para `faturamento`; a consulta livre cobre outros assuntos escrevendo as datas no SQL.
- Isolamento por empresa em hospedagem compartilhada (um banco ou esquema por cliente).

## Ajustes após a validação no Replit (12/10)
Resultado da primeira rodada real: esquema da ferramenta aceito pela OpenAI, 4 consultas livres corretas na primeira tentativa, faturamento pela ferramenta oficial, custo de ~US$ 0,013 por resposta livre. Ajustes feitos a partir dela:
- **"Dois últimos meses" não pergunta mais**: sem outra pista vale `completed_months` (meses fechados), com o intervalo explícito na resposta. Antes o roteador fazia uma pergunta de esclarecimento e o exemplo principal não rodava.
- **Texto menos formal**: sem "Critério usado:"; o critério só é dito quando é uma escolha que o gestor pode querer mudar; o texto não repete o que a tabela mostra.
- **Tabela**: colunas de código (`_id`) saem da exibição; colunas calculadas ganham rótulo em português com acentos (campo `rotulo` em `formatos`); resposta de uma linha já dita no texto não repete a tabela.
- **Listagem de vencidos**: continua pela consulta livre (traz todos os clientes, não só os 5 maiores). A ficha agora traz o critério oficial de "vencido" para a listagem e o total oficial coincidirem; conferi localmente que a soma da lista é igual ao total oficial.
- Métrica de tempo: a composição da consulta livre deixou de ser contada também em "consultas".
- Novo script `demo:extend` (18 meses de histórico). **Necessário para validar a comparação com o ano anterior**: a demonstração básica tem só cerca de 180 dias e a resposta cai em "sem vendas na base".

### Nova rodada de validação (nesta ordem)
1. `pnpm --filter @workspace/api-server run demo:extend`
2. Repetir as perguntas (f) "Faturamento dos últimos dois meses comparado com o mesmo período do ano anterior", (e) "Quais clientes têm título vencido?" e (a) "Qual caminhão está com defeito?".
3. Para (f), conferir: `comparar_com=ano_anterior`, datas do ano anterior calculadas pelo backend, e que a resposta diz o intervalo assumido sem perguntar.

## Base de dados separada por empresa (13/10)
Cada empresa cliente (exceto a demonstração, empresa 1, que segue na base compartilhada) tem **seu próprio banco PostgreSQL** e **sua própria ficha de implantação**.
- O dono do produto abre Plataforma → empresa → "Base de dados", informa o endereço `postgresql://…` e cola a ficha (JSON). Só é liberada (`dados_prontos`) se a verificação inteira passar: conexão, views obrigatórias (`vw_vendas_itens`, `vw_titulos_receber` e as da ficha), criação dos papéis somente leitura, leitura de cada coluna descrita e execução das métricas oficiais. Falhou: nada é gravado.
- O endereço é guardado **cifrado** (AES-256-GCM) com o segredo **`COMPANY_DATA_KEY`** (texto longo e aleatório, só no servidor/Replit Secrets). Sem ele a conexão é recusada. Trocar a chave invalida os endereços já guardados.
- Cada requisição carrega o pool e a ficha da empresa da sessão; empresa sem base liberada recebe 409, nunca os dados da demonstração. `/demo/status` só existe para a empresa 1.
- O usuário do banco do cliente precisa poder criar papéis e conceder SELECT (os papéis `erp_free_reader`/`erp_metric_reader` são criados no servidor do cliente).
- Teste de isolamento: `tests/company-data.test.ts` usa um segundo banco via `SECOND_DATABASE_URL` (mesmas views, números diferentes); sem a variável ele é ignorado.
- Alterações de esquema: colunas novas em `empresas` (`dados_url_cifrada`, `ficha`, `dados_verificados_em`, `dados_erro`) → `db push` e depois `demo:setup`.

## Aba "Dados" (13/10)
`/admin/dados` (administrador da empresa): lista as views e colunas da ficha da empresa (o que a IA pode ler) com um campo de nota ao lado de cada coluna. A nota é guardada como item de conhecimento da categoria `erp` com título `view.coluna` (editar atualiza o mesmo item; nota vazia apaga) e entra no contexto da IA como qualquer conhecimento; valores financeiros são recusados. Rotas: `GET /api/dados`, `PUT /api/dados/notas`. O limite por categoria de conhecimento subiu de 60 para 200. A barra lateral só pede `/demo/status` para a empresa 1.

## Respostas ruins (13/10)
Na tela do gestor, "Esta resposta está errada" (motivo opcional) grava uma avaliação (`POST /api/avaliacoes`, tabela nova `avaliacoes`: **precisa de `db push` e depois `demo:setup`**). O administrador vê a lista em `/admin/avaliacoes` (pergunta, resposta, motivo, função, domínio, latência, custo), anota o que fez e marca como revisada/descartada/reaberta. Uma marcação por pessoa e resposta; marcar de novo atualiza o motivo e reabre. Tudo filtrado pela empresa da sessão.

## Custo e tempo (13/10)
`/admin/uso` (administrador) e `GET /api/uso?dias=7|30|90`: resumo do período (respostas, custo total e médio, tempo médio/mediana/95%, respostas de segurança), custo por dia e as 10 respostas mais caras e mais lentas, calculados dos valores gravados em `query_logs` da empresa da sessão (sem estimativa). Voz e transcrição ainda não entram no custo. *(Superado: desde os limites de uso, voz, transcrição, reescrita e implantação são registradas em `custos_ia` e entram no teto.)* Sem tabela nova.

## Perguntas de teste (13/10)
`/admin/testes` (administrador): perguntas com resposta conhecida por empresa (`deve_conter` / `nao_deve_conter`; texto sem distinguir acento ou maiúscula; um teste sem expectativa é recusado) e rodadas que chamam o assistente de verdade (nível equilibrado, sem voz), em segundo plano, com progresso, custo, tempo e a marca "melhorou/piorou desde a rodada anterior". Uma rodada por vez por empresa; rodadas órfãs após reinício viram "interrompida" em 30 min. Máx. 100 perguntas ativas. **Tabelas novas** (`perguntas_teste`, `execucoes_teste`, `resultados_teste`): `db push` e depois `demo:setup`. As respostas dadas na rodada também entram em `query_logs` (aparecem em Auditoria e em Custo e tempo).

Correções das Perguntas de teste (relatório 09): o banco passou a impedir duas rodadas em andamento por empresa (índice único parcial, **precisa de `db push`**) e o limite de 100 perguntas ativas vale também ao reativar uma pergunta desativada.

## Rotina de carga (13/10) — motor pronto, ainda sem tela
`lib/carga.ts` + `lib/pacotes/` (pacote do Sankhya por assunto: vendas e financeiro, 12 tabelas, 121 colunas, gerado do dicionário de dados do cliente — só nomes e tipos). Copia as tabelas dos assuntos escolhidos de uma fonte (hoje PostgreSQL; Oracle/SQL Server entram atrás da mesma interface quando o banco do cliente for confirmado) para o espelho do banco da empresa: incremental pela coluna de alteração (`DTALTER`, com sobreposição de 24 h), tabelas pequenas lidas inteiras, uma tabela por transação (falhou: desfaz e relata, as outras seguem), hora da carga em `espelho_controle`. Carga completa (`modo: "completa"`) remove o que foi apagado na origem; a incremental sozinha não percebe notas apagadas. Testes em `tests/carga.test.ts` (usam `SECOND_DATABASE_URL`; ignorados sem ela). Falta: cadastro da origem por empresa, agendador, tela de acompanhamento e views com as regras sobre o espelho.

## Origem dos dados e cargas (13/10)
No painel do dono (Plataforma → empresa → Base de dados → "Origem dos dados"): endereço de leitura do ERP do cliente (cifrado, nunca devolvido; é testado ao salvar), assuntos a copiar (do pacote do ERP: hoje só Sankhya), intervalo do agendador em minutos, "Carregar agora" (incremental), "Carga completa" e o histórico das últimas 10 cargas com o resultado por tabela. Rotas do dono: `GET/PUT /api/plataforma/empresas/:id/origem`, `POST /api/plataforma/empresas/:id/carga`. Tabelas novas/colunas novas (`cargas`; `origem_url_cifrada`, `origem_tipo`, `assuntos`, `carga_intervalo_min` em `empresas`): **`db push` e depois `demo:setup`**. O agendador roda no servidor (`CARGA_AGENDADOR=off` o desliga) e faz uma carga completa por semana para notar o que foi apagado na origem. A conexão com a origem é sempre somente leitura (a sessão é forçada a read-only).

## Limite de custo, saúde dos dados, nome e tela do gestor (13/10)
- **Limite mensal de custo por empresa**: coluna nova `limite_mensal_usd` em `empresas` (**`db push` e depois `demo:setup`**). O dono define em Plataforma (campo "Limite/mês US$" ao lado de cada empresa; vazio = sem limite), via `PATCH /api/plataforma/empresas/:id` `{limiteMensalUsd}`. O gasto do mês (fuso de São Paulo, renova no dia 1) é a soma de `query_logs.estimated_cost_usd` da empresa. Ao atingir o limite, `answerQuestion` responde com uma mensagem educada, sem chamar IA e sem custo (fica registrada no log com `_limiteAtingido`); a rodada de testes também não inicia. Aviso a partir de 80%. `GET /api/uso` devolve `limite` e a tela "Custo e tempo" mostra a barra. Voz e transcrição ainda não entram no custo. *(Superado: desde os limites de uso, voz, transcrição, reescrita e implantação são registradas em `custos_ia` e entram no teto.)*
- **Saúde dos dados** (`/admin/saude`, `GET /api/saude`): estado geral (em dia / atenção / desatualizado / sem dados), idade de cada tabela do espelho (`espelho_controle`), data do registro mais recente de cada view da ficha (coluna `atualizadoEm`) e as últimas cargas. Limites: com carga agendada, atenção após 1,5 intervalo e crítico após 3; sem agenda, 24 h e 72 h. A demonstração aparece sempre em dia.
- **Nome e identidade**: o produto se chama **Tato** (jeito e sensibilidade ao lidar com as pessoas; busca na web não achou concorrente direto, falta INPI classes 9 e 42 e domínio). O nome fica só em `artifacts/erp-voice-assistant/src/lib/brand.ts`; marca em `components/brand-mark.tsx`; ícone em `public/favicon.svg`. Falta checar domínio e registro no INPI antes de adotar de vez.
- **Tela do gestor** (`pages/user.tsx`): saudação por horário, sugestões de pergunta, resposta em destaque, botão de falar novo (`components/voice-orb.tsx`: parado, conectando, ouvindo, consultando, respondendo e erro têm aparência própria; barra de espaço liga/desliga) e campo de texto em pílula. Iniciativa (ESTRITO/EQUILIBRADO/FLEXÍVEL, agora com explicação), modo treinamento, documentos e sair foram para o menu (avatar). Os `data-testid` anteriores foram mantidos.
- **Frases de espera na voz**: reserva de frases por tipo de espera (dados, pesquisa externa, demora) sem nenhum fato ou número; nunca repete as duas últimas; só fala se a resposta passar de 0,9 s; o áudio da frase é guardado na primeira vez e reaproveitado (sem custo/atraso nas próximas); uma segunda frase ("ainda estou consultando…") só em espera longa; para ao chegar a resposta ou quando o gestor interrompe.

## Regras de venda e recebimento do Sankhya (13/10)
As regras que dizem o que é "venda" e "título a receber" deixaram de ser código e viraram **parâmetros com o padrão usual do Sankhya** (`lib/regras-sankhya.ts`): data que coloca a venda no mês (DTNEG ou DTFATUR), tipos de movimento (padrão `V`), status de nota (padrão `L`), valor do item (com ou sem desconto), operações excluídas, bonificação fora, empresas (CODEMP) e se provisões entram no contas a receber. Os valores são validados em formatos seguros (entram em definição de view, que não aceita parâmetros).
- Coluna nova `empresas.regras` (jsonb): **`db push` e depois `demo:setup`**.
- As views `vw_vendas_itens` e `vw_titulos_receber` são criadas sobre o espelho (mesmas colunas da demonstração, o que as métricas oficiais leem) depois de cada carga bem-sucedida de uma empresa Sankhya, e também ao salvar as regras.
- Dono, em Plataforma → empresa Sankhya → Base de dados → "Regras de venda e recebimento": editar e aplicar; "Conferir mês" mostra as vendas do mês divididas por movimento/status/bonificação e, se for informado o total que o cliente confia, **procura a combinação de regras que reproduz esse total** (a mais simples primeiro; o dono confirma qual faz sentido com o cliente).
- Rotas (dono): `GET/PUT /api/plataforma/empresas/:id/regras`, `POST /api/plataforma/empresas/:id/regras/diagnostico`. Só empresas com ERP Sankhya.
- Testes: `tests/regras.test.ts` (usa um esquema temporário no banco principal, não precisa de `SECOND_DATABASE_URL`).

## Sem assunto privilegiado: a IA consulta as tabelas copiadas (13/10)
Decisão do dono do produto: nenhuma pergunta (faturamento, por exemplo) é "oficial". Mudanças:
- **Espelho com nomes em minúsculas** (`tgfcab`, `nunota`…): a consulta livre só aceita nomes minúsculos. A origem continua lida com os nomes originais do ERP. Quem já tiver espelho com nomes em maiúsculas precisa de **carga completa depois de apagar as tabelas antigas** (ainda não há empresa real, então não há migração).
- **Ficha gerada do espelho** (`lib/ficha-espelho.ts`): cada tabela dos assuntos escolhidos é liberada à IA, descrita pelo dicionário do Sankhya (`lib/pacotes/sankhya-rotulos.ts`: rótulos de campo e o significado dos códigos, por exemplo STATUSNOTA L = Liberada; gerado só com nomes e rótulos, sem dados de cliente), mais as regras da empresa escritas como definições (as mesmas que criam as views).
- **Liberar**: Plataforma → empresa Sankhya → Base de dados → "Liberar a partir das tabelas copiadas" (`POST /api/plataforma/empresas/:id/liberar-do-espelho`) monta a ficha e roda as mesmas verificações de sempre. Salvar as regras atualiza as definições na ficha.
- **Atalhos opcionais**: `faturamento`, `produtos_mais_vendidos`, `consultar_vendas` e `contas_a_receber_vencidas` só são oferecidos ao roteador se a ficha da empresa listar as views `vw_vendas_itens` / `vw_titulos_receber` (a demonstração continua com eles). Essas views deixaram de ser exigidas para liberar uma empresa; o papel `erp_metric_reader` só é criado quando as duas existem.
- **Idade do dado** de tabelas copiadas vem de `espelho_controle` (hora da carga), lida com o mesmo papel restrito.
- Verificação aceita tabelas além de views. Testes: `tests/espelho-livre.test.ts` (cria um banco temporário `el_xxxx`; o usuário do banco precisa poder criar bancos).

## Agente de implantação (13/10)
Para qualquer ERP (inclusive os sem pacote pronto), um agente de IA lê **só a estrutura** do banco do cliente e propõe o que copiar. Nada é copiado até uma pessoa aprovar.
- **Leitura da estrutura** (`lib/descoberta.ts`): tabelas do esquema escolhido, colunas e tipos, chave primária (ou índice único sem nulos), quantidade estimada de linhas e chaves estrangeiras declaradas. Nenhum conteúdo é lido. A sessão é somente leitura (`abrirLeitura` em `lib/carga.ts`).
- **Regras em código, não no modelo** (`motivoDeIgnorar`, `colunasCopiaveis`, `tipoNoEspelho`): ficam de fora tabelas sem chave, sem nome simples em minúsculas, vazias ou com nome duplicado; colunas de senha/token/segredo e binárias/arrays nunca são copiadas; os tipos do espelho são decididos pelo tipo de origem; a coluna de alteração sugerida pelo modelo só vale se existir e for data/hora (senão entra um palpite por nome).
- **Agente em dois estágios** (`lib/agente-implantacao.ts`): (1) triagem barata, uma linha por tabela, escolhe as de negócio e descreve; (2) para as escolhidas, descreve cada coluna, indica a coluna de alteração e omite colunas inúteis. O dicionário do ERP (Sankhya) vence a descrição do modelo. O modelo é injetável (`usarModeloDeImplantacao`) para testes. Custo estimado: centavos a poucos dólares por banco, uma vez.
- **Fluxo** (`routes/implantacao.ts`, tela "Implantação assistida" na empresa): `POST .../implantacao/analisar` (segundo plano, estado em `empresas.proposta`), `GET .../implantacao`, `PUT .../implantacao/tabelas`, `POST .../implantacao/aprovar` (grava o pacote da empresa em `empresas.pacote` e o assunto único "geral"). A carga e o agendador usam `pacoteDaEmpresa` (pacote próprio, senão o do ERP). "Liberar a partir das tabelas copiadas" passou a valer para qualquer ERP; as descrições e as ligações entre tabelas vão para a ficha.
- Colunas novas em `empresas`: `pacote`, `proposta` (rodar `db push` e `demo:setup`).
- Tipos novos no espelho: `bigint`, `numeric`, `timestamptz`, `boolean`. Tabelas fora do esquema `public` são lidas com o esquema gravado no pacote.
- Ainda não existe: significado de códigos aprendido a partir de valores distintos (exigiria ler dados; ficaria opcional), leitores de Oracle e SQL Server, e uma coluna de alteração declarada à mão quando o agente não achar.

## Recebimento: o cliente envia os dados (13/10)
Quando o cliente (por exemplo, Sankhya hospedado) não libera acesso ao banco, o analista dele agenda uma rotina que **envia** os dados por HTTPS. Tipo de origem novo: `recebida`.
- **Chave de envio** (`lib/recebimento.ts`, `routes/ingestao.ts`): `POST /api/plataforma/empresas/:id/ingestao/chave` (só o dono) gera `tato_env_…`, grava apenas o SHA-256 (`empresas.ingestao_chave_hash`) e coloca a empresa no modo `recebida`; aparece uma vez. `.../ingestao/revogar` invalida. A chave só serve para enviar.
- **Porta pública** `/api/ingestao/*` (sem sessão; `app.ts` deixa passar e o próprio plugin exige `Authorization: Bearer`): `GET /estado` (tabelas, colunas, chave, coluna de alteração, `ultimaMarca`, `recebidoEm`) e `POST /tabelas/:tabela`. Bloqueio por endereço após 30 chaves erradas em 10 minutos.
- **Lote**: confere contra o pacote da empresa (tabelas dos assuntos escolhidos; colunas extras ignoradas e listadas; linha sem chave ou valor que a coluna não aceita recusa o lote inteiro, sem gravar nada). Incremental faz upsert; lote vazio renova o "atualizado em". Carga completa: vários lotes com o mesmo `carga`, gravados numa tabela `<tabela>__nova` e trocados de uma vez pelo lote `ultimo: true`; carga interrompida é descartada quando outra começa. Até 20.000 linhas por lote.
- **Mesmo espelho de sempre**: mesma gravação (`gravarLinhas`, extraída de `lib/carga.ts`), `espelho_controle` (idade do dado e tela de saúde), views de regras do Sankhya criadas no primeiro contato. O intervalo esperado de envio é `carga_intervalo_min`. `startLoad` e o agendador ignoram empresas `recebida`.
- **Tela**: empresa → "Receber dados enviados pelo cliente" (gera/revoga a chave, mostra o endereço e quando cada tabela chegou). Em "Origem dos dados" o campo de endereço e os botões de carga somem nesse modo.
- **Material do analista**: `docs/envio-de-dados/tato_envio.py` (rotina pronta para Oracle, SQL Server ou PostgreSQL, só com a biblioteca padrão do Python mais o driver) e o guia em Word. Testado de ponta a ponta contra uma cópia do Sankhya em SQLite.
- Colunas novas em `empresas`: `ingestao_chave_hash`, `ingestao_chave_inicio`, `ingestao_chave_em` (rodar `db push` e `demo:setup`). Não usar `push --force` para isto: não há restrição de unicidade de propósito, para o `drizzle-kit` não pedir que a tabela seja esvaziada.
- Ainda não existe: o agente de implantação não analisa empresas `recebida` (o cliente enviaria a estrutura); apenas pacotes já definidos (Sankhya, ou o aprovado para a empresa) são aceitos.
