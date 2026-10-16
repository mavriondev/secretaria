import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { companiesTable, db, favoritesTable, panelAuditTable, panelCompanyTable, panelsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, ensureDemoCompany } from "../lib/auth";
import { montarResultado } from "../lib/favoritos";
import { runFreeQuery } from "../lib/free-query";
import { hashCode, issueCode, normalizeSlug, painelEntrada } from "../lib/paineis";
import { clearPanelRuntime, panelRate, panelRuntimeSize, publicCardData } from "../lib/painel-publico";
import type { CardData } from "../lib/apresentacao-grafica";

const tag = randomUUID().slice(0, 8);
const actors: Record<string, { id: number; cookie: string }> = {};
const favs: Record<string, number> = {};
let otherCompany = 0, hadSlug = false;
const body = (nome = `TV ${tag}`, favoritoId: number | null = null) => ({
  nome, modelo: "grade", tema: "escuro", atualizacaoSegundos: 300, rotacaoSegundos: 20,
  ordemAutomatica: true, expiraEm: null, cartoes: favoritoId ? [{ favoritoId, tamanho: "auto", pagina: null }] : [],
});
async function call(method: "GET" | "POST" | "PUT", url: string, actor = "admin", payload?: unknown) {
  return app.inject({ method, url, ...(payload ? { payload: payload as object } : {}), headers: actor ? { cookie: actors[actor]!.cookie } : {} });
}
function parseLink(link: string) { const [, , slug, code] = link.split("/"); return { slug: slug!, code: code! }; }
async function pub(link: string, ip = "192.0.2.1") {
  const { slug, code } = parseLink(link);
  return app.inject({ method: "GET", url: `/api/painel/${slug}/dados`, headers: { authorization: `Painel ${code}`, "x-forwarded-for": ip } });
}
async function create(favoriteId: number | null = favs.numero!, actor = "admin") {
  const r = await call("POST", "/api/paineis", actor, body(`TV ${tag}`, favoriteId));
  assert.equal(r.statusCode, 201, r.body); return r.json();
}
const queries = {
  numero: "SELECT SUM(valor_liquido) AS total FROM vw_vendas_itens",
  ranking: "SELECT produto, SUM(valor_liquido) AS total FROM vw_vendas_itens GROUP BY produto ORDER BY total DESC LIMIT 5",
  serie: "SELECT data, SUM(valor_liquido) AS total FROM vw_vendas_itens GROUP BY data ORDER BY data LIMIT 10",
} as const;
before(async () => {
  await ensureDemoCompany(); await app.ready();
  hadSlug = (await db.select().from(panelCompanyTable).where(eq(panelCompanyTable.companyId, 1))).length > 0;
  const [company] = await db.insert(companiesTable).values({ name: `TV outra ${tag}`, erp: "outro", dataReady: false }).returning();
  otherCompany = company!.id;
  for (const [name, role, companyId] of [["admin", "administrador", 1], ["peer", "administrador", 1], ["gestor", "gestor", 1], ["global", "dono", null], ["linked", "dono", 1], ["other", "administrador", otherCompany]] as const) {
    const [u] = await db.insert(usersTable).values({ name: `TV teste ${tag}`, email: `tv-${name}-${tag}@teste.invalid`, role, companyId, passwordHash: "unused-test-only", mustChangePassword: false }).returning();
    const session = await createSession(u!.id);
    actors[name] = { id: u!.id, cookie: `tato_session=${session.token}` };
  }
  // Reuse the actual session cookie name, not an assumed fixture wire name.
  const { SESSION_COOKIE } = await import("../lib/auth");
  for (const a of Object.values(actors)) a.cookie = a.cookie.replace(/^tato_session=/, `${SESSION_COOKIE}=`);
  for (const [name, query] of Object.entries(queries)) {
    const result = await runFreeQuery(query);
    const form = name as "numero" | "ranking" | "serie";
    const [f] = await db.insert(favoritesTable).values({ companyId: 1, userId: actors.admin!.id, title: `TV ${name} ${tag}`, originalQuestion: "Consulta de teste TV", kind: "vivo", savedSql: query, form, formats: [] }).returning();
    favs[name] = f!.id;
    assert.equal(montarResultado(result, [], form).dados.form, form);
  }
  for (const [name, user, companyId, scope] of [["shared", "peer", 1, "empresa"], ["private", "peer", 1, "pessoal"], ["foreign", "other", otherCompany, "empresa"]] as const) {
    const [f] = await db.insert(favoritesTable).values({ companyId, userId: actors[user]!.id, title: name, originalQuestion: "Teste", kind: "fixo", fixedResult: montarResultado(await runFreeQuery(queries.numero), [], "numero"), form: "numero", scope }).returning();
    favs[name] = f!.id;
  }
});
after(async () => {
  clearPanelRuntime();
  await db.delete(panelsTable).where(inArray(panelsTable.creatorId, Object.values(actors).map(a => a.id)));
  await db.delete(favoritesTable).where(inArray(favoritesTable.id, Object.values(favs)));
  await db.delete(panelAuditTable).where(inArray(panelAuditTable.actorId, Object.values(actors).map(a => a.id)));
  await db.delete(usersTable).where(inArray(usersTable.id, Object.values(actors).map(a => a.id)));
  if (otherCompany) await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany));
  if (!hadSlug) await db.delete(panelCompanyTable).where(eq(panelCompanyTable.companyId, 1));
  await app.close(); await pool.end();
});
test("TV: código de 32 bytes, hash não reversível e normalização", () => {
  const a = issueCode(), b = issueCode(); assert.equal(Buffer.from(a.code, "base64url").length, 32);
  assert.equal(a.code.length, 43); assert.notEqual(a.code, b.code); assert.equal(a.hash, hashCode(a.code)); assert.equal(a.prefix.length, 6);
  assert.equal(normalizeSlug("J&M Fórros São Luís"), "j-m-forros-sao-luis");
});
test("TV: gestor/global owner negados; dono explicitamente vinculado tem só escopo TV", async () => {
  for (const actor of ["gestor", "global"]) {
    assert.equal((await call("GET", "/api/paineis", actor)).statusCode, 403);
    assert.equal((await call("POST", "/api/paineis", actor, body())).statusCode, 403);
  }
  assert.equal((await call("GET", "/api/paineis", "linked")).statusCode, 200);
  assert.equal((await call("GET", "/api/favoritos", "linked")).statusCode, 403);
});
let panel: { painel: { id: number }; link: string };
test("TV: criação real, link único e nenhum código completo em consultas posteriores", async () => {
  panel = await create(); const { code } = parseLink(panel.link);
  const [stored] = await db.select().from(panelsTable).where(eq(panelsTable.id, panel.painel.id));
  assert.equal(stored!.tokenHash, hashCode(code)); assert.notEqual(stored!.tokenHash, code);
  const get = await call("GET", `/api/paineis/${panel.painel.id}`);
  assert.equal(get.statusCode, 200); assert.ok(!get.body.includes(code)); assert.ok(!get.body.includes("codigo_hash"));
  assert.equal(get.json().auditoria[0].acao, "criado");
});
test("TV: somente favoritos visíveis ao criador e editor", async () => {
  for (const f of [favs.private!, favs.foreign!]) assert.equal((await call("POST", "/api/paineis", "admin", body("Proibido", f))).statusCode, 403);
  const choices = (await call("GET", "/api/paineis/favoritos")).json().itens;
  assert.ok(choices.some((f: { id: number }) => f.id === favs.shared)); assert.ok(!choices.some((f: { id: number }) => [favs.private, favs.foreign].includes(f.id)));
  assert.equal((await call("PUT", `/api/paineis/${panel.painel.id}`, "peer", body("Não roubar privado", favs.private!))).statusCode, 403);
});
test("TV: isolamento entre duas empresas em leitura/edição/regeneração/revogação", async () => {
  for (const [method, suffix, data] of [["GET", "", undefined], ["PUT", "", body()], ["POST", "/regenerar", undefined], ["POST", "/revogar", undefined]] as const) {
    assert.equal((await call(method, `/api/paineis/${panel.painel.id}${suffix}`, "other", data)).statusCode, 404);
  }
  assert.equal((await call("GET", "/api/paineis", "other")).json().paineis.length, 0);
});
test("TV: público sem sessão, cabeçalhos e somente dados do cartão", async () => {
  clearPanelRuntime(); const r = await pub(panel.link); assert.equal(r.statusCode, 200, r.body);
  for (const [header, value] of [["cache-control", "no-store"], ["referrer-policy", "no-referrer"], ["x-robots-tag", "noindex, nofollow, noarchive"]]) assert.equal(r.headers[header!], value);
  const d = r.json(); assert.equal(d.cartoes.length, 1); assert.equal(d.cartoes[0].estado, "ok");
  assert.ok(!/SELECT |sql_salvo|usuario_id|criador_id|favoritoId|codigo_hash|queryLogId/.test(r.body));
  for (const route of ["/api/favoritos", "/api/auth/me", "/api/assistant/ask", "/api/dados"]) {
    const r2 = await app.inject({ method: route.endsWith("ask") ? "POST" : "GET", url: route, headers: { authorization: `Painel ${parseLink(panel.link).code}` }, ...(route.endsWith("ask") ? { payload: { question: "vendas" } } : {}) });
    assert.equal(r2.statusCode, 401);
  }
});
test("TV: inválido, outra empresa, expirado e revogado produzem o mesmo 404", async () => {
  clearPanelRuntime(); const invalid = await pub(panel.link.replace(/.$/, "!"));
  assert.equal(invalid.statusCode, 404);
  const wrong = await pub(panel.link.replace(/\/painel\/[^/]+\//, "/painel/outra-empresa/"));
  assert.equal(wrong.statusCode, 404); assert.equal(wrong.body, invalid.body);
  await db.update(panelsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(panelsTable.id, panel.painel.id));
  const expired = await pub(panel.link); assert.equal(expired.statusCode, 404); assert.equal(expired.body, invalid.body);
  await db.update(panelsTable).set({ expiresAt: null }).where(eq(panelsTable.id, panel.painel.id));
  assert.equal((await call("POST", `/api/paineis/${panel.painel.id}/revogar`)).statusCode, 200);
  const revoked = await pub(panel.link); assert.equal(revoked.statusCode, 404); assert.equal(revoked.body, invalid.body);
});
test("TV: regenerar invalida imediatamente código antigo inclusive cache", async () => {
  const old = panel.link;
  const r = await call("POST", `/api/paineis/${panel.painel.id}/regenerar`); assert.equal(r.statusCode, 200); panel = r.json();
  assert.equal((await pub(old)).statusCode, 404); clearPanelRuntime(); assert.equal((await pub(panel.link)).statusCode, 200);
  assert.equal((await call("GET", `/api/paineis/${panel.painel.id}`)).json().auditoria[0].acao, "link_regenerado");
});
test("TV: compartilhamento retirado e criador desativado não vazam dados em cache", async () => {
  const p = await create(favs.shared!); clearPanelRuntime(); assert.equal((await pub(p.link)).json().cartoes.length, 1);
  await db.update(favoritesTable).set({ scope: "pessoal" }).where(eq(favoritesTable.id, favs.shared!));
  assert.equal((await pub(p.link)).json().cartoes.length, 0);
  assert.ok((await call("GET", `/api/paineis/${p.painel.id}`)).json().avisos.length);
  await db.update(favoritesTable).set({ scope: "empresa" }).where(eq(favoritesTable.id, favs.shared!));
  await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, actors.admin!.id));
  assert.equal((await pub(p.link)).json().cartoes.length, 0);
  await db.update(usersTable).set({ active: true }).where(eq(usersTable.id, actors.admin!.id));
});
test("TV: favorito apagado vira aviso discreto, nunca snapshot antigo", async () => {
  const [f] = await db.insert(favoritesTable).values({ companyId: 1, userId: actors.admin!.id, title: "Nome que deve desaparecer", originalQuestion: "Teste", kind: "fixo", fixedResult: montarResultado(await runFreeQuery(queries.numero), [], "numero"), form: "numero" }).returning();
  const p = await create(f!.id); clearPanelRuntime(); await pub(p.link); await db.delete(favoritesTable).where(eq(favoritesTable.id, f!.id));
  const r = await pub(p.link); assert.equal(r.statusCode, 200); assert.equal(r.json().cartoes[0].estado, "removido"); assert.ok(!r.body.includes("Nome que deve desaparecer")); assert.equal(r.json().cartoes[0].dados, null);
});
test("TV: três painéis, células iguais a SQL independente e sem IA", async () => {
  for (const [form, query] of Object.entries(queries)) {
    const p = form === "numero" ? panel : await create(favs[form]!); clearPanelRuntime();
    const actual = (await pub(p.link)).json().cartoes[0].dados;
    const expected = montarResultado(await runFreeQuery(query), [], form as "numero" | "serie" | "ranking").dados;
    assert.deepEqual(actual, publicCardData(expected));
    const raw = await pool.query(query);
    if (actual.form === "numero") assert.equal(Number(actual.raw), Number(raw.rows[0].total));
    if (actual.form === "ranking") actual.bars.forEach((b, i) => { assert.equal(b.label, raw.rows[i].produto); assert.equal(b.value, Number(raw.rows[i].total)); });
    if (actual.form === "serie") actual.points.forEach((p, i) => assert.equal(p.y, Number(raw.rows[i].total)));
  }
});
test("TV: sem SQL arbitrário no corpo e consultas gravadas revalidadas", async () => {
  const r = await call("POST", "/api/paineis", "admin", { ...body(), sql: "SELECT * FROM usuarios" }); assert.equal(r.statusCode, 400);
  const [f] = await db.insert(favoritesTable).values({ companyId: 1, userId: actors.admin!.id, title: "Consulta bloqueada", originalQuestion: "Teste", kind: "vivo", savedSql: "DELETE FROM vw_vendas_itens", form: "numero" }).returning();
  favs.unsafe = f!.id; const p = await create(f!.id); clearPanelRuntime(); const r2 = await pub(p.link);
  assert.equal(r2.statusCode, 200); assert.equal(r2.json().cartoes[0].estado, "erro"); assert.equal(r2.json().cartoes[0].dados, null); assert.ok(!r2.body.includes("DELETE"));
});
test("TV: quota de cartões, intervalo mínimo, duplicata, nome e validade", async () => {
  for (const data of [{ ...body(), atualizacaoSegundos: 30 }, { ...body(), nome: "" }, { ...body(), cartoes: Array(13).fill({ favoritoId: null, tamanho: "auto", pagina: null }) }, { ...body(), cartoes: Array(2).fill({ favoritoId: favs.numero, tamanho: "auto", pagina: null }) }]) {
    assert.equal(painelEntrada.safeParse(data).success, false);
  }
  assert.equal((await call("POST", "/api/paineis", "admin", { ...body(), expiraEm: "2020-01-01T00:00:00.000Z" })).statusCode, 400);
});
test("TV: apelido normalizado, reservado bloqueado e unicidade", async () => {
  assert.equal((await call("PUT", "/api/paineis/apelido", "admin", { apelido: "plataforma" })).statusCode, 400);
  const slug = `forros-sao-luis-${tag}`;
  assert.equal((await call("PUT", "/api/paineis/apelido", "admin", { apelido: `Fórros São Luís ${tag}` })).json().apelido, slug);
  assert.equal((await call("PUT", "/api/paineis/apelido", "other", { apelido: slug })).statusCode, 409);
  assert.equal((await pub(panel.link)).statusCode, 404);
  panel = (await call("POST", `/api/paineis/${panel.painel.id}/regenerar`)).json();
});
test("TV: limites por IP e código, memória limitada e sem temporizadores por acesso", async () => {
  clearPanelRuntime();
  const missing = panel.link.replace(/.$/, "!");
  for (let i = 0; i < 60; i++) assert.equal((await pub(missing, "203.0.113.20")).statusCode, 404);
  assert.equal((await pub(missing, "203.0.113.20")).statusCode, 429);
  clearPanelRuntime();
  for (let i = 0; i < 20; i++) assert.equal((await pub(panel.link, `192.0.2.${i + 2}`)).statusCode, 200);
  assert.equal((await pub(panel.link, "192.0.2.99")).statusCode, 429);
  for (let i = 0; i < 10000; i++) panelRate(`bounded:${i}`, 1);
  assert.equal(panelRuntimeSize().rates, 5000); assert.equal(panelRuntimeSize().running, 0);
});
test("TV: payload de tabela remove IDs e dados extra; demais formas usam allow-list", () => {
  const t = publicCardData({ form: "tabela", columns: [{ name: "usuario_id", label: "ID", type: "inteiro" }, { name: "total", label: "Total", type: "dinheiro" }], rows: [{ usuario_id: "42", total: "10", sql: "SELECT proibido" }], total: 1, truncated: false });
  assert.ok(!JSON.stringify(t).includes("42")); assert.ok(!JSON.stringify(t).includes("SELECT")); assert.ok(!JSON.stringify(t).includes("usuario_id"));
  const n = publicCardData({ form: "numero", column: { name: "total", label: "Total", type: "dinheiro" }, raw: "10", value: 10, sql: "secret" } as CardData);
  assert.ok(!JSON.stringify(n).includes("secret"));
});
test("TV: máximo de dez painéis por empresa é aplicado sob lock", async () => {
  while ((await call("GET", "/api/paineis")).json().paineis.length < 10) await create(null);
  assert.equal((await call("POST", "/api/paineis", "admin", body())).statusCode, 409);
});
