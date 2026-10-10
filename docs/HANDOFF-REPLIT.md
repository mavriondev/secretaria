# Roteiro para atualizar o Replit (branch `claude/ajustes-secretaria`)

## O que mudou
1. **Consulta livre guardada** (`consultar_dados`): o modelo escreve um `SELECT` a partir da pergunta, sobre as views da **ficha de implantação**. Validador estático (`sql-guard.ts`) + banco somente leitura (`free-query.ts`, papel `erp_free_reader`).
2. **Ficha de implantação** (`ficha.ts`, `ficha-gerar.ts`, script `ficha:gerar`): descreve views, colunas e significado dos códigos. A IA não depende de nenhum ERP.
3. **Fatos a partir das linhas** (`free-facts.ts`): valores, datas e nomes formatados pelo código; o modelo só usa marcadores. **Composição objetiva** (`free-turn.ts`): uma chamada no máximo, validador e resposta determinística de reserva; nível 0 e "conciso" não chamam o modelo.
4. **Reparo limitado**: se a consulta falha, até 2 correções pelo modelo; tudo fica no log.
5. **Dados de demonstração de frota** (3 tabelas, 3 views), carregados por `demo:setup`.
6. Já na branch desde o primeiro commit: `comparar_com` do faturamento (provisório), filtro de empresa em `vw_titulos_receber`, correção do `acceptsSuggestion`, alerta de custo por turno (`TURN_COST_ALERT_USD`).

## Comandos depois de puxar a branch
```
pnpm install
pnpm --filter @workspace/db run push        # cria frota_*, coluna TGFFIN.CODEMP
pnpm --filter @workspace/api-server run demo:setup   # carrega frota e views, concede o papel erp_free_reader
pnpm --filter @workspace/api-server run test          # 100+ testes (precisam de DATABASE_URL)
```
Variáveis opcionais: `FICHA_PATH` (ficha do cliente; sem ela vale a de demonstração), `TURN_COST_ALERT_USD` (padrão 0,08).

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
