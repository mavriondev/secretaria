import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";

const tag = Math.random().toString(36).slice(2, 8);
const email = `dono.sistema.${tag}@teste.local`;
const cookies: Record<string, string> = {};

async function call(method: "GET" | "POST", url: string, options: { as?: string; body?: unknown } = {}) {
  const res = await app.inject({ method, url, payload: options.body as object | undefined, headers: options.as ? { cookie: cookies[options.as]! } : {} });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, setCookie: res.headers["set-cookie"] as string | undefined };
}

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await db.insert(usersTable).values({ companyId: null, email, name: "Dono", role: "dono", passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  const res = await call("POST", "/api/auth/login", { body: { email, senha: "senha-de-teste-1" } });
  assert.equal(res.status, 200); cookies.dono = String(res.setCookie).split(";")[0]!;
});
after(async () => { await db.delete(usersTable).where(eq(usersTable.email, email)); await app.close(); await pool.end(); });

test("owner system tools answer and stay closed to anonymous callers", async () => {
  assert.equal((await call("GET", "/api/plataforma/sistema")).status, 401);
  const sistema = await call("GET", "/api/plataforma/sistema", { as: "dono" });
  assert.equal(sistema.status, 200);
  assert.ok(["replit", "vps", "unknown"].includes(sistema.body.versao.installation));
  assert.ok(["ligado", "desligado"].includes(sistema.body.agendador));
  assert.ok(sistema.body.empresas.total >= 1 && sistema.body.usuarios.total >= 1);
  assert.equal(typeof sistema.body.voz.status, "string");

  const uso = await call("GET", "/api/plataforma/uso?dias=7", { as: "dono" });
  assert.equal(uso.status, 200);
  assert.equal(uso.body.dias, 7);
  const demo = uso.body.empresas.find((e: { empresaId: number }) => e.empresaId === 1);
  assert.ok(demo && typeof demo.custoUsd === "number" && "limiteUsd" in demo.limite);

  const resumo = await call("GET", "/api/plataforma/empresas/1/resumo", { as: "dono" });
  assert.equal(resumo.status, 200);
  assert.equal(typeof resumo.body.usuarios.total, "number");
  assert.equal((await call("GET", "/api/plataforma/empresas/999999/resumo", { as: "dono" })).status, 404);
});
