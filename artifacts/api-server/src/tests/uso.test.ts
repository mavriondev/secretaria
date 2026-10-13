import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, db, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const emails: string[] = [];
let otherCompany = 0;
const call = async (url: string, as: string) => {
  const res = await app.inject({ method: "GET", url, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.uso.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Uso ${tag}`, erp: "outro", dataReady: false }).returning();
  otherCompany = c!.id;
  await seed("gestor", "gestor", 1); await seed("adminB", "administrador", otherCompany);
  // a brand-new company has only the rows inserted here, so the totals are exact
  const base = { companyId: otherCompany, answer: "r", freedomLevel: 1 };
  await db.insert(queryLogsTable).values([
    { ...base, question: `a ${tag}`, latencyMs: 1000, estimatedCostUsd: "0.01000000", parameters: { _metrics: { chamadas: 2, fallback: false } } },
    { ...base, question: `b ${tag}`, latencyMs: 3000, estimatedCostUsd: "0.03000000", parameters: { _metrics: { chamadas: 3, fallback: true } } },
    { ...base, question: `c ${tag}`, latencyMs: 2000, estimatedCostUsd: null, parameters: {} },
  ]);
});
after(async () => {
  await db.delete(queryLogsTable).where(eq(queryLogsTable.companyId, otherCompany));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany));
  await app.close(); await pool.end();
});

test("usage sums what each turn recorded, only for the company of the session", async () => {
  await seed("adminB2", "administrador", otherCompany);
  const res = await call("/api/uso?dias=7", "adminB2");
  assert.equal(res.status, 200);
  const { resumo, maisCaras, maisLentas } = res.body;
  assert.equal(resumo.respostas, 3);
  assert.ok(Math.abs(resumo.custoTotalUsd - 0.04) < 1e-9);
  assert.ok(Math.abs(resumo.custoMedioUsd - 0.02) < 1e-9, "average over turns that have a cost");
  assert.equal(resumo.latenciaMediaMs, 2000); assert.equal(resumo.latenciaP50Ms, 2000);
  assert.equal(resumo.comFallback, 1); assert.equal(resumo.medidas, 2);
  assert.equal(maisCaras[0].pergunta, `b ${tag}`); assert.equal(maisLentas[0].latenciaMs, 3000);
});

test("managers cannot read usage and an invalid period is refused", async () => {
  assert.equal((await call("/api/uso", "gestor")).status, 403);
  assert.equal((await call("/api/uso?dias=0", "adminB")).status, 400);
});
