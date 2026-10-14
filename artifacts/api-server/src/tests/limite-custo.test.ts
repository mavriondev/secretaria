import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { ceilingEventsTable, companiesTable, costsTable, db, notificationsTable, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { answerQuestion } from "../lib/assistant";
import { runAsTenant } from "../lib/tenant";
import { evaluateBudget, monthStart } from "../lib/limite-custo";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const emails: string[] = [];
let company = 0;
const call = async (method: "GET" | "POST" | "PATCH", url: string, as: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: { cookie: cookies[as]! }, ...(payload ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador" | "gestor", companyId: number | null) {
  const email = `${key}.lim.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Limite ${tag}`, erp: "outro", dataReady: false }).returning();
  company = c!.id;
  await seed("dono", "dono", null); await seed("admin", "administrador", company); await seed("gestor", "gestor", company);
  const [log] = await db.insert(queryLogsTable).values({ companyId: company, question: `q ${tag}`, answer: "r", freedomLevel: 1, latencyMs: 1, estimatedCostUsd: "0.04000000", parameters: {} }).returning({ id: queryLogsTable.id });
  // The ceilings read the ledger, not the answer log: a cost counts once it is booked there.
  await db.insert(costsTable).values({ companyId: company, kind: "texto", provider: "openai", quantity: "100", unit: "tokens", costUsd: "0.04000000", queryLogId: log!.id });
});
after(async () => {
  await db.delete(notificationsTable).where(eq(notificationsTable.companyId, company));
  await db.delete(ceilingEventsTable).where(eq(ceilingEventsTable.companyId, company));
  await db.delete(costsTable).where(eq(costsTable.companyId, company));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.companyId, company));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(eq(companiesTable.id, company));
  await app.close(); await pool.end();
});

test("the ceiling renews on day 1 at São Paulo midnight and warns at 80%", () => {
  assert.equal(monthStart(new Date("2026-10-13T15:00:00Z")).toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(monthStart(new Date("2026-11-01T02:00:00Z")).toISOString(), "2026-10-01T03:00:00.000Z", "still October in São Paulo");
  const since = monthStart();
  assert.equal(evaluateBudget(null, 99, since).bloqueado, false);
  assert.deepEqual([evaluateBudget(10, 7.9, since).aviso, evaluateBudget(10, 8, since).aviso, evaluateBudget(10, 8, since).bloqueado], [false, true, false]);
  assert.equal(evaluateBudget(10, 10, since).bloqueado, true);
});

test("only the product owner sets the ceiling; reaching it blocks answers politely and costs nothing", async () => {
  assert.equal((await call("PATCH", `/api/plataforma/empresas/${company}`, "admin", { limiteMensalUsd: 1 })).status, 403);
  const set = await call("PATCH", `/api/plataforma/empresas/${company}`, "dono", { limiteMensalUsd: 0.05 });
  assert.equal(set.status, 200); assert.equal(set.body.limiteMensalUsd, 0.05);
  const warn = (await call("GET", "/api/uso?dias=7", "admin")).body.limite;
  assert.equal(warn.aviso, true); assert.equal(warn.bloqueado, false);
  await call("PATCH", `/api/plataforma/empresas/${company}`, "dono", { limiteMensalUsd: 0.04 });
  const usage = (await call("GET", "/api/uso?dias=7", "admin")).body.limite;
  assert.equal(usage.bloqueado, true);
  const before = await db.select().from(queryLogsTable).where(eq(queryLogsTable.companyId, company));
  // a company without a connected database is refused earlier by the route, so the gate is exercised where every path (text, audio, live voice, test runs) meets it
  const res = { body: await runAsTenant({ companyId: company, userId: 0, role: "gestor" }, () => answerQuestion({ question: "Quanto faturamos este mês?", freedomLevel: 1, includeVoice: false })) };
  assert.match(res.body.answer, /limite de uso/i);
  assert.equal(res.body.inputTokens, 0);
  const after = await db.select().from(queryLogsTable).where(eq(queryLogsTable.companyId, company));
  assert.equal(after.length, before.length + 1, "the blocked turn is logged");
  const cleared = await call("PATCH", `/api/plataforma/empresas/${company}`, "dono", { limiteMensalUsd: null });
  assert.equal(cleared.body.limiteMensalUsd, null);
  assert.equal((await call("GET", "/api/uso?dias=7", "admin")).body.limite.bloqueado, false);
});
