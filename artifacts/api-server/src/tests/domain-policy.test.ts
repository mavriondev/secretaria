import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { db, pool, queryLogsTable, knowledgeItemsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { answerQuestion, type Router } from "../lib/assistant";
import { DOMAIN_POLICY, FINANCIAL_SOURCE_REPLY } from "../lib/domain-policy";
import { regrasDeEsclarecimento } from "../lib/esclarecimento";

/** Assertions shared by the recorded real-model scenarios and the offline regressions. */
const noDomainOffer = (answer: string) => {
  assert.doesNotMatch(answer, /(?:quer|prefere|deseja|gostaria).{0,100}(?:pesquis|internet|web|externo)|(?:^|[.!?]\s+)(?:posso pesquisar|posso buscar|posso procurar)|(?:erp|sistema).{0,30}(?:ou|fora).{0,30}(?:web|internet|externo|fora)/i);
};
const ids: number[] = [];
after(async () => {
  if (ids.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, ids));
  await pool.end();
});

test("policy defaults ambiguous subjects to the system without changing the closed clarification list", () => {
  assert.match(DOMAIN_POLICY, /sistema primeiro, sem confirmação/);
  assert.match(DOMAIN_POLICY, /SOMENTE para pedido claramente público/);
  assert.match(DOMAIN_POLICY, /identidades de clientes/);
  assert.match(regrasDeEsclarecimento(), /entidade, depois período, depois métrica/);
  assert.match(regrasDeEsclarecimento(), /No máximo 2 rodadas/);
  noDomainOffer(FINANCIAL_SOURCE_REPLY);
  assert.doesNotMatch(FINANCIAL_SOURCE_REPLY, /\?/);
});

test("router instructions and tool description cannot reinstate the old 'ask if it serves' rule", async () => {
  const assistant = await readFile(new URL("../lib/assistant.ts", import.meta.url), "utf8");
  const contracts = await readFile(new URL("../lib/tool-contracts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(assistant, /pergunte se serve|Você quer dados do ERP ou uma cotação pública\?|Quer que eu veja algum desses\?/);
  assert.doesNotMatch(contracts, /pergunte se serve/);
  assert.match(assistant, /\$\{DOMAIN_POLICY\}/);
  assert.match(contracts, /sem perguntar, sem oferecer web nem pesquisa/);
});

test("the financial source guard refuses an unsupported number without asking ERP or public quote", async () => {
  const router: Router = async () => ({ output: [{
    type: "function_call", name: "responder", arguments: JSON.stringify({
      tipo: "general", texto: "Seu saldo é R$ 123,00.", dominio: "sistema",
      campo: "nenhum", opcoes: [], apresentacao: "normal",
    }),
  }] });
  const r = await answerQuestion({ question: "Qual é meu saldo?", freedomLevel: 1, includeVoice: false }, null, Date.now(), { router, composer: null });
  ids.push(r.id);
  assert.equal(r.answer, FINANCIAL_SOURCE_REPLY);
  assert.equal(r.responseKind, "general");
  assert.equal(r.domain, "sistema");
  noDomainOffer(r.answer);
  assert.equal((r.parameters._state as { esclarecimento: unknown }).esclarecimento, null);
});

test("the unavailable metric guard keeps blocking revenue substitution, without a question", async () => {
  const router: Router = async () => ({ output: [{
    type: "function_call", name: "responder", arguments: JSON.stringify({
      tipo: "general", texto: "Posso mostrar o faturamento.", dominio: "sistema",
      campo: "nenhum", opcoes: [], apresentacao: "normal",
    }),
  }] });
  const r = await answerQuestion({ question: "Qual é a margem de lucro?", freedomLevel: 1, includeVoice: false }, null, Date.now(), { router, composer: null });
  ids.push(r.id);
  assert.match(r.answer, /Isso não existe nesta base/);
  noDomainOffer(r.answer);
  assert.doesNotMatch(r.answer, /\?/);
  assert.equal(r.responseKind, "general");
});

test("internal-subject guard refuses external research before calling any provider, without confirmation", async () => {
  const [known] = await db.insert(knowledgeItemsTable).values({
    companyId: 1, category: "empresa", title: "Termo privado teste",
    content: "Termo privado teste", origin: "treinamento",
  }).returning({ id: knowledgeItemsTable.id });
  const router: Router = async () => ({ output: [{
    type: "function_call", name: "pesquisar",
    arguments: JSON.stringify({ assunto: "Termo privado teste", apresentacao: "normal" }),
  }] });
  let r;
  try {
    r = await answerQuestion({ question: "Pesquise Termo privado teste.", freedomLevel: 1, includeVoice: false }, null, Date.now(), { router, composer: null });
  } finally {
    await db.delete(knowledgeItemsTable).where(eq(knowledgeItemsTable.id, known!.id));
  }
  ids.push(r.id);
  assert.equal(r.domain, "sistema");
  assert.equal(r.responseKind, "general");
  assert.equal(r.sources?.length, 0);
  assert.equal((r.parameters._metrics as { chamadas: number }).chamadas, 1);
  noDomainOffer(r.answer);
  assert.doesNotMatch(r.answer, /\?/);
});

// Optional replay of paid scenario recordings: verifies all actual answers,
// without making another model call or relying on a hand-written snapshot.
if (process.env.DOMAIN_SCENARIOS_JSON) {
  test("recorded real-model scenarios have no domain offers or questions", async () => {
    const recording = JSON.parse(await readFile(process.env.DOMAIN_SCENARIOS_JSON!, "utf8")) as {
      out: Array<{ grupo: string; body?: { answer: string; domain: string; sources?: unknown[] } }>;
    };
    assert.equal(recording.out.length, 17, "sixteen scenarios plus the private-client case");
    for (const row of recording.out) {
      assert.ok(row.body);
      noDomainOffer(row.body.answer);
      if (row.grupo !== "publico") {
        assert.equal(row.body.domain, "sistema");
        assert.equal(row.body.sources?.length, 0);
      }
      if (row.grupo === "ausente" || row.grupo === "ambiguo") assert.doesNotMatch(row.body.answer, /\?/);
    }
  });
}
