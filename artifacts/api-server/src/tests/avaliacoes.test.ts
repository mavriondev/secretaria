test("a review remains readable after its old answer is removed, without recovering deleted text", async () => {
  const [original] = await db.insert(queryLogsTable).values({ companyId: 1, question: "antiga", answer: "antiga", freedomLevel: 1, latencyMs: 1 }).returning();
  const id = original!.id;
  const [before] = await db.insert(answerReviewsTable).values({ companyId: 1, logId: id, userId: ids.admin!, status: "revisada" }).returning();
  await db.delete(queryLogsTable).where(eq(queryLogsTable.id, id));
  const r = await call("GET", "/api/avaliacoes", "admin");
  assert.equal(r.status, 200);
  const review = r.body.find((item: { logId: number }) => item.logId === id);
  assert.ok(review);
  assert.match(review.pergunta, /removida pela política/);
  assert.equal(review.resposta, "");
  assert.equal(review.status, before!.status);
  assert.equal(review.criadaEm, before!.createdAt.toISOString());
  await db.delete(answerReviewsTable).where(eq(answerReviewsTable.logId, id));
});
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { answerReviewsTable, companiesTable, db, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const emails: string[] = [];
const ids: Record<string, number> = {};
let otherCompany = 0, logId = 0;
const call = async (method: "GET" | "POST" | "PATCH", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.av.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Outra ${tag}`, erp: "outro", dataReady: false }).returning();
  otherCompany = c!.id;
  await seed("gestor", "gestor", 1); await seed("admin", "administrador", 1); await seed("adminOutra", "administrador", otherCompany);
  const [log] = await db.insert(queryLogsTable).values({ companyId: 1, question: `pergunta ${tag}`, answer: "resposta", freedomLevel: 1, latencyMs: 1200 }).returning();
  logId = log!.id;
});
after(async () => {
  await db.delete(answerReviewsTable).where(eq(answerReviewsTable.logId, logId));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.id, logId));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany));
  await app.close(); await pool.end();
});

test("a manager flags an answer, the administrator reviews it, and flagging again reopens it", async () => {
  assert.equal((await call("POST", "/api/avaliacoes", "gestor", { logId, motivo: "Valor não bate" })).status, 201);
  assert.equal((await call("POST", "/api/avaliacoes", "gestor", { logId, motivo: "Valor não bate com o ERP" })).status, 201);
  const list = (await call("GET", "/api/avaliacoes?status=nova", "admin")).body as Array<{ id: number; logId: number; motivo: string; pergunta: string }>;
  const mine = list.filter(i => i.logId === logId);
  assert.equal(mine.length, 1, "one flag per person and answer");
  assert.equal(mine[0]!.motivo, "Valor não bate com o ERP"); assert.equal(mine[0]!.pergunta, `pergunta ${tag}`);
  assert.equal((await call("PATCH", `/api/avaliacoes/${mine[0]!.id}`, "admin", { status: "revisada", tratativa: "Nota na coluna" })).status, 200);
  assert.ok(!(await call("GET", "/api/avaliacoes?status=nova", "admin")).body.some((i: { logId: number }) => i.logId === logId));
  await call("POST", "/api/avaliacoes", "gestor", { logId, motivo: "De novo" });
  assert.ok((await call("GET", "/api/avaliacoes?status=nova", "admin")).body.some((i: { logId: number }) => i.logId === logId), "reopened");
});

test("managers cannot read the review list and companies cannot see or flag each other's answers", async () => {
  assert.equal((await call("GET", "/api/avaliacoes", "gestor")).status, 403);
  assert.equal((await call("POST", "/api/avaliacoes", "adminOutra", { logId })).status, 404, "log of another company");
  assert.ok(!(await call("GET", "/api/avaliacoes", "adminOutra")).body.some((i: { logId: number }) => i.logId === logId));
  const mine = (await call("GET", "/api/avaliacoes", "admin")).body.find((i: { logId: number }) => i.logId === logId);
  assert.equal((await call("PATCH", `/api/avaliacoes/${mine.id}`, "adminOutra", { status: "descartada" })).status, 404);
});
