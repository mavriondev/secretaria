import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, knowledgeItemsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const call = async (method: "GET" | "PUT", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
before(async () => {
  await ensureDemoCompany(); await app.ready();
  for (const role of ["administrador", "gestor"] as const) {
    const email = `${role}.dados.${tag}@teste.local`;
    await db.insert(usersTable).values({ companyId: 1, email, name: role, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
    cookies[role] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
  }
});
after(async () => {
  await db.delete(knowledgeItemsTable).where(and(eq(knowledgeItemsTable.companyId, 1), eq(knowledgeItemsTable.title, "vw_vendas_itens.vendedor")));
  for (const role of ["administrador", "gestor"]) await db.delete(usersTable).where(eq(usersTable.email, `${role}.dados.${tag}@teste.local`));
  await app.close(); await pool.end();
});

test("the data tab lists the ficha columns and saves, edits and clears a note per column", async () => {
  const list = await call("GET", "/api/dados", "administrador");
  assert.equal(list.status, 200);
  const view = list.body.visoes.find((v: { nome: string }) => v.nome === "vw_vendas_itens");
  assert.ok(view.colunas.some((c: { nome: string }) => c.nome === "vendedor"));
  const note = { visao: "vw_vendas_itens", coluna: "vendedor", nota: "Vendedor responsável pela nota, não quem digitou" };
  assert.equal((await call("PUT", "/api/dados/notas", "administrador", note)).status, 200);
  const again = (await call("GET", "/api/dados", "administrador")).body.visoes.find((v: { nome: string }) => v.nome === "vw_vendas_itens").colunas.find((c: { nome: string }) => c.nome === "vendedor");
  assert.equal(again.nota, note.nota);
  assert.equal((await call("PUT", "/api/dados/notas", "administrador", { ...note, nota: "Vendedor da nota, corrigido" })).status, 200);
  const rows = await db.select().from(knowledgeItemsTable).where(and(eq(knowledgeItemsTable.companyId, 1), eq(knowledgeItemsTable.title, "vw_vendas_itens.vendedor")));
  assert.equal(rows.length, 1, "editing updates the same item, no duplicate");
  await call("PUT", "/api/dados/notas", "administrador", { ...note, nota: "" });
  assert.equal((await db.select().from(knowledgeItemsTable).where(and(eq(knowledgeItemsTable.companyId, 1), eq(knowledgeItemsTable.title, "vw_vendas_itens.vendedor")))).length, 0);
});

test("notes refuse unknown columns and financial values, and managers cannot open the tab", async () => {
  assert.equal((await call("PUT", "/api/dados/notas", "administrador", { visao: "vw_vendas_itens", coluna: "inexistente", nota: "x" })).status, 404);
  assert.equal((await call("PUT", "/api/dados/notas", "administrador", { visao: "vw_vendas_itens", coluna: "vendedor", nota: "Meta de R$ 50 mil" })).status, 400);
  assert.equal((await call("GET", "/api/dados", "gestor")).status, 403);
});
