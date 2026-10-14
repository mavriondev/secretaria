# Assistente de Voz para ERP — prova de conceito

## Instalação pública

O Tato está em **https://www.oitato.com.br/**, com login na raiz e API em `/api/`.
`https://oitato.com.br/` redireciona para esse endereço. A API de envio mantém compatibilidade no IP
antigo até a atualização dos clientes. Links compartilháveis usam `VITE_PUBLIC_APP_URL` na compilação;
na VPS, `LISTEN_HOST=127.0.0.1` mantém a porta 5004 acessível apenas pelo Nginx.
Veja `docs/vps/DOMINIO.md` para HTTPS/PWA e `docs/vps/EMAIL.md` para a caixa de contato.

## Acessos e preferências

- **Login e empresas.** Todo acesso exige e-mail e senha (sessão por cookie, senha com scrypt, limite de tentativas).
  Há três perfis: **dono do produto** (cadastra empresas em `/plataforma`, escolhe o ERP e cria o primeiro
  administrador, com senha temporária mostrada uma vez), **administrador** da empresa (`/admin`, cria usuários em
  `/admin/usuarios`) e **gestor** (só `/usuario`). Conhecimento, preferências, logs e documentos são separados por empresa.
  Uma empresa nova nasce **sem base de dados conectada** e o assistente recusa perguntas para ela (nunca usa os dados da
  demonstração). Ligar o banco e a ficha de cada empresa é a próxima etapa. A empresa 1 é a demonstração.
  Primeiras contas: `pnpm --filter @workspace/api-server run usuario:criar -- dono voce@exemplo.com "Seu Nome"` e
  `... -- administrador gestor@empresa.com "Nome" 1` (imprime uma senha temporária, trocada no primeiro acesso).
- `/`: para o administrador, home com entradas **Usuário** e **Administrativo**.
- `/usuario`: somente conversa atual, microfone contínuo, níveis ESTRITO / EQUILIBRADO /
  FLEXÍVEL, texto opcional e documentos no menu. Não expõe SQL ou diagnósticos técnicos.
- `/admin`: nome de tratamento, voz Feminina (`marin`) ou Masculina (`cedar`) e opção de
  falar durante a consulta. Preferências persistem no banco e são lidas em cada turno.
  Conferência e auditoria continuam em `/admin/conferencia` e `/admin/logs`, com os
  inspetores de cálculo. Os antigos caminhos redirecionam para essas páginas.
- A fala curta de consulta varia entre confirmações breves sem valores ou conclusões financeiras.
  Seu TTS usa a API própria da OpenAI em paralelo à consulta; acrescenta consumo
  de áudio. Pode ser desligada e é cancelada com o turno. Tem limite de geração
  de 3,5 segundos e é cancelada assim que a resposta útil fica pronta; falha de TTS nessa frase não descarta uma resposta calculada.
- Documentos são **CSV**: pelo menu após uma consulta, ou pedindo “exporte essa consulta”.
  Perguntas que já solicitam métrica e CSV também geram uma exportação. O download
  reconstrói o CSV do resultado SQL auditado original, não recalcula um período
  histórico nem salva arquivos. Somente metadados/referência ficam no banco.
  Os valores estão em português brasileiro e células são protegidas contra fórmulas.
  Não há exportação PDF/XLSX nesta etapa; pedidos desses formatos recebem aviso.


Aplicação com uma empresa fictícia de demonstração e sem integração com o Sankhya real.
O escopo implementado é a etapa 1: conversa por texto/voz, conferência e logs.

## Stack e execução local

- React + TypeScript + Vite em `artifacts/erp-voice-assistant`.
- Node.js + TypeScript + Fastify em `artifacts/api-server`.
- PostgreSQL; tabelas raw e metadados em `lib/db`.
- API **direta da OpenAI**, sem intermediário de IA. A chave fica somente no servidor.

Requer Node.js 24, pnpm 10 e PostgreSQL. Instale com `pnpm install`.
Forneça `DATABASE_URL` e `OPENAI_API_KEY` no gerenciador de secrets do ambiente.
Os modelos e voz são configuráveis pelas variáveis em
`artifacts/api-server/.env.example`. Nunca coloque chaves em arquivos versionados.

```sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run demo:setup
pnpm --filter @workspace/api-server run test:metrics
PORT=3001 pnpm --filter @workspace/api-server run dev
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/erp-voice-assistant run dev
```

O frontend chama `/api`; em outro ambiente, o reverse proxy deve encaminhar
`/api/*` ao Fastify e as demais rotas ao frontend. O microfone exige HTTPS ou localhost.
O seed é idempotente e **não apaga dados nem histórico**. O setup cria as views
e uma role restrita; exige permissão de criação de role no PostgreSQL.

## Dados e cálculos

Há 40 parceiros, 60 produtos, 8 vendedores, 1.505 notas e aproximadamente
seis meses de vendas. O seed usa aritmética determinística em centavos.
As primeiras datas contêm pequenos cenários com valores conhecidos para testes
independentes: faturamento **455,00**, vencidos **650,00** e ranking
**225,00 / 180,00 / 50,00**.

`lib/db/src/erp-config.ts` centraliza tabelas, campos e filtros Sankhya de exemplo.
Os códigos `TIPMOV = V`, `STATUSNOTA = L` e `RECDESP = 1` **precisam ser
validados com o ERP de um cliente real** antes de qualquer integração.

- `vw_vendas_itens`: vendas confirmadas da empresa 1, joins de parceiro,
  produto e vendedor, valor líquido `VLRTOT - VLRDESC`.
- `vw_titulos_receber`: títulos de receita com cliente, vencimento, valor e baixa.
- Todas as consultas de métricas passam por uma transação `READ ONLY` e
  `SET LOCAL ROLE erp_metric_reader`. Essa role tem `SELECT` apenas nas duas views,
  sem acesso às tabelas raw, logs ou escrita. A conexão administrativa é usada
  separadamente para carregar seed e registrar logs.
- As métricas usam SQL fixo, parâmetros vinculados e timeout de cinco segundos.
  A IA não recebe credenciais do banco, não gera SQL e não calcula números.
- Datas de negócio são strings `AAAA-MM-DD` na API; períodos são inclusivos,
  resolvidos pelo backend em `America/Sao_Paulo`. Semana começa na segunda-feira.
  Comparação anterior tem o mesmo número de dias imediatamente antes do período;
  uma consulta diária também compara com o mesmo dia da semana anterior.
- Recebíveis: sem baixa e vencimento **anterior**, não igual, à referência.
  Ranking de produtos: por valor líquido, com quantidade; `value` é o valor do líder.

## IA e nível de liberdade

O modelo escolhe até três ferramentas tipadas por turno: métricas, vendas agrupadas
por mês/cliente/produto/vendedor, pesquisa pública ou conversa/esclarecimento.
O backend calcula os fatos internos e gera a resposta financeira diretamente,
sem outra chamada de IA apenas para reescrever números. Últimos N meses admitem
meses completos, inclusão do mês atual ou janela móvel, com datas explícitas.
O total e a distribuição mensal usam o mesmo snapshot SQL somente leitura.
Perguntas externas usam a OpenAI própria com busca web e citações; USD/BRL usa
a PTAX oficial do Banco Central, identificada como referência, não preço ao vivo.
Falhas de pesquisa são explícitas e nunca substituídas por cotações inventadas.
Fontes e execuções são registradas nos parâmetros da auditoria, e links aparecem
na conversa. A estimativa antiga de tokens não inclui tarifas de busca ou áudio.

- **0:** resposta base objetiva.
- **1:** base e um comentário factual.
- **2:** base, comentário e proposta curta de próximo passo.

## Conversa ao vivo

A entrada passa por classificação neural Silero local antes de abrir um turno.
Modelo e WASM vêm das dependências, carregados apenas ao iniciar voz; nenhum áudio
é enviado a esse classificador fora do navegador. O detector exige maior confiança
para interromper uma reprodução. Se não puder iniciar, mostra erro, não retorna
silenciosamente a um limiar de volume. Cancelamento de eco depende também do
microfone/navegador; não há garantia de separar toda voz de televisão/ambiente.

Toque no microfone para **Iniciar conversa** e permitir microfone e som. Depois,
faça perguntas sem enviar cada áudio: a sessão detecta fala contínua e uma pausa
de aproximadamente 900 ms. Toque novamente para encerrar. Enquanto o assistente
fala, voltar a falar interrompe a reprodução; também há um controle Cancelar fala.
O modo texto permanece disponível fora da sessão de voz.

O navegador envia PCM mono de 24 kHz em pacotes de 100 ms por WebSocket ao backend.
O backend usa a sessão de transcrição Realtime com o **mesmo gpt-transcribe**
configurado; esse modelo transcreve após o commit do turno. A métrica e a redação
continuam usando Responses API/gpt-6.1-sol, com fatos e placeholders validados.
Somente esse texto aprovado vai ao TTS. PCM da OpenAI é encaminhado assim que
chega e reproduzido progressivamente, sem esperar a geração do arquivo inteiro.
Não há fala financeira livre de um modelo Realtime contornando a validação SQL.

A interface mede até o primeiro áudio programado para reprodução após o fim da
fala detectado (após a pausa), incluindo rede, transcrição, SQL, redação e TTS. Essa espera não é zero e
depende da rede/modelo. A duração de geração é registrada sem bytes de áudio.
Use preferencialmente Chrome/Edge atuais; Web Audio, permissão do microfone,
HTTPS e políticas de áudio do navegador são necessários. AudioWorklet é preferido;
se não carregar em 2,5 segundos, há captura compatível por ScriptProcessorNode,
com aviso visível e exatamente o mesmo protocolo PCM/streaming, sem MediaRecorder.
ScriptProcessorNode é legado; esse caminho pode ser mais sensível a carga na UI.
Todo o início da sessão tem timeout de 30 segundos e libera recursos ao falhar.
Cancelamento de eco
está habilitado, mas ruído ambiente e alto-falantes variam; fones ajudam.

### Limites e retenção

- Máximo de cinco minutos por sessão, quatro sessões simultâneas por processo,
  30 segundos por pergunta e encerramento após 60 segundos de inatividade.
  Trocar para uma aba oculta, sair da página ou encerrar libera o microfone.
- Contexto de até quatro consultas concluídas permite referências como
  “e no mês passado?”. É temporário, expira ao encerrar e não carrega o histórico
  inteiro. Sem referência inequívoca, o assistente pede a métrica/período.
- **Nenhum áudio é salvo** em banco, arquivos, storage ou cache persistente do
  navegador. Há somente buffers transitórios limitados para captura/reprodução;
  até 300 ms de pré-fala e até 60 segundos de saída enfileirada, descartados ao
  interromper/encerrar. Não existem players de gravações históricas.
- Logs textuais já existentes permanecem após reload: pergunta/transcrição,
  resposta, parâmetros e cálculo. Sessão e áudio não são retomados automaticamente.
- `store: false` é usado nas chamadas Responses. Isso não é uma garantia de
  retenção zero de áudio/dados pela OpenAI: políticas e controles do provedor
  precisam ser avaliados separadamente antes de usar dados reais.
- Voz e transcrição (ElevenLabs) e texto (OpenAI) são registrados por chamada em
  `custos_ia`, por empresa e pessoa, e entram nos limites diário e mensal.
  O acesso exige login (dono, administrador, gestor), com sessão e empresa por pessoa.

Os endpoints antigos de transcrição/TTS por solicitação continuam compatíveis
para consumidores existentes, mas a interface usa a conversa contínua, sem arquivos.
Conversa geral, esclarecimentos e pesquisas públicas têm tipo de resposta registrado;
campos privados ausentes no ERP não são preenchidos com dados da internet.
Os logs incluem pergunta/transcrição, função, parâmetros, JSON do resultado,
resposta, liberdade, latência, tokens e estimativa de custo de **texto**;
os custos de voz e transcrição ficam em `custos_ia` (tela Custo e tempo e limites).
As tarifas são configuráveis.

## Verificação

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/erp-voice-assistant run typecheck
pnpm --filter @workspace/api-server run test:metrics
pnpm --filter @workspace/api-server run test:voice
pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/erp-voice-assistant run build
```

Contrato OpenAPI: `lib/api-spec/openapi.yaml`. O código de cliente e validação
é gerado; não edite os arquivos gerados manualmente.

A verificação no navegador com fala sintética confirmou duas consultas reais,
contexto de mês anterior, captura compatível, áudio progressivo e descarte da
sessão após reload. A interrupção foi confirmada pela combinação de testes do
detector/player e uma conexão real ao backend durante geração de voz; o ensaio
de navegador enviou a segunda fala tarde demais para comprovar esse cenário
completo. Acústica de microfones físicos, eco e o caminho nativo AudioWorklet
continuam precisando de uma matriz de dispositivos reais.

Sem autenticação, esta prova de conceito não deve ser exposta como serviço
público irrestrito: chamadas de áudio e IA consomem a chave da OpenAI.
Não foram implementados multiempresa, admin de plataforma, sincronização
Sankhya, RAG ou perguntas além das três métricas.


## Consulta livre e implantação
A assistente consulta, além das métricas oficiais, qualquer view descrita na **ficha de implantação** (consulta livre somente leitura, com duas barreiras de segurança). Veja [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) para configurar um cliente e [docs/HANDOFF-REPLIT.md](docs/HANDOFF-REPLIT.md) para atualizar o ambiente.
