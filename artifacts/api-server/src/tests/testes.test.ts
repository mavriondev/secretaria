import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, db, pool, testQuestionsTable, testResultsTable, testRunsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { judge, startRun, type Answerer } from "../lib/testes";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const emails: string[] = [];
const companies: number[] = [];
let companyA = 0, companyB = 0, adminA = 0;
const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.te.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
  return u!.id;
}
const waitDone = async (runId: number) => { for (let i = 0; i < 100; i++) { const [r] = await db.select().from(testRunsTable).where(eq(testRunsTable.id, runId)); if (r!.status !== "executando") return r!; await new Promise(r => setTimeout(r, 50)); } throw new Error("run did not finish"); };

before(async () => {
  await ensureDemoCompany(); await app.ready();
  for (const n of ["A", "B"]) { const [c] = await db.insert(companiesTable).values({ name: `Teste ${n} ${tag}`, erp: "outro", dataReady: false }).returning(); companies.push(c!.id); }
  [companyA, companyB] = companies as [number, number];
  adminA = await seed("adminA", "administrador", companyA); await seed("adminB", "administrador", companyB); await seed("gestorA", "gestor", companyA);
});
after(async () => {
  for (const id of companies) {
    const runs = await db.select({ id: testRunsTable.id }).from(testRunsTable).where(eq(testRunsTable.companyId, id));
    if (runs.length) await db.delete(testResultsTable).where(inArray(testResultsTable.runId, runs.map(r => r.id)));
    await db.delete(testRunsTable).where(eq(testRunsTable.companyId, id));
    await db.delete(testQuestionsTable).where(eq(testQuestionsTable.companyId, id));
    await db.delete(usersTable).where(eq(usersTable.companyId, id));
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
  }
  await app.close(); await pool.end();
});

test("judge ignores accents and case, needs every expected text and refuses forbidden ones", () => {
  assert.deepEqual(judge("O faturamento foi R$ 1.000,00 em AGOSTO.", ["r$ 1.000,00", "agosto"], []), { passed: true, reason: "" });
  assert.equal(judge("Sem vendas", ["R$ 1.000,00"], []).passed, false);
  assert.match(judge("Houve queda", [], ["queda"]).reason, /apareceu "queda"/);
});

test("questions are per company, need an expectation, and managers cannot touch them", async () => {
  const none = await call("POST", "/api/testes/perguntas", "adminA", { pergunta: "Quanto faturei?" });
  assert.equal(none.status, 400, "a test that checks nothing is refused");
  const made = await call("POST", "/api/testes/perguntas", "adminA", { pergunta: "Quanto faturei em agosto?", deveConter: ["R$ 10,00"] });
  assert.equal(made.status, 201);
  assert.deepEqual((await call("GET", "/api/testes/perguntas", "adminB")).body, [], "company B does not see company A's questions");
  assert.equal((await call("PUT", `/api/testes/perguntas/${made.body.id}`, "adminB", { pergunta: "x x x", deveConter: ["a"] })).status, 404);
  assert.equal((await call("DELETE", `/api/testes/perguntas/${made.body.id}`, "adminB")).status, 404);
  assert.equal((await call("GET", "/api/testes/perguntas", "gestorA")).status, 403);
});

test("a run judges each question, flags what changed since the last run, and one run at a time", async () => {
  const tenant = { companyId: companyA, userId: adminA, role: "administrador" as const };
  const q2 = await call("POST", "/api/testes/perguntas", "adminA", { pergunta: "Quem vendeu menos?", deveConter: ["Ana"] });
  assert.equal(q2.status, 201);
  let reply = "Faturamento: R$ 10,00. Menos vendas: Ana.";
  const answerer: Answerer = async () => { await new Promise(r => setTimeout(r, 30)); return { answer: reply, latencyMs: 30, logId: null }; };
  const first = await startRun(tenant, answerer);
  assert.ok("runId" in first);
  assert.ok("error" in await startRun(tenant, answerer), "second run while the first is going is refused");
  const done1 = await waitDone((first as { runId: number }).runId);
  assert.equal(done1.status, "concluida"); assert.equal(done1.passed, 2); assert.equal(done1.failed, 0);
  reply = "Faturamento: R$ 99,00. Menos vendas: Bruno.";
  const second = await startRun(tenant, answerer) as { runId: number };
  const done2 = await waitDone(second.runId);
  assert.equal(done2.failed, 2);
  const detail = (await call("GET", `/api/testes/execucoes/${second.runId}`, "adminA")).body;
  assert.ok(detail.resultados.every((r: { aprovada: boolean; mudou: boolean }) => !r.aprovada && r.mudou), "both got worse since the previous run");
  assert.match(detail.resultados[0].motivo, /faltou/);
  assert.equal((await call("GET", `/api/testes/execucoes/${second.runId}`, "adminB")).status, 404, "another company cannot read the run");
});
