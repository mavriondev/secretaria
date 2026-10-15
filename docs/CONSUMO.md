# Consumo por empresa e crédito dos provedores

O dono do produto acessa **Plataforma → Consumo**, em `/plataforma/consumo`.
Administradores e gestores de empresas não têm acesso a essa área; o consumo
próprio já disponível para o administrador continua no lugar.

O mês escolhido é um mês de calendário em **America/Sao_Paulo**, incluindo a
virada às 00:00 de Brasília. “Últimos 30 dias” inclui hoje e os 29 dias locais
anteriores. O valor mostrado vem exclusivamente de `custos_ia`, o mesmo razão
que alimenta os tetos, e inclui o multiplicador de priority já registrado.
Não é uma nova contabilidade nem uma leitura da fatura do provedor.

- Texto inclui modelo, reescrita e implantação; voz é síntese; transcrição é
  separada. Categorias futuras não conhecidas aparecem em “outros”.
- Perguntas contam respostas distintas com lançamento de texto vinculado.
  Usuários ativos são pessoas identificadas em chamadas pagas do período.
  Chamadas sem vínculo de resposta ou sem usuário continuam incluídas no gasto,
  mas não são inventadas nos denominadores. Se não há denominador, a média é
  exibida como indisponível, não zero.
- A retenção pode remover vínculos de respostas antigas; a exclusão de um
  usuário pode deixar chamadas sem usuário. Por isso as médias são baseadas
  nos vínculos identificáveis, não uma promessa de reconstrução de histórico
  que não existe mais.
- A projeção mensal é gasto até a consulta / dias decorridos × dias do mês,
  incluindo o dia atual; é uma estimativa, não previsão contratual.
- A plataforma tem teto **diário**. A tela compara hoje com esse teto, não
  compara um mês contra um teto de um dia. Nenhum teto foi alterado.
- CSV exporta somente empresa, período, categoria, USD e contagens. Nomes
  capazes de virar fórmula em planilha são neutralizados.

## Crédito estimado da OpenAI

A chave normal não fornece um saldo de créditos confiável. O dono informa
**crédito disponível na data de referência**, data e eventual limiar em USD.
“Atualizei o crédito” **substitui** a referência anterior, não soma uma recarga.

Saldo estimado = referência informada − razão OpenAI desde a data informada.
Inclui todos os tipos de gasto registrados com esse provedor, mas não gastos
fora desta plataforma. O dono deve conferir o valor com a conta/fatura real.

O limiar vazio usa o maior entre **US$ 10** e **7 × média diária OpenAI dos
últimos 30 dias**. Não informar crédito deixa o item como “não medido”, sem
inventar saldo ou enviar alerta de crédito esgotado.

## Assinatura ElevenLabs

Quando a credencial permite `GET /v1/user/subscription`, a tela mostra caracteres
usados / limite e data de renovação informada pelo provedor. Consultas têm
cache de cinco minutos. Alertas ocorrem em 80% (atenção) e 95% (crítico), com
resolução quando o uso cai após renovação/reposição.

Se a credencial não permite essa consulta, a tela informa indisponibilidade.
Não tenta converter o razão financeiro em caracteres disponíveis, não chama
isso de saldo real e não exige acesso adicional para o restante da tela funcionar.

## Erros consecutivos e alertas

Observação de transporte, sem alterar pedidos, retentativas, decisões ou
mensagens do assistente. `provedores_estado` guarda somente provedor, número
de recusas consecutivas, status HTTP e data; não guarda corpo de erro, chaves
ou conversas. Persiste entre reinícios.

`PROVEDOR_ERROS_SEGUIDOS` configura o limiar de 2 a 100, padrão 3. Uma chamada
bem-sucedida ou falha de outro tipo zera a sequência. OpenAI 429 só conta se
a classificação indicar cota/crédito, não um rate limit comum. 401/402 também
geram observação, mas o aviso diz “acesso ou cota”, não afirma sem prova que
o crédito acabou. No ElevenLabs são observadas síntese, transcrição HTTP e
pedido de token de transcrição; sondas de vozes/assinatura não zeram a sequência.
Erros de WebSocket recebidos diretamente pelo navegador não são medidos por
essa observação HTTP.

Ao cruzar o limiar ou recuperar, o transporte solicita uma verificação ao
monitor existente. Avisos vão ao dono pela caixa e pelo push quando há
assinatura, com deduplicação/transições e lembrete diário já existentes.
Consultas de assinatura não geram cobranças de síntese ou modelo.
