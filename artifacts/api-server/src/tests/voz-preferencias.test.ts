import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { companiesTable, db, usersTable, voicePreferencesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { hashPassword } from "../lib/auth";

/** Microphone preferences are per person: defaults until saved, partial updates, invalid values refused, another person untouched. */
const tag = `voz_${Date.now()}`;
let companyId = 0; const userIds: number[] = []; const cookies: string[] = [];
before(async () => {
  await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Voz ${tag}`, erp: "outro", monthlyLimitUsd: "100" }).returning();
  companyId = c!.id;
  for (const n of [1, 2]) {
    const email = `gestor${n}.${tag}@example.invalid`;
    const [u] = await db.insert(usersTable).values({ name: tag, email, companyId, role: "gestor", mustChangePassword: false, passwordHash: await hashPassword("test-voz-123") }).returning();
    userIds.push(u!.id);
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "test-voz-123" } });
    cookies.push(String(r.headers["set-cookie"]).split(";")[0]!);
  }
});
after(async () => {
  await db.delete(voicePreferencesTable).where(inArray(voicePreferencesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await app.close();
});

test("defaults apply before anything is saved and the session is required", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/voz/preferencias" });
  assert.equal(anon.statusCode, 401);
  const r = await app.inject({ method: "GET", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { envio: "automatico", ambiente: "normal" });
});
test("partial updates keep the other preference and are per person", async () => {
  let r = await app.inject({ method: "PUT", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! }, payload: { envio: "eu_envio" } });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.json(), { envio: "eu_envio", ambiente: "normal" });
  r = await app.inject({ method: "PUT", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! }, payload: { ambiente: "ruidoso" } });
  assert.deepEqual(r.json(), { envio: "eu_envio", ambiente: "ruidoso" });
  r = await app.inject({ method: "GET", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! } });
  assert.deepEqual(r.json(), { envio: "eu_envio", ambiente: "ruidoso" });
  const other = await app.inject({ method: "GET", url: "/api/voz/preferencias", headers: { cookie: cookies[1]! } });
  assert.deepEqual(other.json(), { envio: "automatico", ambiente: "normal" });
  const [row] = await db.select().from(voicePreferencesTable).where(eq(voicePreferencesTable.userId, userIds[0]!));
  assert.equal(row?.companyId, companyId);
});
test("unknown values and unknown fields are refused", async () => {
  for (const payload of [{ envio: "sempre" }, { ambiente: "silencioso" }, { outro: 1 }]) {
    const r = await app.inject({ method: "PUT", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! }, payload });
    assert.equal(r.statusCode, 400, JSON.stringify(payload));
  }
  const r = await app.inject({ method: "GET", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! } });
  assert.deepEqual(r.json(), { envio: "eu_envio", ambiente: "ruidoso" });
});

test("answer form is authenticated, saved per person and does not overwrite microphone preferences", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/respostas/preferencias" })).statusCode, 401);
  const request = (method: "GET" | "PUT", n = 0, payload?: unknown) => app.inject({
    method, url: "/api/respostas/preferencias", headers: { cookie: cookies[n]! }, ...(payload ? { payload } : {}),
  });
  assert.deepEqual((await request("GET")).json(), { forma: "automatico" });
  const saved = await request("PUT", 0, { forma: "texto" });
  assert.equal(saved.statusCode, 200); assert.deepEqual(saved.json(), { forma: "texto" });
  assert.deepEqual((await request("GET")).json(), { forma: "texto" });
  assert.deepEqual((await request("GET", 1)).json(), { forma: "automatico" });
  const mic = await app.inject({ method: "GET", url: "/api/voz/preferencias", headers: { cookie: cookies[0]! } });
  assert.deepEqual(mic.json(), { envio: "eu_envio", ambiente: "ruidoso" });
  for (const bad of [{ forma: "pizza" }, { forma: "tabela", usuarioId: userIds[1] }]) assert.equal((await request("PUT", 0, bad)).statusCode, 400);
});

test("administrator changes only their own preference; product owner retains the existing company-access denial", async () => {
  for (const role of ["administrador", "dono"] as const) {
    await db.update(usersTable).set({ role }).where(eq(usersTable.id, userIds[0]!));
    const r = await app.inject({ method: "PUT", url: "/api/respostas/preferencias", headers: { cookie: cookies[0]! }, payload: { forma: "tabela" } });
    assert.equal(r.statusCode, role === "dono" ? 403 : 200, role);
    if (role === "administrador") assert.deepEqual(r.json(), { forma: "tabela" });
    const other = await app.inject({ method: "GET", url: "/api/respostas/preferencias", headers: { cookie: cookies[1]! } });
    assert.deepEqual(other.json(), { forma: "automatico" });
  }
});
