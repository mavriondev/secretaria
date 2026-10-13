import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, db, knowledgeItemsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { authorize } from "../lib/access";
import { ensureDemoCompany, hashPassword, passwordProblem, registerFailure, throttled, verifyPassword, type SessionUser } from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const mail = (name: string) => `${name}.${tag}@teste.local`;
const createdCompanies: number[] = [];
let cookies: Record<string, string> = {};

async function call(method: "GET" | "POST" | "PATCH", url: string, options: { as?: string; body?: unknown } = {}) {
  const res = await app.inject({ method, url, payload: options.body as object | undefined, headers: options.as ? { cookie: cookies[options.as]! } : {} });
  return { status: res.statusCode, body: res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null, setCookie: res.headers["set-cookie"] as string | undefined };
}
async function login(key: string, email: string, senha: string) {
  const res = await call("POST", "/api/auth/login", { body: { email, senha } });
  if (res.status === 200) cookies[key] = String(res.setCookie).split(";")[0]!;
  return res;
}
/** Account that already chose its own password, as after the first login. */
async function seedUser(role: "administrador" | "gestor", companyId: number, key: string, password = "senha-de-teste-1") {
  const email = mail(key);
  await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword(password), mustChangePassword: false });
  assert.equal((await login(key, email, password)).status, 200);
  return email;
}

before(async () => { await ensureDemoCompany(); await app.ready(); });
after(async () => {
  await db.delete(usersTable).where(inArray(usersTable.email, [mail("dono"), mail("admin1"), mail("gestor1")]));
  for (const id of createdCompanies) {
    await db.delete(knowledgeItemsTable).where(eq(knowledgeItemsTable.companyId, id));
    await db.delete(usersTable).where(eq(usersTable.companyId, id));
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
  }
  await db.delete(knowledgeItemsTable).where(eq(knowledgeItemsTable.title, `Termo ${tag}`));
  await app.close(); await pool.end();
});

test("passwords are hashed with a salt, verified, and weak ones are refused", async () => {
  const a = await hashPassword("uma-senha-longa"), b = await hashPassword("uma-senha-longa");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("uma-senha-longa", a));
  assert.ok(!(await verifyPassword("outra-senha-longa", a)));
  assert.ok(!(await verifyPassword("x", "texto-qualquer")));
  assert.ok(passwordProblem("curta")); assert.equal(passwordProblem("uma-senha-longa"), null);
});

test("login throttle blocks after repeated failures", () => {
  const now = Date.now();
  for (let i = 0; i < 8; i++) registerFailure(`t:${tag}`, now);
  assert.ok(throttled(`t:${tag}`, now + 1000));
  assert.ok(!throttled(`t:${tag}`, now + 16 * 60_000), "the window expires");
});

test("access matrix: owner manages companies only, manager only asks, unconnected data is closed", () => {
  const base: SessionUser = { id: 1, name: "x", email: "x@x.x", role: "administrador", companyId: 1, companyName: "A", dataReady: true, mustChangePassword: false };
  const as = (patch: Partial<SessionUser>) => ({ ...base, ...patch });
  assert.ok(authorize(base, "GET", "/knowledge").ok);
  assert.ok(authorize(as({ role: "dono", companyId: null }), "GET", "/plataforma/empresas").ok);
  assert.ok(!authorize(as({ role: "dono", companyId: null }), "POST", "/assistant/ask").ok, "the owner does not read company data");
  assert.ok(!authorize(base, "GET", "/plataforma/empresas").ok);
  const manager = as({ role: "gestor" });
  assert.ok(authorize(manager, "POST", "/assistant/ask").ok);
  assert.ok(authorize(manager, "GET", "/assistant/live").ok);
  for (const [method, path] of [["GET", "/knowledge"], ["POST", "/knowledge"], ["GET", "/logs"], ["POST", "/conference"], ["PUT", "/settings"], ["GET", "/empresa/usuarios"]] as const) {
    assert.ok(!authorize(manager, method, path).ok, `${method} ${path}`);
  }
  assert.ok(!authorize(as({ mustChangePassword: true }), "GET", "/knowledge").ok);
  assert.ok(authorize(as({ mustChangePassword: true }), "POST", "/auth/senha").ok);
  const closed = authorize(as({ dataReady: false }), "POST", "/assistant/ask");
  assert.ok(!closed.ok && closed.status === 409);
  assert.ok(authorize(as({ dataReady: false }), "GET", "/knowledge").ok, "settings and notes stay available while the data is being connected");
});

test("every /api route except health and login needs a session", async () => {
  for (const [method, url] of [["GET", "/api/settings"], ["GET", "/api/knowledge"], ["GET", "/api/logs"], ["POST", "/api/assistant/ask"], ["GET", "/api/plataforma/empresas"], ["GET", "/api/auth/me"]] as const) {
    assert.equal((await call(method, url)).status, 401, `${method} ${url}`);
  }
  assert.equal((await call("GET", "/api/healthz")).status, 200);
});

test("login refuses wrong credentials without saying which part was wrong", async () => {
  await seedUser("administrador", 1, "admin1");
  const wrongPassword = await call("POST", "/api/auth/login", { body: { email: mail("admin1"), senha: "errada-errada" } });
  const unknownEmail = await call("POST", "/api/auth/login", { body: { email: mail("ninguem"), senha: "errada-errada" } });
  assert.equal(wrongPassword.status, 401); assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.body.error, unknownEmail.body.error);
  const ok = await call("GET", "/api/auth/me", { as: "admin1" });
  assert.equal(ok.body.papel, "administrador"); assert.equal(ok.body.empresaId, 1);
});

test("the owner creates a company: temporary password, forced change, empty data, and isolation from company 1", async () => {
  // Owner account, created the way the install script does it.
  await db.insert(usersTable).values({ companyId: null, email: mail("dono"), name: "Dono", role: "dono", passwordHash: await hashPassword("senha-temporaria-1"), mustChangePassword: true });
  assert.equal((await login("dono", mail("dono"), "senha-temporaria-1")).status, 200);
  assert.equal((await call("GET", "/api/plataforma/empresas", { as: "dono" })).status, 403, "blocked until the password is changed");
  assert.equal((await call("POST", "/api/auth/senha", { as: "dono", body: { senhaAtual: "senha-temporaria-1", novaSenha: "curta" } })).status, 400);
  const changed = await call("POST", "/api/auth/senha", { as: "dono", body: { senhaAtual: "senha-temporaria-1", novaSenha: "senha-definitiva-1" } });
  assert.equal(changed.status, 204);
  assert.equal((await call("GET", "/api/auth/me", { as: "dono" })).status, 401, "the old session ended");
  assert.equal((await login("dono", mail("dono"), "senha-definitiva-1")).status, 200);

  const created = await call("POST", "/api/plataforma/empresas", { as: "dono", body: { nome: `Cliente ${tag}`, erp: "totvs", administrador: { nome: "Ana", email: mail("ana") } } });
  assert.equal(created.status, 201);
  createdCompanies.push(created.body.empresa.id);
  assert.equal(created.body.empresa.dadosProntos, false);
  assert.ok(created.body.senhaTemporaria.length >= 12);
  assert.equal((await call("POST", "/api/plataforma/empresas", { as: "dono", body: { nome: "Outra", erp: "totvs", administrador: { nome: "Ana", email: mail("ana") } } })).status, 400, "e-mail already used");

  const first = await login("ana", mail("ana"), created.body.senhaTemporaria);
  assert.equal(first.status, 200); assert.equal(first.body.trocarSenha, true);
  assert.equal((await call("POST", "/api/auth/senha", { as: "ana", body: { senhaAtual: created.body.senhaTemporaria, novaSenha: "senha-da-ana-123" } })).status, 204);
  assert.equal((await login("ana", mail("ana"), "senha-da-ana-123")).status, 200);

  // Data is not connected: the assistant refuses instead of answering with the demonstration data.
  const ask = await call("POST", "/api/assistant/ask", { as: "ana", body: { question: "faturamento de setembro", freedomLevel: 1, includeVoice: false } });
  assert.equal(ask.status, 409);
  assert.match(ask.body.error, /ainda não foi conectada/);

  // Notes taught by company 2 never reach company 1, and the reverse.
  const note = { category: "empresa", title: `Termo ${tag}`, content: "Chamamos de picking a separação dos pedidos no depósito." };
  assert.equal((await call("POST", "/api/knowledge", { as: "ana", body: note })).status, 201);
  const own = await call("GET", "/api/knowledge", { as: "ana" });
  assert.ok(own.body.some((i: { title: string }) => i.title === note.title));
  const other = await call("GET", "/api/knowledge", { as: "admin1" });
  assert.ok(!other.body.some((i: { title: string }) => i.title === note.title), "company 1 does not see company 2's notes");
  const id = own.body.find((i: { title: string }) => i.title === note.title).id;
  const del = await app.inject({ method: "DELETE", url: `/api/knowledge/${id}`, headers: { cookie: cookies.admin1! } });
  assert.equal(del.statusCode, 404, "company 1 cannot delete company 2's note");
  const logs = await call("GET", "/api/logs", { as: "ana" });
  assert.deepEqual(logs.body, []);
});

test("company administrators manage only their own people and keep at least one administrator", async () => {
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.name, `Cliente ${tag}`));
  const added = await call("POST", "/api/empresa/usuarios", { as: "ana", body: { nome: "Beto", email: mail("beto"), papel: "gestor" } });
  assert.equal(added.status, 201);
  assert.equal(added.body.usuario.papel, "gestor");
  const betoId = added.body.usuario.id;
  assert.equal((await call("POST", "/api/empresa/usuarios", { as: "ana", body: { nome: "Beto", email: mail("beto"), papel: "gestor" } })).status, 400, "duplicate e-mail");
  const users = await call("GET", "/api/empresa/usuarios", { as: "ana" });
  assert.deepEqual(users.body.map((u: { email: string }) => u.email).sort(), [mail("ana"), mail("beto")].sort());
  // A user of company 1 cannot be reached from company 2.
  const [outsider] = await db.select().from(usersTable).where(eq(usersTable.email, mail("admin1")));
  assert.equal((await call("PATCH", `/api/empresa/usuarios/${outsider!.id}`, { as: "ana", body: { ativo: false } })).status, 404);
  assert.equal((await call("POST", `/api/empresa/usuarios/${outsider!.id}/redefinir-senha`, { as: "ana" })).status, 404);
  const [ana] = await db.select().from(usersTable).where(eq(usersTable.email, mail("ana")));
  assert.equal((await call("PATCH", `/api/empresa/usuarios/${ana!.id}`, { as: "ana", body: { ativo: false } })).status, 400, "last administrator");

  // The manager can ask but cannot read notes or manage users; deactivating ends the session.
  const reset = await call("POST", `/api/empresa/usuarios/${betoId}/redefinir-senha`, { as: "ana" });
  assert.equal(reset.status, 200);
  assert.equal((await login("beto", mail("beto"), reset.body.senhaTemporaria)).status, 200);
  assert.equal((await call("POST", "/api/auth/senha", { as: "beto", body: { senhaAtual: reset.body.senhaTemporaria, novaSenha: "senha-do-beto-123" } })).status, 204);
  assert.equal((await login("beto", mail("beto"), "senha-do-beto-123")).status, 200);
  assert.equal((await call("GET", "/api/knowledge", { as: "beto" })).status, 403);
  assert.equal((await call("GET", "/api/empresa/usuarios", { as: "beto" })).status, 403);
  assert.equal((await call("PATCH", `/api/empresa/usuarios/${betoId}`, { as: "ana", body: { ativo: false } })).status, 200);
  assert.equal((await call("GET", "/api/auth/me", { as: "beto" })).status, 401, "deactivated users lose the session");
  assert.equal((await login("beto", mail("beto"), "senha-do-beto-123")).status, 401);
  // A deactivated company locks everyone out.
  assert.equal((await call("PATCH", `/api/plataforma/empresas/${company!.id}`, { as: "dono", body: { ativa: false } })).status, 200);
  assert.equal((await call("GET", "/api/auth/me", { as: "ana" })).status, 401);
});
