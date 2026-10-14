# Tato — API de envio de dados do cliente

## Escopo e segurança

API de integração para o técnico que envia os dados do cliente. Não é a API completa administrativa do Tato.
Base oficial: https://187.77.232.164/tato/api
O envio usa JSON por HTTPS, não anexos CSV/Excel. A chave identifica a empresa; não envie empresaId nem CODEMP como identificador do Tato. CODEMP é um dado do Sankhya.
Nunca coloque uma chave real em documentação, GitHub ou arquivos compartilhados. Não entregue senha de dono ao cliente. Use um ambiente de teste isolado para amostras, não dados fictícios numa base real.
Arquivos do kit: tato-insomnia.json (importação), envio.openapi.json (OpenAPI 3.0), sankhya-contrato.json (pacote padrão, sem dados).
Os módulos atuais do pacote Sankhya são Vendas e Contas a receber (ID técnico financeiro). Não são todos os módulos do ERP. Ver dados de TGFFIN não significa que contas a pagar tenha sido homologado.

## Antes de usar

O dono precisa cadastrar a empresa correta, preparar um banco PostgreSQL separado acessível pelo Tato, selecionar os assuntos e gerar uma chave em Recebimento. Isso muda a origem para envio REST. A empresa precisa estar ativa.
Cadastrar um endereço não cria o banco automaticamente. A tela Base de dados exige ficha válida e estruturas verificáveis: só salva a conexão quando a verificação passa. Uma empresa nova com banco vazio precisa de preparação técnica das estruturas/ficha antes do envio; gerar chave não resolve esse passo. Não use a base de demonstração.
Nenhuma chave ou base da JM Forros é criada ao baixar este kit.
O estado prepara as tabelas de recebimento conforme o pacote, mas só consegue fazê-lo quando o banco destino já está cadastrado. Só após conferência/liberação a IA deve ser usada. Recebimento e verificação estrutural não comprovam conciliação financeira ou completude do ERP.

## Importar no Insomnia

1. Import → File → tato-insomnia.json (formato Insomnia JSON v4).
2. Em Manage Environments, api_url já tem a VPS oficial. Preencha chave_envio APENAS no seu ambiente local.
3. Envie Saúde pública e depois Contrato e estado. Guarde o contrato retornado para o técnico.
4. Os pedidos POST usam envio_url, que começa com https://envio-desativado.invalid/tato/api: gravações estão bloqueadas por padrão.
5. Só depois de preparar a base de teste, substitua envio_url pela URL aprovada, escolha uma tabela do contrato e preencha o corpo com dados controlados. As chaves iniciam nulas e precisam ser preenchidas.
6. Execute cada pedido manualmente. Não rode a coleção inteira: ela contém exemplos alternativos, inclusive carga completa que substitui tabelas.
7. Não exporte/sincronize a coleção com chave preenchida. Se ela vazar, o dono deve revogar/rotacionar a chave.
Não desative validação TLS como configuração permanente. Se houver erro de certificado, confira endereço, relógio e certificado antes de enviar dados.

## Autenticação

Authorization: Bearer SUA_CHAVE
Content-Type: application/json
A chave tato_env_… dá acesso somente ao contrato e envio daquela empresa. Não exige login/cookies do painel. Chave revogada, incorreta, empresa inativa ou fora do modo recebida retorna 401. Não altere empresaId para tentar escolher outra empresa: quem escolhe é a chave.

## GET /healthz — servidor

Não exige autenticação. Resposta 200 com status e versão. Exemplo: {"status":"ok","versao":"SHA_DO_COMMIT"}.
Servidor ativo não significa cliente preparado, dados recebidos ou IA liberada.

## GET /ingestao/estado — contrato

Exige chave. Retorna limitePorLote e tabelas, cada uma com tabela, chave (colunas que identificam a linha), colunaDeAlteracao, colunas (nome/tipo), linhas, ultimaMarca e recebidoEm.
Exemplo de estrutura:
{
  "limitePorLote": 20000,
  "tabelas": [
    {
      "tabela": "TSIEMP",
      "chave": [
        "CODEMP"
      ],
      "colunaDeAlteracao": null,
      "colunas": [
        {
          "nome": "CODEMP",
          "tipo": "bigint"
        },
        {
          "nome": "NOMEFANTASIA",
          "tipo": "text"
        },
        {
          "nome": "RAZAOSOCIAL",
          "tipo": "text"
        }
      ],
      "linhas": 0,
      "ultimaMarca": null,
      "recebidoEm": null
    }
  ]
}

O exemplo não é o catálogo completo. O retorno autenticado é a fonte de verdade: inclui somente assuntos selecionados e pode refletir um pacote personalizado.
Esta consulta pode criar tabelas e estruturas auxiliares no destino. Não importa dados do ERP nem gera uma nova chave.
ultimaMarca é a maior alteração já presente, quando existe colunaDeAlteracao. Não é um token de paginação nem prova de carga completa. recebidoEm registra carga completa efetivada ou lote incremental, inclusive vazio.

## POST /ingestao/tabelas/{tabela} — incremental

Envie uma tabela por chamada. Nome e colunas são comparados sem distinção de maiúsculas/minúsculas.
Exemplo apenas em BASE ISOLADA, dados fictícios:
{
  "modo": "incremental",
  "linhas": [
    {
      "CODEMP": 900001,
      "NOMEFANTASIA": "EMPRESA FICTICIA DE TESTE",
      "RAZAOSOCIAL": "EXEMPLO — NAO USAR EM PRODUCAO"
    }
  ]
}

Destino do exemplo: /ingestao/tabelas/TSIEMP.
Cada chave nova insere; chave existente substitui os campos da linha enviados ao banco. NÃO é atualização parcial: colunas do contrato omitidas viram NULL. Envie todos os campos necessários da linha.
Chaves não podem estar nulas/ausentes. Chaves repetidas dentro de um lote: última linha vence. Campos extras são ignorados e aparecem em colunasIgnoradas; trate esse retorno como alerta de mapeamento.
Valores aceitos: texto, número, booleano ou null. Objetos/arrays dentro de colunas são rejeitados. Use ponto decimal e datas ISO (YYYY-MM-DD; timestamp conforme tipo do contrato). Campos numéricos/data vazios viram null; erros de conversão rejeitam o lote.
Incremental não remove linhas excluídas no ERP. Lista vazia atualiza a marca de recebimento, mas não comprova que há dados. Omitir modo usa incremental.

## Carga completa — atenção à substituição

Use modo=completa, carga com ID único de 4 a 64 letras/números/-/_, e ultimo=false nos lotes intermediários. Use o MESMO ID para todos os lotes de uma tabela naquela carga.
Exemplo de primeiro lote: {"modo":"completa","carga":"snapshot-20261013-001","ultimo":false,"linhas":[...]}
Último lote: mesmo ID, ultimo=true e as linhas finais. Em carga de um único lote, envie ultimo=true desde o início.
Os lotes são acumulados numa tabela temporária. A tabela publicada é SUBSTITUÍDA quando ultimo=true. Linhas ausentes na nova carga desaparecem. Uma completa vazia pode esvaziar a tabela.
Novo ID descarta a carga incompleta anterior da mesma tabela. Não misture IDs/rotinas e não repita automaticamente a finalização: depois de concluída, repetir só o último lote pode iniciar outra carga e substituir pelos dados daquele lote.
A publicação é transacional por tabela, NÃO simultânea entre todas as tabelas. Não mande uma amostra ou um período menor em completa sobre uma base real sem aprovar a substituição e o escopo.

## Limites e resposta

Máximo de 20.000 linhas por lote e 15 × 1024 × 1024 bytes (15 MiB) no corpo do POST. Divida lotes antes de ultrapassar qualquer limite.
Resposta aceita: {"ok":true,"tabela":"TSIEMP","modo":"incremental","recebidas":1,"gravadas":1,"concluida":true}
Em completa intermediária: concluida=false, apesar de HTTP 200. Só considere a tabela publicada quando concluida=true. gravadas reflete chaves únicas do lote, não a conciliação da extração.
O lote falho é revertido; lotes completos já acumulados anteriormente não são todos apagados por um erro no lote atual.
Código | Significado
400 | JSON/formato inválido ou ID carga inválido/ausente em completa.
401 | Chave inválida, revogada, empresa inativa ou não configurada para receber.
404 | Tabela não pertence aos assuntos do contrato.
409 | Banco destino, pacote ou assuntos ainda não preparados.
413 | Corpo maior que 15 MiB ou mais de 20 mil linhas.
422 | Valor inválido, chave de linha ausente ou erro ao gravar o lote.
429 | Muitas tentativas de chave inválida pelo mesmo IP (limite de 30 falhas na janela de 10 minutos).
500/503 | Falha inesperada/infraestrutura; registrar horário e mensagem e investigar.
Erros de aplicação usam {"error":"mensagem"}. Validação do framework pode adicionar campos como statusCode/code/message. Não retente 4xx sem corrigir. Em falha de rede, concilie estado antes de repetir uma finalização completa.

## Pacote Sankhya e conferência

O catálogo abaixo é gerado do código, não digitado à mão. O contrato autenticado da empresa sempre prevalece.
Vendas (ID vendas): TGFCAB, TGFITE, TGFTOP, TGFTPV, TGFPAR, TGFPRO, TGFGRU, TGFVEN, TSIEMP, TSICUS
Contas a receber (ID financeiro): TGFFIN, TGFNAT, TGFPAR, TSIEMP, TSICUS
Defina com o técnico CODEMP(s), período e filtros. Para notas do período, inclua itens e cadastros relacionados, não só TGFCAB. Preserve chaves compostas, incluindo horários quando fazem parte da chave.
Depois do envio: confira contagens, relacionamentos, soma/valores no Sankhya, regras de venda e títulos antes da IA. Recebimentos registrados são evidência de transporte, não homologação do conteúdo.
O padrão Vendas cobre notas/itens e cadastros relacionados; Contas a receber cobre títulos. Outros assuntos não estão habilitados apenas por existir módulo no ERP.

## Gestão da chave — somente dono

Use preferencialmente o painel → empresa → Recebimento. A API administrativa usa sessão/cookie de dono (obtido no login do painel), NÃO o Bearer de envio.
GET /plataforma/empresas/{id}/ingestao: ativa, prefixo, geradaEm, recebimentos. Não devolve chave completa.
POST /plataforma/empresas/{id}/ingestao/chave: corpo {"intervaloMin":60}; intervalo opcional, inteiro de 5 a 10080. Retorna chave, prefixo e aviso. Gera chave, invalida a anterior e muda a empresa para REST. Chave só é exibida nessa resposta.
POST /plataforma/empresas/{id}/ingestao/revogar: revoga a chave atual. O cliente para de enviar.
Estas ações são administrativas e por isso não estão na coleção destinada ao cliente. Nunca compartilhe uma sessão de dono para ele gerar sua própria chave.
Rotação/revogação afeta integrações em uso e precisa ser combinada com o técnico. Intervalo esperado não cria um agendamento no computador do cliente: o técnico agenda a rotina do lado dele.

## Referência de colunas — padrão Sankhya

### TGFCAB
Chave: NUNOTA. Alteração: DTALTER.

| Coluna | Tipo |
|---|---|
| NUNOTA | bigint |
| NUMNOTA | bigint |
| CODEMP | bigint |
| CODPARC | bigint |
| CODVEND | bigint |
| CODTIPOPER | bigint |
| DHTIPOPER | timestamp |
| TIPMOV | text |
| STATUSNOTA | text |
| STATUSNFE | text |
| DTNEG | date |
| DTFATUR | timestamp |
| DTENTSAI | date |
| DTALTER | timestamp |
| VLRNOTA | numeric(18,4) |
| VLRDESCTOT | numeric(18,4) |
| VLRDESCTOTITEM | numeric(18,4) |
| CODTIPVENDA | bigint |
| CODNAT | bigint |
| CODCENCUS | bigint |
| PENDENTE | text |
| APROVADO | text |

### TGFITE
Chave: NUNOTA, SEQUENCIA. Alteração: DTALTER.

| Coluna | Tipo |
|---|---|
| NUNOTA | bigint |
| SEQUENCIA | bigint |
| CODPROD | bigint |
| CODEMP | bigint |
| CODVEND | bigint |
| QTDNEG | numeric(18,4) |
| VLRUNIT | numeric(18,4) |
| VLRTOT | numeric(18,4) |
| VLRDESC | numeric(18,4) |
| VLRREPRED | numeric(18,4) |
| VLRSUBST | numeric(18,4) |
| VLRIPI | numeric(18,4) |
| ATUALESTOQUE | bigint |
| PENDENTE | text |
| CODVOL | text |
| USOPROD | text |
| STATUSNOTA | text |
| DTALTER | timestamp |

### TGFTOP
Chave: CODTIPOPER, DHALTER. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODTIPOPER | bigint |
| DHALTER | timestamp |
| DESCROPER | text |
| TIPMOV | text |
| ATIVO | text |
| ATUALEST | text |
| ATUALFIN | bigint |
| TIPATUALFIN | text |
| NFE | text |
| GOLSINAL | bigint |
| BONIFICACAO | text |

### TGFTPV
Chave: CODTIPVENDA. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODTIPVENDA | bigint |
| DESCRTIPVENDA | text |
| ATIVO | text |

### TGFVEN
Chave: CODVEND. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODVEND | bigint |
| APELIDO | text |
| ATIVO | text |
| TIPVEND | text |
| CODPARC | bigint |
| CODGER | bigint |
| CODEMP | bigint |

### TGFPAR
Chave: CODPARC. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODPARC | bigint |
| NOMEPARC | text |
| RAZAOSOCIAL | text |
| CGC_CPF | text |
| TIPPESSOA | text |
| CLIENTE | text |
| FORNECEDOR | text |
| VENDEDOR | text |
| ATIVO | text |
| CODVEND | bigint |
| CODCID | bigint |

### TGFPRO
Chave: CODPROD. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODPROD | bigint |
| DESCRPROD | text |
| CODGRUPOPROD | bigint |
| ATIVO | text |
| CODVOL | text |
| MARCA | text |
| USOPROD | text |
| REFERENCIA | text |

### TGFGRU
Chave: CODGRUPOPROD. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODGRUPOPROD | bigint |
| DESCRGRUPOPROD | text |
| ANALITICO | text |
| CODGRUPAI | bigint |

### TSIEMP
Chave: CODEMP. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODEMP | bigint |
| NOMEFANTASIA | text |
| RAZAOSOCIAL | text |

### TSICUS
Chave: CODCENCUS. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODCENCUS | bigint |
| DESCRCENCUS | text |
| ATIVO | text |
| ANALITICO | text |

### TGFFIN
Chave: NUFIN. Alteração: DTALTER.

| Coluna | Tipo |
|---|---|
| NUFIN | bigint |
| NUNOTA | bigint |
| CODEMP | bigint |
| CODPARC | bigint |
| CODVEND | bigint |
| CODNAT | bigint |
| CODCENCUS | bigint |
| CODTIPTIT | bigint |
| CODBCO | bigint |
| CODTIPOPER | bigint |
| DTNEG | date |
| DTVENC | date |
| DTVENCINIC | timestamp |
| DHBAIXA | date |
| DTALTER | timestamp |
| VLRDESDOB | numeric(18,4) |
| VLRBAIXA | numeric(18,4) |
| VLRJURO | numeric(18,4) |
| VLRMULTA | numeric(18,4) |
| VLRDESC | numeric(18,4) |
| RECDESP | bigint |
| PROVISAO | text |
| ORIGEM | text |
| NUMNOTA | bigint |
| NUMDUPL | bigint |
| HISTORICO | text |
| DHMOV | timestamp |

### TGFNAT
Chave: CODNAT. Alteração: nenhuma.

| Coluna | Tipo |
|---|---|
| CODNAT | bigint |
| DESCRNAT | text |
| ANALITICA | text |
| ATIVA | text |
