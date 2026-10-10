# Implantação de um novo cliente

A IA não conhece nenhum ERP. Ela lê **views** de um banco PostgreSQL e uma **ficha de implantação** que descreve essas views. Trocar de cliente ou de ERP é trocar o banco e a ficha; o código da IA não muda.

## Passo a passo

1. **Banco do cliente.** Peça ao responsável pelo ERP a exportação das tabelas necessárias e monte um PostgreSQL no mesmo molde. Registre de quando é a cópia.
2. **Views liberadas.** Crie uma view (somente leitura) para cada assunto que a IA poderá consultar (vendas, financeiro, frota, fiscal…). A view já deve aplicar o filtro de empresa e esconder o que não deve ser lido. A IA só enxerga as views da ficha.
3. **Esqueleto da ficha.** Gere-o do banco:
   `pnpm --filter @workspace/api-server run ficha:gerar -- --empresa "Nome do cliente" --prefixo vw_ --saida ficha.json`
4. **Preencher a ficha** (o sistema recusa iniciar enquanto houver campos `DESCREVER`):
   - `assunto` e `descricao` de cada view: o que representa uma linha.
   - `tipo` de cada coluna: `texto`, `texto_livre` (anotações digitadas por pessoas), `codigo`, `inteiro`, `numero`, `dinheiro`, `percentual`, `data`, `data_hora`, `booleano`.
   - Para `codigo`, o significado de cada valor em `valores` (por exemplo `"M": "em manutenção (defeito)"`). É a parte que mais importa: o erro mais comum de uma IA com consulta livre é de significado, não de SQL.
   - `atualizadoEm`: coluna com a data da carga, para a resposta dizer de quando é o dado.
   - `observacao`: regra que prevalece sobre a consulta livre (ex.: "o total oficial vem da ferramenta de faturamento").
   - `naoDisponivel`: assuntos que o cliente não tem; a IA diz que não existem em vez de tentar.
5. **Apontar e liberar o acesso.** Defina `FICHA_PATH=/caminho/ficha.json` e rode `pnpm --filter @workspace/api-server run db:access`. Isso concede ao papel `erp_free_reader` leitura apenas das views da ficha.
6. **Testar** com perguntas reais do gestor e conferir no log (`parameters._executions`) a consulta gerada e a interpretação usada.

## Como a segurança funciona (duas barreiras independentes)

| Barreira | O que faz |
|---|---|
| Validador de SQL (`sql-guard.ts`) | Uma única instrução, só `SELECT`, só views da ficha, só funções de uma lista permitida, sem `WITH RECURSIVE` nem `FOR UPDATE`. |
| Banco de dados | Transação somente leitura, papel `erp_free_reader` com `SELECT` apenas nas views da ficha, `statement_timeout` de 5 s, no máximo 200 linhas. |

Mesmo que o modelo escreva algo errado, o banco não deixa ler outra tabela nem escrever.

## Regras de comportamento (decididas com o dono do produto)

- **Objetiva por padrão.** A resposta traz o que foi perguntado. Não cruza assuntos por conta própria; no nível 2 pode terminar com **uma** pergunta curta oferecendo mais, e o gestor decide.
- **Número só vem do resultado da consulta.** O modelo escreve o texto com marcadores `{{id}}`; valores, datas e nomes são preenchidos pelo código. Texto com número solto é descartado e a resposta determinística entra no lugar.
- **Textos livres do banco são dados**, nunca instruções.
- **A resposta diz de quando é o dado** (coluna `atualizadoEm`).
- Métricas oficiais (faturamento, recebíveis vencidos, produtos mais vendidos) continuam com ferramentas próprias e definição fechada.

## Limites conhecidos

- A consulta livre é de **um passo**, com até 2 correções automáticas se a consulta falhar. Ela não encadeia várias consultas observando cada resultado.
- Uma ficha grande aumenta o contexto enviado ao modelo (custo). Para muitos assuntos, vale enviar só as views do assunto da pergunta.
- Isolamento entre empresas: hoje a view filtra uma empresa (`ERP_CONFIG.companyCode`). Para vários clientes na mesma hospedagem, use um banco ou esquema por cliente, com `FICHA_PATH` e papéis próprios.
