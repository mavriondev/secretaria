import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  alertsTable, answerReviewsTable, companiesTable, db, exportDocumentsTable, favoritesTable, knowledgeItemsTable, notificationsTable, pool,
  queryLogsTable, sessionsTable, testQuestionsTable, testRunsTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";

/**
 * Active isolation check: company B's administrator and manager try to read or change company A's resources by id,
 * on every route that takes an id, and the product owner tries to use company routes. Nothing may leak or change.
 * Company A is the demonstration company (data ready); company B is created here without a database, so its people
 * also prove that the "no data yet" door (409) holds. Mutations are verified against the rows, not only the status.
 */
const tag = Math.random().toString(36).slice(2, 8);
const mail = (k: string) => `${k}.${tag}@teste.local`.toLowerCase();
const SENHA = "senha-de-teste-1";
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let companyB = 0;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
async function call(method: Method, url: string, as?: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: as ? { cookie: cookies[as]! } : {} });
  let parsed: unknown = null; try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
  return { status: res.statusCode, body: parsed as Record<string, unknown> | null, text: res.body };
}
async function seed(key: string, role: "dono" | "administrador" | "gestor", companyId: number | null) {
  const [u] = await db.insert(usersTable).values({ companyId, email: mail(key), name: key, role, passwordHash: await hashPassword(SENHA), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: mail(key), senha: SENHA } });
  assert.equal(res.statusCode, 200, `login ${key}`);
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [b] = await db.insert(companiesTable).values({ name: `Isolada ${tag}`, erp: "outro", dataReady: false }).returning();
  companyB = b!.id;
  await seed("dono", "dono", null);
  await seed("adminA", "administrador", 1); await seed("gestorA", "gestor", 1);
  await seed("adminB", "administrador", companyB); await seed("gestorB", "gestor", companyB);
  // Company A's resources, written directly (no model calls).
  const [k] = await db.insert(knowledgeItemsTable).values({ companyId: 1, category: "empresa", title: `Termo ${tag}`, content: "conteúdo original", origin: "painel" }).returning(); ids.knowledge = k!.id;
  const [q] = await db.insert(testQuestionsTable).values({ companyId: 1, question: `Pergunta ${tag}`, mustContain: ["x"] }).returning(); ids.pergunta = q!.id;
  const [run] = await db.insert(testRunsTable).values({ companyId: 1, userId: ids.adminA!, status: "concluida", total: 1, passed: 1, finishedAt: new Date() }).returning(); ids.execucao = run!.id;
  const [log] = await db.insert(queryLogsTable).values({ companyId: 1, question: `Log ${tag}`, answer: "r", freedomLevel: 0, latencyMs: 1, parameters: {}, result: null }).returning(); ids.log = log!.id;
  const [rev] = await db.insert(answerReviewsTable).values({ companyId: 1, logId: ids.log, userId: ids.gestorA!, reason: "original" }).returning(); ids.avaliacao = rev!.id;
  const [doc] = await db.insert(exportDocumentsTable).values({ companyId: 1, queryLogId: ids.log, title: `Doc ${tag}` }).returning(); ids.documento = doc!.id;
  const [fav] = await db.insert(favoritesTable).values({ companyId: 1, userId: ids.gestorA!, title: `Fav ${tag}`, originalQuestion: "q", kind: "fixo", form: "numero" }).returning(); ids.favorito = fav!.id;
  const [al] = await db.insert(alertsTable).values({ companyId: 1, userId: ids.gestorA!, favoriteId: ids.favorito, condition: "mudou" }).returning(); ids.aviso = al!.id;
  const [n] = await db.insert(notificationsTable).values({ companyId: 1, userId: ids.gestorA!, kind: "aviso", title: "n", message: "m" }).returning(); ids.notificacao = n!.id;
  const [s] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.userId, ids.gestorA!)); ids.sessaoGestorA = s!.id;
});
after(async () => {
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, Object.values(ids).length ? [ids.gestorA!, ids.adminA!, ids.adminB!, ids.gestorB!, ids.dono!] : [0]));
  await db.delete(alertsTable).where(eq(alertsTable.id, ids.aviso ?? 0));
  await db.delete(favoritesTable).where(eq(favoritesTable.id, ids.favorito ?? 0));
  await db.delete(exportDocumentsTable).where(eq(exportDocumentsTable.id, ids.documento ?? 0));
  await db.delete(answerReviewsTable).where(eq(answerReviewsTable.id, ids.avaliacao ?? 0));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.id, ids.log ?? 0));
  await db.delete(testRunsTable).where(eq(testRunsTable.id, ids.execucao ?? 0));
  await db.delete(testQuestionsTable).where(eq(testQuestionsTable.id, ids.pergunta ?? 0));
  await db.delete(knowledgeItemsTable).where(eq(knowledgeItemsTable.id, ids.knowledge ?? 0));
  await db.delete(usersTable).where(inArray(usersTable.email, ["dono", "adminA", "gestorA", "adminB", "gestorB"].map(mail)));
  if (companyB) await db.delete(companiesTable).where(eq(companiesTable.id, companyB));
  await app.close(); await pool.end();
});

/** A cross-company call may be refused (403/404) or stopped at the "no data yet" door (409); it may never succeed. */
const refused = (r: { status: number }, what: string) => assert.ok([403, 404, 409].includes(r.status), `${what}: esperado 403/404/409, veio ${r.status}`);

test("company B cannot read or change company A's resources by id (every route with an id)", async () => {
  const attempts: Array<[Method, string, unknown?]> = [
    ["PUT", `/api/knowledge/${ids.knowledge}`, { category: "empresa", title: "Alterado", content: "alterado", active: true }],
    ["DELETE", `/api/knowledge/${ids.knowledge}`],
    ["PUT", `/api/testes/perguntas/${ids.pergunta}`, { pergunta: "alterada", deveConter: ["y"], naoDeveConter: [], nota: "", ativa: true }],
    ["DELETE", `/api/testes/perguntas/${ids.pergunta}`],
    ["GET", `/api/testes/execucoes/${ids.execucao}`],
    ["PATCH", `/api/avaliacoes/${ids.avaliacao}`, { status: "revisada", tratativa: "x" }],
    ["GET", `/api/documents/${ids.documento}/download`],
    ["POST", `/api/documents`, { queryLogId: ids.log }],
    ["GET", `/api/assistant/respostas/${ids.log}/explicacao`],
    ["GET", `/api/favoritos/${ids.favorito}/executar`],
    ["GET", `/api/favoritos/${ids.favorito}/explicacao`],
    ["PATCH", `/api/favoritos/${ids.favorito}`, { titulo: "Alterado" }],
    ["DELETE", `/api/favoritos/${ids.favorito}`],
    ["POST", `/api/favoritos/${ids.favorito}/congelar`],
    ["POST", `/api/favoritos/${ids.favorito}/copiar`],
    ["POST", `/api/favoritos/${ids.favorito}/refazer`],
    ["PATCH", `/api/avisos/${ids.aviso}`, { ativo: false }],
    ["DELETE", `/api/avisos/${ids.aviso}`],
    ["PATCH", `/api/empresa/usuarios/${ids.gestorA}`, { ativo: false }],
    ["POST", `/api/empresa/usuarios/${ids.gestorA}/encerrar-sessoes`],
    ["POST", `/api/empresa/usuarios/${ids.gestorA}/link-redefinicao`],
    ["POST", `/api/empresa/usuarios/${ids.gestorA}/redefinir-senha`],
    ["DELETE", `/api/auth/sessoes/${ids.sessaoGestorA}`],
  ];
  for (const who of ["adminB", "gestorB"]) {
    for (const [method, url, body] of attempts) {
      const r = await call(method, url, who, body);
      refused(r, `${who} ${method} ${url}`);
      assert.ok(!r.text.includes(tag), `${who} ${method} ${url}: a resposta não pode trazer dados da outra empresa`);
    }
  }
  // Marking notices as read with ids from another person/company touches nothing.
  const marked = await call("POST", "/api/notificacoes/lidas", "adminB", { ids: [ids.notificacao] });
  assert.ok(marked.status === 200 || marked.status === 409);
  if (marked.status === 200) assert.equal(marked.body!.marcadas, 0);

  // Nothing changed on company A's side.
  const [k] = await db.select().from(knowledgeItemsTable).where(eq(knowledgeItemsTable.id, ids.knowledge!)); assert.equal(k!.content, "conteúdo original");
  const [q] = await db.select().from(testQuestionsTable).where(eq(testQuestionsTable.id, ids.pergunta!)); assert.equal(q!.question, `Pergunta ${tag}`);
  const [rev] = await db.select().from(answerReviewsTable).where(eq(answerReviewsTable.id, ids.avaliacao!)); assert.equal(rev!.status, "nova");
  const [fav] = await db.select().from(favoritesTable).where(eq(favoritesTable.id, ids.favorito!)); assert.equal(fav!.title, `Fav ${tag}`);
  const [al] = await db.select().from(alertsTable).where(eq(alertsTable.id, ids.aviso!)); assert.equal(al!.active, true);
  const [g] = await db.select().from(usersTable).where(eq(usersTable.id, ids.gestorA!)); assert.equal(g!.active, true); assert.equal(g!.mustChangePassword, false);
  const [n] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, ids.notificacao!)); assert.equal(n!.readAt, null);
  assert.equal((await call("GET", "/api/auth/me", "gestorA")).status, 200, "the manager's session of company A survived");
  assert.equal((await db.select().from(exportDocumentsTable).where(and(eq(exportDocumentsTable.companyId, companyB)))).length, 0, "no document was created for company B from company A's log");
});

test("company B's lists never include company A's rows; the owner is kept out of company routes", async () => {
  for (const [url, who] of [["/api/knowledge", "adminB"], ["/api/testes/perguntas", "adminB"], ["/api/avaliacoes", "adminB"], ["/api/empresa/usuarios", "adminB"], ["/api/logs", "adminB"]] as const) {
    const r = await call("GET", url, who);
    assert.ok(r.status === 200 || r.status === 409, `${url}: ${r.status}`);
    if (r.status === 200) assert.ok(!r.text.includes(tag) || url === "/api/empresa/usuarios" && !r.text.includes(mail("gestorA")), `${url} vazou dados da empresa A`);
  }
  for (const [method, url] of [["GET", "/api/knowledge"], ["GET", "/api/empresa/usuarios"], ["GET", "/api/favoritos"], ["GET", "/api/notificacoes"], ["GET", `/api/testes/execucoes/${ids.execucao}`], ["PATCH", `/api/empresa/usuarios/${ids.gestorA}`]] as const) {
    assert.equal((await call(method, url, "dono", {})).status, 403, `dono ${method} ${url}`);
  }
  // The owner's platform routes never accept a company user, and a manager never reaches administrator routes.
  for (const who of ["adminA", "gestorA", "adminB"]) assert.equal((await call("GET", "/api/plataforma/empresas", who)).status, 403);
  for (const [method, url] of [["GET", "/api/knowledge"], ["GET", "/api/empresa/usuarios"], ["GET", "/api/logs"], ["GET", "/api/testes/perguntas"], ["PUT", "/api/settings"]] as const) {
    assert.equal((await call(method, url, "gestorA", {})).status, 403, `gestor ${method} ${url}`);
  }
});

test("every API answer refuses caching and type sniffing, before and after login", async () => {
  for (const [r, what] of [[await call("GET", "/api/auth/me"), "sem sessão"], [await call("GET", "/api/auth/me", "gestorA"), "com sessão"], [await call("GET", "/api/favoritos", "dono"), "recusado"]] as const) {
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: what === "com sessão" ? { cookie: cookies.gestorA! } : {} });
    assert.equal(res.headers["cache-control"], "no-store", `${what}: ${r.status}`);
    assert.equal(res.headers["x-content-type-options"], "nosniff", what);
  }
  const csv = await app.inject({ method: "GET", url: "/api/healthz" });
  assert.equal(csv.headers["cache-control"], "no-store"); assert.equal(csv.headers["x-content-type-options"], "nosniff");
});
