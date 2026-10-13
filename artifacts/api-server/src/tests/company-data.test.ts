import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { companiesTable, db, usersTable, pool } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { DEMO_FICHA } from "../lib/ficha";
import { closeCompanyPools } from "../lib/company-data";

// A second database holding the same views with different numbers (every item value doubled). Skipped when it is not provisioned.
const SECOND = process.env.SECOND_DATABASE_URL;
const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
let companyId = 0;
process.env.COMPANY_DATA_KEY ||= "chave-de-teste-com-mais-de-16-caracteres";

async function call(method: "GET" | "POST" | "PUT", url: string, as: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function seed(key: string, role: "dono" | "administrador", company: number | null) {
  const email = `${key}.${tag}@teste.local`.toLowerCase();
  await db.insert(usersTable).values({ companyId: company, email, name: `${key}-${tag}`, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const period = { startDate: day(-60), endDate: day(0), referenceDate: day(0), productLimit: 3 };

before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Empresa B ${tag}`, erp: "outro", dataReady: false }).returning();
  companyId = c!.id;
  await seed("dono", "dono", null); await seed("adminA", "administrador", 1); await seed("adminB", "administrador", companyId);
});
after(async () => {
  await closeCompanyPools();
  for (const key of ["dono", "adminA", "adminB", "adminB2"]) await db.delete(usersTable).where(eq(usersTable.email, `${key}.${tag}@teste.local`.toLowerCase()));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await app.close(); await pool.end();
});

test("a company without a connected database is closed, never served the demonstration data", async () => {
  assert.equal((await call("POST", "/api/conference", "adminB", period)).status, 409);
});

test("a wrong address or incomplete ficha is refused and nothing is stored", { skip: !SECOND }, async () => {
  const bad = await call("PUT", `/api/plataforma/empresas/${companyId}/dados`, "dono", { url: "postgresql://x:y@127.0.0.1:1/nada", ficha: DEMO_FICHA });
  assert.equal(bad.status, 422); assert.equal(bad.body.ok, false);
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  assert.equal(row!.dataReady, false); assert.equal(row!.dataUrlEnc, null);
  assert.equal((await call("PUT", `/api/plataforma/empresas/${companyId}/dados`, "dono", { url: SECOND, ficha: { visoes: [] } })).status, 422);
});

test("each company reads only its own database, and the stored address is encrypted", { skip: !SECOND }, async () => {
  const ok = await call("PUT", `/api/plataforma/empresas/${companyId}/dados`, "dono", { url: SECOND, ficha: DEMO_FICHA });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  assert.ok(row!.dataReady && row!.dataUrlEnc && !row!.dataUrlEnc.includes("postgres"));
  assert.ok(!JSON.stringify((await call("GET", `/api/plataforma/empresas/${companyId}/dados`, "dono")).body).includes(SECOND!));
  await seed("adminB2", "administrador", companyId); // the data-ready flag is read at login
  const a = await call("POST", "/api/conference", "adminA", period);
  const b = await call("POST", "/api/conference", "adminB2", period);
  assert.equal(a.status, 200); assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.notEqual(JSON.stringify(a.body.results[0]), JSON.stringify(b.body.results[0]), "the two companies must not return the same numbers");
  assert.equal((await call("GET", "/api/demo/status", "adminB2")).status, 404);
  assert.equal((await call("GET", "/api/demo/status", "adminA")).status, 200);
});
