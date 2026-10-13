/** Public integration kit. Never insert an actual sending key or customer records here. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PACOTE_SANKHYA as pacote } from "../artifacts/api-server/src/lib/pacotes/sankhya.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "https://187.77.232.164/tato/api";
const label: Record<string, string> = { vendas: "Vendas", financeiro: "Contas a receber" };
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const contrato = {
  aviso: "Pacote padrão Sankhya. O GET autenticado /ingestao/estado é a fonte de verdade para a empresa: apenas assuntos selecionados e eventual pacote personalizado.",
  assuntos: pacote.assuntos,
  tabelas: Object.entries(pacote.tabelas).map(([tabela, spec]) => ({
    tabela, chave: spec.chave, colunaDeAlteracao: spec.incremental, colunas: spec.colunas,
  })),
};
const resources: Record<string, unknown>[] = [
  { _id: "wrk_tato_ingestao", _type: "workspace", name: "Tato — integração do cliente", description: "Sem credenciais. Não executar todos os pedidos em lote. Leia 00 — LEIA PRIMEIRO.", scope: "collection" },
  { _id: "env_tato_base", _type: "environment", parentId: "wrk_tato_ingestao", name: "Base Environment", data: {
    api_url: base, envio_url: "https://envio-desativado.invalid/tato/api", chave_envio: "",
    tabela: "PREENCHA_NOME_DA_TABELA", carga_id: "PREENCHA_ID_UNICO_DA_CARGA",
  }, dataPropertyOrder: null, color: null, isPrivate: false },
  { _id: "fld_tato_read", _type: "request_group", parentId: "wrk_tato_ingestao", name: "01 — Saúde e contrato", environment: {}, description: "Estado exige chave; pode preparar as estruturas do espelho. Saúde pública não comprova recebimento." },
  { _id: "fld_tato_send", _type: "request_group", parentId: "wrk_tato_ingestao", name: "02 — Envio manual (bloqueado por padrão)", environment: {}, description: "Somente em uma base de teste preparada. Substitua envio_url deliberadamente. Incremental sobrescreve a linha inteira; carga completa substitui a tabela ao finalizar." },
  { _id: "fld_tato_tables", _type: "request_group", parentId: "wrk_tato_ingestao", name: "03 — Modelos Sankhya por tabela (preencher)", environment: {}, description: "Todos os campos iniciam nulos, inclusive chaves: NÃO são dados válidos. Use só as tabelas do contrato da sua empresa." },
];
function request(id: string, parent: string, name: string, method: string, url: string, body?: unknown, description = "", auth = true) {
  resources.push({
    _id: `req_tato_${id}`, _type: "request", parentId: parent, name, method, url,
    description, parameters: [],
    headers: body ? [{ name: "Content-Type", value: "application/json" }] : [],
    authentication: auth ? { type: "bearer", token: "{{ _.chave_envio }}" } : {},
    body: body ? { mimeType: "application/json", text: json(body) } : {},
    settingSendCookies: false, settingStoreCookies: false, settingFollowRedirects: "global",
    settingDisableRenderRequestBody: false, settingEncodeUrl: true, settingRebuildPath: true,
  });
}
request("readme", "fld_tato_read", "00 — LEIA PRIMEIRO (abrir documentação)", "GET",
  "https://187.77.232.164/tato/integracao/api-envio.html", undefined,
  "Importe via Import → File. Manage Environments: api_url já aponta à VPS; chave_envio vazia. Use chave exclusiva de teste, nunca senha de dono. envio_url está em domínio .invalid para impedir gravações acidentais. Primeiro confira saúde e estado. Para POST: prepare base isolada, ajuste envio_url, tabela e substitua os valores do corpo. Não execute a coleção inteira. Não compartilhe exportação com chave preenchida.", false);
request("health", "fld_tato_read", "01 — Saúde pública", "GET", "{{ _.api_url }}/healthz", undefined, "Não exige chave. status ok significa servidor ativo, não empresa preparada.", false);
request("estado", "fld_tato_read", "02 — Contrato e estado da empresa", "GET", "{{ _.api_url }}/ingestao/estado", undefined,
  "Use o contrato retornado: tabelas, chaves, colunas/tipos, marca incremental e recibos. Esta consulta pode criar estruturas do espelho; exige empresa preparada.");
request("incremental", "fld_tato_send", "03 — Incremental (preencher corpo)", "POST", "{{ _.envio_url }}/ingestao/tabelas/{{ _.tabela }}",
  { modo: "incremental", linhas: [{ COLUNA_CHAVE_DO_CONTRATO: null }] },
  "Modelo inválido até preencher tabela e linha do contrato. Atualiza/insere pela chave; omitir colunas as transforma em NULL. Não é PATCH. Lista vazia atualiza o registro de recebimento sem provar conteúdo.");
request("completa_inicio", "fld_tato_send", "04 — Completa: primeiro lote (não finaliza)", "POST", "{{ _.envio_url }}/ingestao/tabelas/{{ _.tabela }}",
  { modo: "completa", carga: "{{ _.carga_id }}", ultimo: false, linhas: [{ COLUNA_CHAVE_DO_CONTRATO: null }] },
  "ATENÇÃO: carga completa substitui a tabela ao finalizar. ID único de 4–64 letras/números/-/_, mesmo em todos os lotes desta tabela/carga. Novo ID abandona carga incompleta anterior. Não envie apenas uma amostra para uma tabela real.");
request("completa_fim", "fld_tato_send", "05 — Completa: finalizar (substitui tabela!)", "POST", "{{ _.envio_url }}/ingestao/tabelas/{{ _.tabela }}",
  { modo: "completa", carga: "{{ _.carga_id }}", ultimo: true, linhas: [{ COLUNA_CHAVE_DO_CONTRATO: null }] },
  "Use o mesmo ID dos lotes anteriores e preencha as linhas do último lote. Uma carga de um único lote usa ultimo:true desde o início. Completa vazia pode esvaziar a tabela. Não repetir automaticamente a finalização nem executar este pedido fora de sequência.");
for (const [name, spec] of Object.entries(pacote.tabelas)) {
  request(name.toLowerCase(), "fld_tato_tables", `${name} — preencher chaves ${spec.chave.join(", ")}`, "POST",
    `{{ _.envio_url }}/ingestao/tabelas/${name}`,
    { modo: "incremental", linhas: [Object.fromEntries(spec.colunas.map(c => [c.nome, null]))] },
    `Chave: ${spec.chave.join(", ")}. Alteração: ${spec.incremental ?? "não disponível; prefira snapshots completos controlados para refletir exclusões"}. Colunas: ${spec.colunas.map(c => `${c.nome}: ${c.tipo}`).join("; ")}. Valores nulos são só espaços para preenchimento, não uma amostra válida.`);
}
const insomnia = { _type: "export", __export_format: 4, __export_date: new Date().toISOString(), __export_source: "tato.integration-kit", resources };
const failure = { description: "Requisição rejeitada; consultar error. Lote não efetivado.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const openapi = {
  openapi: "3.0.3",
  info: { title: "Tato — API de envio de dados do cliente", version: "1.0.0", description: "API pública de integração, não toda a API interna do painel. A chave escolhe a empresa; não há empresaId no envio. Catálogo autenticado é a fonte de verdade. Limites: 20.000 linhas/lote e 15 MiB no POST. Carga completa substitui a tabela quando ultimo=true." },
  servers: [{ url: base, description: "VPS oficial" }],
  security: [{ SendingKey: [] }],
  paths: {
    "/healthz": { get: { operationId: "health", security: [], summary: "Saúde pública do servidor", responses: { "200": { description: "Servidor ativo", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, versao: { type: "string" } } } } } } } } },
    "/ingestao/estado": { get: {
      operationId: "sendingState", summary: "Contrato e progresso da empresa", description: "Pode preparar tabelas do espelho. Não gera/revela chave e não libera a IA.",
      responses: { "200": { description: "Contrato da empresa", content: { "application/json": { schema: { $ref: "#/components/schemas/State" } } } }, "401": failure, "409": failure, "429": failure },
    } },
    "/ingestao/tabelas/{tabela}": { post: {
      operationId: "sendBatch", summary: "Enviar lote de uma tabela", description: "Nome deve fazer parte do contrato. Lote transacional; chave repetida no lote: última linha vence. Incremental substitui a linha inteira, não somente os campos informados. Completa exige carga e usa staging; ultimo=true efetiva substituição da tabela. Não há transação conjunta entre tabelas.",
      parameters: [{ name: "tabela", in: "path", required: true, schema: { type: "string" }, description: "Nome retornado pelo contrato, sem distinção entre maiúsculas e minúsculas." }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Batch" } } } },
      responses: { "200": { description: "Lote aceito; verificar concluida", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchResult" } } } }, "400": failure, "401": failure, "404": failure, "409": failure, "413": failure, "422": failure, "429": failure },
    } },
  },
  components: {
    securitySchemes: { SendingKey: { type: "http", scheme: "bearer", description: "Chave tato_env_… exclusiva da empresa, emitida pelo dono. Não é senha, sessão do painel ou token de outro serviço." } },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      Column: { type: "object", required: ["nome", "tipo"], properties: { nome: { type: "string" }, tipo: { type: "string" } } },
      Table: { type: "object", properties: {
        tabela: { type: "string" }, chave: { type: "array", items: { type: "string" } }, colunaDeAlteracao: { type: "string", nullable: true },
        colunas: { type: "array", items: { $ref: "#/components/schemas/Column" } }, linhas: { type: "integer" },
        ultimaMarca: { type: "string", nullable: true }, recebidoEm: { type: "string", format: "date-time", nullable: true },
      } },
      State: { type: "object", properties: { limitePorLote: { type: "integer", example: 20000 }, tabelas: { type: "array", items: { $ref: "#/components/schemas/Table" } } } },
      Batch: {
        type: "object", required: ["linhas"],
        properties: {
          modo: { type: "string", enum: ["incremental", "completa"], default: "incremental" },
          carga: { type: "string", maxLength: 64, description: "Obrigatória em completa: ^[A-Za-z0-9_-]{4,64}$, ID consistente nos lotes de uma tabela/carga." },
          ultimo: { type: "boolean", description: "Em completa, true efetiva a substituição. Em incremental, não altera o comportamento." },
          linhas: { type: "array", maxItems: 20000, items: { type: "object", additionalProperties: { anyOf: [{ type: "string", nullable: true }, { type: "number", nullable: true }, { type: "boolean", nullable: true }] } }, description: "Colunas do contrato; chaves não podem ser nulas. Objetos/arrays como valores são rejeitados. Campos omitidos viram null." },
        },
      },
      BatchResult: { type: "object", required: ["ok", "tabela", "modo", "recebidas", "gravadas", "concluida"], properties: {
        ok: { type: "boolean" }, tabela: { type: "string" }, modo: { type: "string", enum: ["incremental", "completa"] }, recebidas: { type: "integer" },
        gravadas: { type: "integer" }, concluida: { type: "boolean" }, colunasIgnoradas: { type: "array", items: { type: "string" } },
      } },
    },
  },
};
const sections: Array<[string, string]> = [
  ["Escopo e segurança", `API de integração para o técnico que envia os dados do cliente. Não é a API completa administrativa do Tato.
Base oficial: ${base}
O envio usa JSON por HTTPS, não anexos CSV/Excel. A chave identifica a empresa; não envie empresaId nem CODEMP como identificador do Tato. CODEMP é um dado do Sankhya.
Nunca coloque uma chave real em documentação, GitHub ou arquivos compartilhados. Não entregue senha de dono ao cliente. Use um ambiente de teste isolado para amostras, não dados fictícios numa base real.
Arquivos do kit: tato-insomnia.json (importação), envio.openapi.json (OpenAPI 3.0), sankhya-contrato.json (pacote padrão, sem dados).
Os módulos atuais do pacote Sankhya são Vendas e Contas a receber (ID técnico financeiro). Não são todos os módulos do ERP. Ver dados de TGFFIN não significa que contas a pagar tenha sido homologado.`],
  ["Antes de usar", `O dono precisa cadastrar a empresa correta, preparar um banco PostgreSQL separado acessível pelo Tato, selecionar os assuntos e gerar uma chave em Recebimento. Isso muda a origem para envio REST. A empresa precisa estar ativa.
Cadastrar um endereço não cria o banco automaticamente. A tela Base de dados exige ficha válida e estruturas verificáveis: só salva a conexão quando a verificação passa. Uma empresa nova com banco vazio precisa de preparação técnica das estruturas/ficha antes do envio; gerar chave não resolve esse passo. Não use a base de demonstração.
Nenhuma chave ou base da JM Forros é criada ao baixar este kit.
O estado prepara as tabelas de recebimento conforme o pacote, mas só consegue fazê-lo quando o banco destino já está cadastrado. Só após conferência/liberação a IA deve ser usada. Recebimento e verificação estrutural não comprovam conciliação financeira ou completude do ERP.`],
  ["Importar no Insomnia", `1. Import → File → tato-insomnia.json (formato Insomnia JSON v4).
2. Em Manage Environments, api_url já tem a VPS oficial. Preencha chave_envio APENAS no seu ambiente local.
3. Envie Saúde pública e depois Contrato e estado. Guarde o contrato retornado para o técnico.
4. Os pedidos POST usam envio_url, que começa com https://envio-desativado.invalid/tato/api: gravações estão bloqueadas por padrão.
5. Só depois de preparar a base de teste, substitua envio_url pela URL aprovada, escolha uma tabela do contrato e preencha o corpo com dados controlados. As chaves iniciam nulas e precisam ser preenchidas.
6. Execute cada pedido manualmente. Não rode a coleção inteira: ela contém exemplos alternativos, inclusive carga completa que substitui tabelas.
7. Não exporte/sincronize a coleção com chave preenchida. Se ela vazar, o dono deve revogar/rotacionar a chave.
Não desative validação TLS como configuração permanente. Se houver erro de certificado, confira endereço, relógio e certificado antes de enviar dados.`],
  ["Autenticação", `Authorization: Bearer SUA_CHAVE
Content-Type: application/json
A chave tato_env_… dá acesso somente ao contrato e envio daquela empresa. Não exige login/cookies do painel. Chave revogada, incorreta, empresa inativa ou fora do modo recebida retorna 401. Não altere empresaId para tentar escolher outra empresa: quem escolhe é a chave.`],
  ["GET /healthz — servidor", `Não exige autenticação. Resposta 200 com status e versão. Exemplo: {"status":"ok","versao":"SHA_DO_COMMIT"}.
Servidor ativo não significa cliente preparado, dados recebidos ou IA liberada.`],
  ["GET /ingestao/estado — contrato", `Exige chave. Retorna limitePorLote e tabelas, cada uma com tabela, chave (colunas que identificam a linha), colunaDeAlteracao, colunas (nome/tipo), linhas, ultimaMarca e recebidoEm.
Exemplo de estrutura:
${json({ limitePorLote: 20000, tabelas: [{ tabela: "TSIEMP", chave: ["CODEMP"], colunaDeAlteracao: null, colunas: [{ nome: "CODEMP", tipo: "integer" }, { nome: "NOMEFANTASIA", tipo: "text" }, { nome: "RAZAOSOCIAL", tipo: "text" }], linhas: 0, ultimaMarca: null, recebidoEm: null }] })}
O exemplo não é o catálogo completo. O retorno autenticado é a fonte de verdade: inclui somente assuntos selecionados e pode refletir um pacote personalizado.
Esta consulta pode criar tabelas e estruturas auxiliares no destino. Não importa dados do ERP nem gera uma nova chave.
ultimaMarca é a maior alteração já presente, quando existe colunaDeAlteracao. Não é um token de paginação nem prova de carga completa. recebidoEm registra carga completa efetivada ou lote incremental, inclusive vazio.`],
  ["POST /ingestao/tabelas/{tabela} — incremental", `Envie uma tabela por chamada. Nome e colunas são comparados sem distinção de maiúsculas/minúsculas.
Exemplo apenas em BASE ISOLADA, dados fictícios:
${json({ modo: "incremental", linhas: [{ CODEMP: 900001, NOMEFANTASIA: "EMPRESA FICTICIA DE TESTE", RAZAOSOCIAL: "EXEMPLO — NAO USAR EM PRODUCAO" }] })}
Destino do exemplo: /ingestao/tabelas/TSIEMP.
Cada chave nova insere; chave existente substitui os campos da linha enviados ao banco. NÃO é atualização parcial: colunas do contrato omitidas viram NULL. Envie todos os campos necessários da linha.
Chaves não podem estar nulas/ausentes. Chaves repetidas dentro de um lote: última linha vence. Campos extras são ignorados e aparecem em colunasIgnoradas; trate esse retorno como alerta de mapeamento.
Valores aceitos: texto, número, booleano ou null. Objetos/arrays dentro de colunas são rejeitados. Use ponto decimal e datas ISO (YYYY-MM-DD; timestamp conforme tipo do contrato). Campos numéricos/data vazios viram null; erros de conversão rejeitam o lote.
Incremental não remove linhas excluídas no ERP. Lista vazia atualiza a marca de recebimento, mas não comprova que há dados. Omitir modo usa incremental.`],
  ["Carga completa — atenção à substituição", `Use modo=completa, carga com ID único de 4 a 64 letras/números/-/_, e ultimo=false nos lotes intermediários. Use o MESMO ID para todos os lotes de uma tabela naquela carga.
Exemplo de primeiro lote: {"modo":"completa","carga":"snapshot-20261013-001","ultimo":false,"linhas":[...]}
Último lote: mesmo ID, ultimo=true e as linhas finais. Em carga de um único lote, envie ultimo=true desde o início.
Os lotes são acumulados numa tabela temporária. A tabela publicada é SUBSTITUÍDA quando ultimo=true. Linhas ausentes na nova carga desaparecem. Uma completa vazia pode esvaziar a tabela.
Novo ID descarta a carga incompleta anterior da mesma tabela. Não misture IDs/rotinas e não repita automaticamente a finalização: depois de concluída, repetir só o último lote pode iniciar outra carga e substituir pelos dados daquele lote.
A publicação é transacional por tabela, NÃO simultânea entre todas as tabelas. Não mande uma amostra ou um período menor em completa sobre uma base real sem aprovar a substituição e o escopo.`],
  ["Limites e resposta", `Máximo de 20.000 linhas por lote e 15 × 1024 × 1024 bytes (15 MiB) no corpo do POST. Divida lotes antes de ultrapassar qualquer limite.
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
Erros de aplicação usam {"error":"mensagem"}. Validação do framework pode adicionar campos como statusCode/code/message. Não retente 4xx sem corrigir. Em falha de rede, concilie estado antes de repetir uma finalização completa.`],
  ["Pacote Sankhya e conferência", `O catálogo abaixo é gerado do código, não digitado à mão. O contrato autenticado da empresa sempre prevalece.
${Object.entries(pacote.assuntos).map(([a, ts]) => `${label[a] ?? a} (ID ${a}): ${ts.join(", ")}`).join("\n")}
Defina com o técnico CODEMP(s), período e filtros. Para notas do período, inclua itens e cadastros relacionados, não só TGFCAB. Preserve chaves compostas, incluindo horários quando fazem parte da chave.
Depois do envio: confira contagens, relacionamentos, soma/valores no Sankhya, regras de venda e títulos antes da IA. Recebimentos registrados são evidência de transporte, não homologação do conteúdo.
O padrão Vendas cobre notas/itens e cadastros relacionados; Contas a receber cobre títulos. Outros assuntos não estão habilitados apenas por existir módulo no ERP.`],
  ["Gestão da chave — somente dono", `Use preferencialmente o painel → empresa → Recebimento. A API administrativa usa sessão/cookie de dono (obtido no login do painel), NÃO o Bearer de envio.
GET /plataforma/empresas/{id}/ingestao: ativa, prefixo, geradaEm, recebimentos. Não devolve chave completa.
POST /plataforma/empresas/{id}/ingestao/chave: corpo {"intervaloMin":60}; intervalo opcional, inteiro de 5 a 10080. Retorna chave, prefixo e aviso. Gera chave, invalida a anterior e muda a empresa para REST. Chave só é exibida nessa resposta.
POST /plataforma/empresas/{id}/ingestao/revogar: revoga a chave atual. O cliente para de enviar.
Estas ações são administrativas e por isso não estão na coleção destinada ao cliente. Nunca compartilhe uma sessão de dono para ele gerar sua própria chave.
Rotação/revogação afeta integrações em uso e precisa ser combinada com o técnico. Intervalo esperado não cria um agendamento no computador do cliente: o técnico agenda a rotina do lado dele.`],
];
const tablesMd = Object.entries(pacote.tabelas).map(([t, s]) => `### ${t}\nChave: ${s.chave.join(", ")}. Alteração: ${s.incremental ?? "nenhuma"}.\n\n| Coluna | Tipo |\n|---|---|\n${s.colunas.map(c => `| ${c.nome} | ${c.tipo} |`).join("\n")}`).join("\n\n");
const markdown = "# Tato — API de envio de dados do cliente\n\n" + sections.map(([h, b]) => `## ${h}\n\n${b}`).join("\n\n") + "\n\n## Referência de colunas — padrão Sankhya\n\n" + tablesMd + "\n";
const tablesHtml = Object.entries(pacote.tabelas).map(([t, s]) => `<details><summary>${t} · chave ${esc(s.chave.join(", "))}</summary><p>Alteração: ${esc(s.incremental ?? "nenhuma")}</p><table><thead><tr><th>Coluna</th><th>Tipo</th></tr></thead><tbody>${s.colunas.map(c => `<tr><td>${c.nome}</td><td>${c.tipo}</td></tr>`).join("")}</tbody></table></details>`).join("");
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tato — API de envio</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f6f5f0;color:#183338}header{background:#183338;color:#fff;padding:32px max(20px,calc((100vw - 960px)/2))}main{max-width:960px;margin:auto;padding:24px}a{color:#246271}header a{color:#fff}nav{display:flex;gap:18px;flex-wrap:wrap}.content{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}section{border-bottom:1px solid #d0d6d2;padding:16px 0}h2{font-size:23px}details{background:white;border:1px solid #d0d6d2;margin:12px 0;padding:14px}summary{cursor:pointer;font-weight:600}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:6px;border-bottom:1px solid #eee}.notice{padding:15px;border-left:4px solid #bb832d;background:#faf0d9}</style><header><h1>Tato — API de envio do cliente</h1><p>Contrato, segurança e teste no Insomnia · Sankhya</p><nav><a href="tato-insomnia.json" download>Baixar coleção Insomnia</a><a href="envio.openapi.json" download>Baixar OpenAPI</a><a href="sankhya-contrato.json" download>Baixar contrato padrão</a></nav></header><main><p class="notice">Sem chaves ou dados reais. POSTs do template estão bloqueados por padrão. Carga completa substitui a tabela: use uma base de teste isolada.</p>${sections.map(([h,b])=>`<section><h2>${esc(h)}</h2><div class="content">${esc(b)}</div></section>`).join("")}<section><h2>Colunas do pacote padrão Sankhya</h2>${tablesHtml}</section></main></html>`;
for (const dir of ["docs/api", "artifacts/erp-voice-assistant/public/integracao"]) {
  await mkdir(resolve(root, dir), { recursive: true });
  for (const [name, text] of Object.entries({
    "api-envio.md": markdown, "api-envio.html": html, "tato-insomnia.json": json(insomnia),
    "envio.openapi.json": json(openapi), "sankhya-contrato.json": json(contrato),
  })) await writeFile(resolve(root, dir, name), text);
}
console.log(`Kit gerado: ${Object.keys(pacote.tabelas).length} tabelas, ${resources.filter(r => r._type === "request").length} pedidos. Nenhuma chave real.`);
