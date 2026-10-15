# Retenção do histórico

O Tato guarda o histórico de conversas por **90 dias**. A rotina diária roda às
**03:30, horário de São Paulo**, dentro do serviço da API, mesmo sem acessos.
Se o servidor estiver desligado nesse horário, executa após voltar, a partir
das 03:30 do dia. Uma falha permite nova tentativa após uma hora.

O responsável pode mudar o prazo sem alterar código: na configuração da
instalação, `HISTORICO_RETENCAO_DIAS=90`. São aceitos inteiros entre 7 e 36500
dias. Reinicie a API depois de mudar a configuração. Valor inválido **não**
dispara exclusões; aparece como erro na verificação de saúde.

## O que sai

- Perguntas digitadas ou transcritas, respostas, parâmetros, SQL gerado e
  resultados guardados em `query_logs` com mais de N dias.
- Metadados dos documentos exportados que vencem ou dependem das respostas
  apagadas; o documento é gerado a partir da resposta, não há arquivo de áudio
  ou documento permanente para apagar.
- Textos de resultados de testes concluídos antigos. As definições de perguntas
  de teste e os totais/custos das execuções são preservados.
- Apenas o texto livre antigo das avaliações: motivo e tratativa. O registro,
  usuário, voto/status e data permanecem. Motivo editado e tratativa recente
  têm seu próprio prazo; não são apagados só porque a resposta era antiga.
- Notificações antigas **lidas**, exceto as de sistema.
- Sessões já expiradas e links de redefinição expirados há mais de um dia,
  mantendo o expurgo oportunista existente.

## O que fica

Usuários, empresas, sessões válidas, favoritos (incluindo pergunta, SQL,
parâmetros e resultado fixo salvo), regras de avisos, preferências, conhecimento
ensinado, perguntas de teste, configurações e dados de envio não são apagados.
Razão de custos, tetos, eventos de teto, alertas/notificações do sistema e totais
agregados são preservados. A ligação de um custo/favorito com uma resposta
apagada fica vazia, mas o gasto e a consulta salva continuam disponíveis.
O banco da empresa não é aberto por esta rotina.

O prazo vale para o **histórico**, não para conteúdo salvo explicitamente como
favorito, conhecimento ou configuração. Para remover esse conteúdo, use sua
tela própria. Avaliações de respostas removidas continuam mostrando o status,
sem recuperar texto antigo.

## Diagnóstico e alertas

Em **Plataforma → Diagnóstico → Retenção do histórico**, o dono vê o prazo, o
horário, a última tentativa, a última conclusão, a situação e contagens (nunca
conteúdo). Contagens são da última tentativa, incluindo lotes já concluídos
antes de uma falha. A saúde do sistema avisa pelos mecanismos existentes se a
rotina falhar ou estiver há mais de 36 horas sem concluir; antes da primeira
execução também pede atenção. O monitor precisa do serviço funcionando.

## Operação segura

Dentro do código instalado, com o ambiente da aplicação carregado pelo
administrador (não copie configurações secretas para relatórios):

```sh
pnpm --filter @workspace/api-server historico:limpar --ensaio
pnpm --filter @workspace/api-server historico:limpar --executar
```

O ensaio é uma transação somente leitura e retorna apenas contagens. A
execução real usa lotes de até 200 registros, transações curtas, tempo limite
de bloqueio e de consulta, e trava consultiva contra execuções simultâneas.
Não executa `VACUUM FULL` nem espera redução imediata do arquivo do banco:
o PostgreSQL reaproveita o espaço depois da limpeza/autovacuum.

Antes da primeira execução: ensaio, backup da plataforma, ativação e conferência.
Para interromper novas limpezas, use `HISTORICO_LIMPEZA_AGENDADOR=off` e reinicie.
O rollback normal reverte **código**, não recria dados já apagados. Recuperar
dados de um backup exige uma restauração separada e pode perder alterações
posteriores; nunca restaure automaticamente em cima da plataforma.

Backups já feitos mantêm o conteúdo antigo até sua rotação: **7 diários,
4 semanais e 6 mensais**. A limpeza não reescreve nem elimina backups existentes.
