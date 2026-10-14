import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, db, passwordResetsTable, pool, sessionsTable, usersTable } from "@workspace/db";
import app from "../app";
import {
  consumePasswordReset, createPasswordReset, createSession, deviceLabel, ensureDemoCompany, hashPassword, listSessions, RENEW_EVERY_MS, renewSession,
  SESSION_DAYS, sessionCookie, SHORT_SESSION_HOURS, userFromToken,
} from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const mail = (name: string) => `${name.toLowerCase()}.${tag}@teste.local`;
const PASS = "senha-de-teste-1";
let companyA = 0, companyB = 0;
const ids: Record<string, number> = {};

async function call(method: "GET" | "POST" | "DELETE", url: string, options: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.inject({ method, url, payload: options.body as object | undefined, headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers } });
  return { status: res.statusCode, body: res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null, setCookie: String(res.headers["set-cookie"] ?? "") };
}
const cookieOf = (setCookie: string) => setCookie.split(";")[0]!;
async function login(email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await call("POST", "/api/auth/login", { body: { email, senha: PASS, ...extra }, headers });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { cookie: cookieOf(res.setCookie), setCookie: res.setCookie };
}
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const [row] = await db.insert(usersTable).values({ companyId, email: mail(key), name: key, role, passwordHash: await hashPassword(PASS), mustChangePassword: false }).returning();
  ids[key] = row!.id;
  return row!.id;
}

before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [a] = await db.insert(companiesTable).values({ name: `Sessão A ${tag}`, erp: "outro" }).returning();
  const [b] = await db.insert(companiesTable).values({ name: `Sessão B ${tag}`, erp: "outro" }).returning();
  companyA = a!.id; companyB = b!.id;
  await seed("adminA", "administrador", companyA);
  await seed("gestorA", "gestor", companyA);
  await seed("adminB", "administrador", companyB);
});
after(async () => {
  const userIds = Object.values(ids);
  await db.delete(passwordResetsTable).where(inArray(passwordResetsTable.userId, userIds));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
  await app.close(); await pool.end();
});

test("device label is short and never the raw user agent", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"), "Android · Chrome");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0"), "Windows · Edge");
  assert.equal(deviceLabel(undefined), "Aparelho · navegador");
});

test("persistent session: 60 days, renewed at most once an hour, cookie follows", async () => {
  const { token, expiresAt } = await createSession(ids.gestorA!, { persistent: true });
  const expectedDays = Math.round((expiresAt.getTime() - Date.now()) / 86_400_000);
  assert.equal(expectedDays, SESSION_DAYS);
  assert.equal(await renewSession(token), null, "just created: nothing to renew yet");
  const later = new Date(Date.now() + RENEW_EVERY_MS + 1000);
  const renewed = await renewSession(token, later);
  assert.ok(renewed && renewed.persistent);
  assert.equal(Math.round((renewed!.expiresAt.getTime() - later.getTime()) / 86_400_000), SESSION_DAYS, "the end moved forward from the new use");
  assert.equal(await renewSession(token, new Date(later.getTime() + 60_000)), null, "a second use within the hour does not write again");
  assert.match(sessionCookie(token, renewed!.expiresAt, true), /Expires=.*; Secure$/);
  assert.doesNotMatch(sessionCookie(token, renewed!.expiresAt, true, false), /Expires=/, "a non-persistent cookie ends with the browser");
});

test("expired session is refused and not renewed", async () => {
  const { token, expiresAt } = await createSession(ids.gestorA!, { persistent: false });
  const hours = Math.round((expiresAt.getTime() - Date.now()) / 3_600_000);
  assert.ok(hours >= SHORT_SESSION_HOURS - 1 && hours <= SHORT_SESSION_HOURS, `short session lasts about ${SHORT_SESSION_HOURS}h (got ${hours})`);
  const afterEnd = new Date(Date.now() + (SHORT_SESSION_HOURS + 1) * 3_600_000);
  assert.equal(await renewSession(token, afterEnd), null);
  await db.update(sessionsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessionsTable.userId, ids.gestorA!));
  assert.equal(await userFromToken(token), null);
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, ids.gestorA!));
});

test("login: 'manter' decides the cookie kind; the response renews a persistent cookie", async () => {
  const kept = await login(mail("gestorA"), { manter: true }, { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" });
  assert.match(kept.setCookie, /Expires=/);
  const brief = await login(mail("gestorA"), { manter: false });
  assert.doesNotMatch(brief.setCookie, /Expires=/);
  const me = await call("GET", "/api/auth/me", { cookie: kept.cookie });
  assert.equal(me.status, 200);
  const list = await call("GET", "/api/auth/sessoes", { cookie: kept.cookie });
  assert.equal(list.status, 200);
  const sessions = list.body.sessoes as Array<{ id: number; aparelho: string; atual: boolean; persistente: boolean }>;
  assert.equal(sessions.length, 2);
  assert.ok(sessions[0]!.atual && sessions[0]!.aparelho === "iPhone · Safari" && sessions[0]!.persistente);
  assert.ok(!sessions[1]!.atual && !sessions[1]!.persistente);
  assert.equal(list.body.emailConfigurado, false);
  // Ends the other device; the current one keeps working.
  const ended = await call("DELETE", `/api/auth/sessoes/${sessions[1]!.id}`, { cookie: kept.cookie });
  assert.equal(ended.status, 204);
  assert.equal((await call("GET", "/api/auth/me", { cookie: brief.cookie })).status, 401);
  assert.equal((await call("GET", "/api/auth/me", { cookie: kept.cookie })).status, 200);
  // Ends every device, including this one.
  const all = await call("POST", "/api/auth/sessoes/encerrar-todas", { cookie: kept.cookie });
  assert.equal(all.status, 204); assert.match(all.setCookie, /Max-Age=0/);
  assert.equal((await call("GET", "/api/auth/me", { cookie: kept.cookie })).status, 401);
});

test("a session id of another user cannot be ended through 'Meus aparelhos'", async () => {
  const a = await login(mail("gestorA"));
  const b = await login(mail("adminB"));
  const mine = (await call("GET", "/api/auth/sessoes", { cookie: a.cookie })).body.sessoes as Array<{ id: number }>;
  const res = await call("DELETE", `/api/auth/sessoes/${mine[0]!.id}`, { cookie: b.cookie });
  assert.equal(res.status, 404);
  assert.equal((await call("GET", "/api/auth/me", { cookie: a.cookie })).status, 200);
});

test("administrator ends the sessions of a user of the own company only; the list shows session counts", async () => {
  const admin = await login(mail("adminA"));
  await login(mail("gestorA"));
  const list = await call("GET", "/api/empresa/usuarios", { cookie: admin.cookie });
  const gestor = (list.body as Array<{ id: number; sessoes: number }>).find(u => u.id === ids.gestorA);
  assert.ok(gestor && gestor.sessoes >= 2);
  assert.equal((await call("POST", `/api/empresa/usuarios/${ids.adminB}/encerrar-sessoes`, { cookie: admin.cookie })).status, 404, "other company");
  assert.equal((await call("POST", `/api/empresa/usuarios/${ids.gestorA}/encerrar-sessoes`, { cookie: admin.cookie })).status, 204);
  assert.equal(await listSessions(ids.gestorA!, undefined).then(s => s.length), 0);
});

test("reset link: single use, expires, refused for other company, ends every session", async () => {
  const admin = await login(mail("adminA"));
  const gestor = await login(mail("gestorA"));
  assert.equal((await call("POST", `/api/empresa/usuarios/${ids.adminB}/link-redefinicao`, { cookie: admin.cookie })).status, 404, "other company");
  const made = await call("POST", `/api/empresa/usuarios/${ids.gestorA}/link-redefinicao`, { cookie: admin.cookie });
  assert.equal(made.status, 200);
  const { token, validadeMin } = made.body as { token: string; validadeMin: number };
  assert.equal(validadeMin, 60);
  const [stored] = await db.select().from(passwordResetsTable).where(eq(passwordResetsTable.userId, ids.gestorA!));
  assert.ok(stored && stored.tokenHash !== token && stored.createdBy === ids.adminA, "only the hash is stored, with who generated it");
  assert.equal((await call("POST", "/api/auth/redefinir", { body: { token, novaSenha: "curta" } })).status, 400);
  assert.equal((await call("POST", "/api/auth/redefinir", { body: { token: token.slice(0, -1) + "x", novaSenha: "nova-senha-valida-1" } })).status, 400, "wrong token");
  const ok = await call("POST", "/api/auth/redefinir", { body: { token, novaSenha: "nova-senha-valida-1" } });
  assert.equal(ok.status, 204);
  assert.equal((await call("GET", "/api/auth/me", { cookie: gestor.cookie })).status, 401, "old sessions ended");
  const reuse = await call("POST", "/api/auth/redefinir", { body: { token, novaSenha: "outra-senha-valida-2" } });
  assert.equal(reuse.status, 400); assert.match(reuse.body.error, /não é válido ou já expirou/);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: mail("gestorA"), senha: "nova-senha-valida-1" } })).status, 200);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: mail("gestorA"), senha: PASS } })).status, 401);
  // Expired link.
  const expired = await createPasswordReset(ids.gestorA!, ids.adminA!);
  await db.update(passwordResetsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetsTable.userId, ids.gestorA!));
  assert.equal(await consumePasswordReset(expired.token, "senha-apos-expirar-3"), null);
  // A newer link invalidates the previous unused one.
  const first = await createPasswordReset(ids.gestorA!, ids.adminA!);
  const second = await createPasswordReset(ids.gestorA!, ids.adminA!);
  assert.equal(await consumePasswordReset(first.token, "senha-link-antigo-4"), null);
  assert.ok(await consumePasswordReset(second.token, "senha-link-novo-5"));
});
