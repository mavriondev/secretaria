# Preparação local e medição da voz

Não confundir o estado “Conectando” da interface com uma conexão PostgreSQL.
Ele inclui preparação de áudio/classificador e conexão à transcrição.

## Comportamento

- O classificador é preparado após dois frames e um período ocioso da tela de voz.
- Esse preparo não solicita microfone nem abre WebSocket/provedor pago.
- Uma instância local é reaproveitada por tela. Só pesos/runtime são retidos:
  estado recorrente, contexto e amostras pendentes são limpos após a inferência
  terminar, ao encerrar a conversa e novamente antes da próxima.
- Sem uso, o recurso é fechado após cinco minutos. Desmontagem/logout/pagehide
  liberam o recurso e abortam preparações pendentes.
- Após o toque, worklet, preparação do classificador e configuração podem
  ocorrer em paralelo; a verificação de disponibilidade ainda antecede a
  aquisição do microfone. As autorizações e os tetos do servidor são preservados.
- Falhas de preparo em segundo plano não criam avisos; o próximo início explícito
  tenta novamente e apresenta a mensagem humanizada existente se falhar.

## Diagnóstico sem conteúdo

`performance.measure` publica entradas `voice:<fase>` no navegador.
Quando recebe `ready`, o cliente informa uma única coleção limitada de durações
numéricas pelo evento `startup_timing`; o servidor valida nomes/valores e escreve
`voiceStartupMs` no log. São dados declarados pelo cliente, não fonte de cobrança
nem prova de autorização. O servidor mede separadamente `upstreamMs`.
Nenhum texto, áudio, URL de provedor ou credencial integra esse diagnóstico.

`model_fetch` inclui o corpo do modelo. `wasm_download` vem de Resource Timing
quando o download ocorreu após o toque. `runtime_model_init` abrange o runtime
ORT e a criação da sessão/modelo; ORT não expõe um gancho público que isole
compilação WASM e carga do modelo. Não interpretar esse campo como compilação
pura. Preparação feita antes do toque aparece na timeline do navegador, mas
não deve ser somada à latência percebida depois do toque.

O buffer de medidas de cada fase é limitado. A precisão de p95 depende da
quantidade de amostras: poucos inícios dão evidência exploratória, não um SLA.

## Banco e carga

Nenhum índice, estatística, tabela, view, configuração PostgreSQL ou estratégia
de carga de cliente foi alterado por essa otimização. A carga continua com
DELETE + INSERT SELECT transacional. Recomendações dependem de aprovação
separada; criar índices apenas na `__nova` não os transfere à tabela publicada.

Reverter a versão pelo procedimento normal também reverte o preparo/reuso.
Não existe migração de banco vinculada a essa alteração.
