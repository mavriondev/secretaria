import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { companiesTable, db, loadRunsTable, notificationsTable, pool, systemAlertsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { _limparContadores, _limparSaude, aplicar, avaliar, LIMITES, registrarChaveInvalida, registrarFalhaLogin, registrarResposta, verificarSaude, type Deps, type Leituras, type Sondas } from "../lib/saude-sistema";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const emails: string[] = [];
let empresaId = 0;
const NOW = new Date("2026-10-14T13:00:00.000Z");
const iso = (hoursAgo: number, from = NOW) => new Date(from.getTime() - hoursAgo * 3_600_000).toISOString();

const call = async (method: "GET" | "POST", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador" | "gestor", companyId: number | null) {
  const email = `${key}.saude.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const noticesOf = (userId: number) => db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.kind, "sistema"))).orderBy(notificationsTable.id);

/** Healthy readings; each test overrides what it wants to break. */
const saudavel = (from = NOW): Leituras => ({
  banco: { ok: true, ms: 2 },
  servico: { existe: true, ativo: "active", resultado: "success", codigo: 0, saidaEm: null, inicioEm: iso(5, from), reinicios: 0 },
  erros5xx: 0,
  disco: { caminho: "/", totalBytes: 100 * 1024 ** 3, livreBytes: 60 * 1024 ** 3, percentualUso: 40 },
  memoria: { totalBytes: 16 * 1024 ** 3, disponivelBytes: 12 * 1024 ** 3, percentualUso: 25 },
  logs: { bytes: 300 * 1024 ** 2 },
  backup: { unidade: { existe: true, ativo: "inactive", resultado: "success", codigo: 0, saidaEm: iso(10, from), inicioEm: iso(10, from), reinicios: 0 }, arquivo: { ok: true, em: iso(10, from), destino: false } },
  restoreTest: { ok: true, em: iso(24 * 5, from), tabelas: 40 },
  certificado: { cert: { validoAte: iso(-24 * 5, from), porIp: true, emissor: "Let's Encrypt" }, renovacao: { existe: true, ativo: "inactive", resultado: "success", codigo: 0, saidaEm: iso(12, from), inicioEm: iso(12, from), reinicios: 0 } },
  empresas: [],
  custos: { plataforma: { limiteUsd: 10, usadoUsd: 1, percentual: 10, bloqueado: false }, empresas: [] },
  seguranca: { falhasLogin: 0, piorIpLogin: null, chavesInvalidas: 0, ipsRecusados: [] },
});
const sondasDe = (l: Leituras): Sondas => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, async () => v])) as Sondas;
const por = (itens: ReturnType<typeof avaliar>, chave: string) => { const i = itens.find(x => x.chave === chave); assert.ok(i, `item ${chave}`); return i; };

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await _limparSaude(); _limparContadores();
  const [c] = await db.insert(companiesTable).values({ name: `Saúde ${tag}`, erp: "sankhya", active: true, dataReady: true, sourceUrlEnc: "x", loadEveryMin: 60 }).returning();
  empresaId = c!.id;
  await seed("dono", "dono", null); await seed("admin", "administrador", empresaId); await seed("gestor", "gestor", empresaId); await seed("outroAdmin", "administrador", 1);
});
after(async () => {
  await _limparSaude();
  if (emails.length) {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.email, emails));
    const userIds = users.map(u => u.id);
    if (userIds.length) await db.delete(notificationsTable).where(inArray(notificationsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.email, emails));
  }
  if (empresaId) { await db.delete(loadRunsTable).where(eq(loadRunsTable.companyId, empresaId)); await db.delete(companiesTable).where(eq(companiesTable.id, empresaId)); }
  await pool.end();
});

/* ---------- evaluation of each check ---------- */

test("saudável: tudo verde e nada por fazer", () => {
  const itens = avaliar(saudavel(), NOW);
  assert.ok(itens.length >= 12);
  for (const i of itens) { assert.equal(i.gravidade, "ok", i.chave); assert.equal(i.acao, null, i.chave); }
});
test("banco sem resposta é crítico", () => {
  const i = por(avaliar({ ...saudavel(), banco: { ok: false, ms: 5000, erro: "timeout" } }, NOW), "banco");
  assert.equal(i.gravidade, "critico"); assert.match(i.acao!, /postgresql/);
});
test("reinícios: limiares e ambiente sem systemd", () => {
  const base = saudavel();
  assert.equal(por(avaliar({ ...base, servico: { ...base.servico!, reinicios: LIMITES.reinicios.atencao } }, NOW), "reinicios").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, servico: { ...base.servico!, reinicios: LIMITES.reinicios.critico } }, NOW), "reinicios").gravidade, "critico");
  assert.equal(por(avaliar({ ...base, servico: null }, NOW), "reinicios").gravidade, "desconhecido");
});
test("erros 5xx: contagem da janela", () => {
  assert.equal(por(avaliar({ ...saudavel(), erros5xx: LIMITES.erros5xx.atencao }, NOW), "erros").gravidade, "atencao");
  assert.equal(por(avaliar({ ...saudavel(), erros5xx: LIMITES.erros5xx.critico }, NOW), "erros").gravidade, "critico");
});
test("disco 80/90, memória e logs", () => {
  const base = saudavel();
  assert.equal(por(avaliar({ ...base, disco: { ...base.disco!, percentualUso: 81 } }, NOW), "disco").gravidade, "atencao");
  const d = por(avaliar({ ...base, disco: { ...base.disco!, percentualUso: 92 } }, NOW), "disco");
  assert.equal(d.gravidade, "critico"); assert.match(d.titulo, /92 %/); assert.match(d.acao!, /vacuum/);
  assert.equal(por(avaliar({ ...base, memoria: { ...base.memoria!, percentualUso: 96 } }, NOW), "memoria").gravidade, "critico");
  assert.equal(por(avaliar({ ...base, logs: { bytes: 3 * 1024 ** 3 } }, NOW), "logs").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, disco: null }, NOW), "disco").gravidade, "desconhecido");
});
test("backup: atraso de 26 h, falha, nunca executado e restore-test", () => {
  const base = saudavel();
  const u = base.backup.unidade!;
  const atrasado = avaliar({ ...base, backup: { unidade: { ...u, saidaEm: iso(27) }, arquivo: { ok: true, em: iso(27) } } }, NOW);
  assert.equal(por(atrasado, "backup").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, backup: { unidade: { ...u, saidaEm: iso(60) }, arquivo: null } }, NOW), "backup").gravidade, "critico");
  const falhou = por(avaliar({ ...base, backup: { unidade: { ...u, resultado: "exit-code", codigo: 1, saidaEm: iso(1) }, arquivo: { ok: false, em: iso(1), erro: "pg_dump falhou" } } }, NOW), "backup");
  assert.equal(falhou.gravidade, "critico"); assert.match(falhou.mensagem, /pg_dump falhou/);
  assert.equal(por(avaliar({ ...base, backup: { unidade: { ...u, saidaEm: null }, arquivo: null } }, NOW), "backup").gravidade, "critico");
  assert.equal(por(avaliar({ ...base, backup: { unidade: null, arquivo: null }, restoreTest: null }, NOW), "backup").gravidade, "desconhecido");
  const nunca = por(avaliar({ ...base, restoreTest: null }, NOW), "restore-test");
  assert.equal(nunca.gravidade, "atencao"); assert.match(nunca.acao!, /restore-test/);
  assert.equal(por(avaliar({ ...base, restoreTest: { ok: true, em: iso(24 * 31) } }, NOW), "restore-test").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, restoreTest: { ok: false, em: iso(2), erro: "sem tabelas" } }, NOW), "restore-test").gravidade, "critico");
});
test("certificado: 3 dias para IP, 15 para os demais, vencido e renovação com falha", () => {
  const base = saudavel();
  const ren = base.certificado.renovacao!;
  assert.equal(por(avaliar({ ...base, certificado: { cert: { validoAte: iso(-24 * 2.5), porIp: true, emissor: null }, renovacao: ren } }, NOW), "certificado").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, certificado: { cert: { validoAte: iso(-24 * 2.5), porIp: false, emissor: null }, renovacao: ren } }, NOW), "certificado").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, certificado: { cert: { validoAte: iso(-24 * 10), porIp: false, emissor: null }, renovacao: ren } }, NOW), "certificado").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, certificado: { cert: { validoAte: iso(-24 * 10), porIp: true, emissor: null }, renovacao: ren } }, NOW), "certificado").gravidade, "ok");
  const vencido = por(avaliar({ ...base, certificado: { cert: { validoAte: iso(2), porIp: true, emissor: null }, renovacao: ren } }, NOW), "certificado");
  assert.equal(vencido.gravidade, "critico"); assert.match(vencido.titulo, /vencido/);
  assert.equal(por(avaliar({ ...base, certificado: { cert: base.certificado.cert, renovacao: { ...ren, resultado: "exit-code" } } }, NOW), "renovacao").gravidade, "critico");
  assert.equal(por(avaliar({ ...base, certificado: { cert: null, renovacao: null } }, NOW), "certificado").gravidade, "desconhecido");
});
test("cargas por empresa: atraso, desatualizado, falha e sem dados", () => {
  const base = saudavel();
  const emp = (ultimaOkEm: string | null, ultima: Leituras["empresas"][number]["ultima"], intervaloMin: number | null = 60) => ({ id: empresaId, nome: "Teste", intervaloMin, recebida: false, ultimaOkEm, ultima });
  const emDia = por(avaliar({ ...base, empresas: [emp(iso(0.5), { ok: true, status: "concluida", erro: null, em: iso(0.5) })] }, NOW), `carga:${empresaId}`);
  assert.equal(emDia.gravidade, "ok"); assert.equal(emDia.empresaId, empresaId);
  assert.equal(por(avaliar({ ...base, empresas: [emp(iso(2), { ok: true, status: "concluida", erro: null, em: iso(2) })] }, NOW), `carga:${empresaId}`).gravidade, "atencao");
  const tarde = por(avaliar({ ...base, empresas: [emp(iso(4), { ok: true, status: "concluida", erro: null, em: iso(4) })] }, NOW), `carga:${empresaId}`);
  assert.equal(tarde.gravidade, "critico"); assert.match(tarde.titulo, /desatualizados/);
  const falhou = por(avaliar({ ...base, empresas: [emp(iso(0.5), { ok: false, status: "concluida", erro: "conexão recusada", em: iso(0.1) })] }, NOW), `carga:${empresaId}`);
  assert.equal(falhou.gravidade, "atencao"); assert.match(falhou.mensagem, /conexão recusada/);
  assert.equal(por(avaliar({ ...base, empresas: [emp(null, null)] }, NOW), `carga:${empresaId}`).gravidade, "atencao");
  const recebida = por(avaliar({ ...base, empresas: [{ ...emp(iso(30), null, null), recebida: true }] }, NOW), `carga:${empresaId}`);
  assert.equal(recebida.gravidade, "atencao"); assert.match(recebida.acao!, /chave de envio/);
});
test("custo: 80 % é atenção, bloqueado é crítico (plataforma e empresa)", () => {
  const base = saudavel();
  assert.equal(por(avaliar({ ...base, custos: { ...base.custos, plataforma: { limiteUsd: 10, usadoUsd: 8.5, percentual: 85, bloqueado: false } } }, NOW), "custo:plataforma").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, custos: { ...base.custos, plataforma: { limiteUsd: 10, usadoUsd: 10, percentual: 100, bloqueado: true } } }, NOW), "custo:plataforma").gravidade, "critico");
  const e = { id: empresaId, nome: "Teste", mes: { percentual: 20, bloqueado: false, usadoUsd: 2, limiteUsd: 10 }, dia: { percentual: 100, bloqueado: true, usadoUsd: 1, limiteUsd: 1 } };
  const i = por(avaliar({ ...base, custos: { ...base.custos, empresas: [e] } }, NOW), `custo:${empresaId}`);
  assert.equal(i.gravidade, "critico"); assert.equal(i.empresaId, empresaId);
});
test("segurança: falhas de login, chaves inválidas e 429 por endereço", () => {
  const base = saudavel();
  assert.equal(por(avaliar({ ...base, seguranca: { ...base.seguranca, falhasLogin: LIMITES.falhasLogin.atencao, piorIpLogin: { chave: "1.2.3.4", n: 15 } } }, NOW), "seguranca:login").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, seguranca: { ...base.seguranca, falhasLogin: LIMITES.falhasLogin.critico, piorIpLogin: null } }, NOW), "seguranca:login").gravidade, "critico");
  assert.equal(por(avaliar({ ...base, seguranca: { ...base.seguranca, chavesInvalidas: LIMITES.chavesInvalidas } }, NOW), "seguranca:ingestao").gravidade, "atencao");
  assert.equal(por(avaliar({ ...base, seguranca: { ...base.seguranca, ipsRecusados: [{ chave: "9.9.9.9", n: LIMITES.recusas429PorIp }] } }, NOW), "seguranca:ritmo").gravidade, "atencao");
});
test("contadores em memória alimentam a leitura de segurança e de erros", async () => {
  _limparContadores();
  const t = Date.now();
  for (let i = 0; i < 3; i++) registrarFalhaLogin("5.5.5.5", t);
  registrarFalhaLogin("6.6.6.6", t - 16 * 60_000); // outside the window
  registrarChaveInvalida("7.7.7.7", t);
  for (let i = 0; i < 4; i++) registrarResposta(429, "8.8.8.8", t);
  registrarResposta(500, "8.8.8.8", t); registrarResposta(200, "8.8.8.8", t);
  const base = saudavel();
  const { seguranca: _s, erros5xx: _e, ...resto } = base;
  const r = await verificarSaude({ now: () => new Date(t), sondas: sondasDe(resto as Leituras), push: async () => ({ ok: true }) });
  const seg = r.itens.find(i => i.chave === "seguranca:login")!;
  assert.match(seg.mensagem, /^3 falha/); assert.match(seg.mensagem, /3 do mesmo endereço/);
  assert.match(r.itens.find(i => i.chave === "seguranca:ingestao")!.mensagem, /^1 envio/);
  assert.match(r.itens.find(i => i.chave === "seguranca:ritmo")!.mensagem, /^4 recusa/);
  assert.match(r.itens.find(i => i.chave === "erros")!.mensagem, /^1 resposta/);
  _limparContadores(); await _limparSaude();
});

/* ---------- transitions ---------- */

test("normal → alerta → resolvido: um aviso na entrada, nenhum enquanto persiste, lembrete após 24 h, um na saída", async () => {
  await _limparSaude();
  const pushes: string[] = [];
  const deps: Deps = { push: async (_s, p) => { pushes.push(p.title); return { ok: true }; } };
  const dono = ids.dono!;
  let now = NOW;
  const rodar = (l: Leituras) => verificarSaude({ ...deps, now: () => now, sondas: sondasDe(l) });
  const r0 = await rodar(saudavel(now));
  assert.equal(r0.avisos.length, 0, "nada saudável gera aviso");
  const cheio = () => { const b = saudavel(now); b.disco = { ...b.disco!, percentualUso: 85 }; return b; };
  now = new Date(now.getTime() + 5 * 60_000);
  const r1 = await rodar(cheio());
  assert.deepEqual(r1.avisos.map(a => [a.chave, a.transicao]), [["disco", "novo"]]);
  let n = await noticesOf(dono);
  assert.equal(n.length, 1); assert.equal(n[0]!.companyId, null); assert.match(n[0]!.title, /Disco a 85 %/); assert.match(n[0]!.message, /O que fazer/); assert.equal(n[0]!.conditionText, "novo");
  for (let i = 0; i < 6; i++) { now = new Date(now.getTime() + 5 * 60_000); assert.equal((await rodar(cheio())).avisos.length, 0, "persistindo não repete"); }
  const [estado] = await db.select().from(systemAlertsTable).where(eq(systemAlertsTable.key, "disco"));
  assert.equal(estado!.severity, "atencao"); assert.ok(estado!.since); assert.equal(estado!.lastCheckedAt.toISOString(), now.toISOString());
  now = new Date(now.getTime() + 24 * 3_600_000);
  const r2 = await rodar(cheio());
  assert.deepEqual(r2.avisos.map(a => a.transicao), ["continua"]);
  const pior = () => { const b = saudavel(now); b.disco = { ...b.disco!, percentualUso: 93 }; return b; };
  now = new Date(now.getTime() + 5 * 60_000);
  assert.deepEqual((await rodar(pior())).avisos.map(a => a.transicao), ["agravou"]);
  now = new Date(now.getTime() + 5 * 60_000);
  assert.equal((await rodar(pior())).avisos.length, 0, "crítico persistindo não repete");
  now = new Date(now.getTime() + 5 * 60_000);
  const r3 = await rodar(saudavel(now));
  assert.deepEqual(r3.avisos.map(a => a.transicao), ["resolvido"]);
  n = await noticesOf(dono);
  assert.deepEqual(n.map(x => x.conditionText), ["novo", "continua", "agravou", "resolvido"]);
  assert.match(n[3]!.title, /^Resolvido: Disco/);
  assert.equal(pushes.length, 0, "o dono de teste não tem assinatura push; nada é enviado");
  const [depois] = await db.select().from(systemAlertsTable).where(eq(systemAlertsTable.key, "disco"));
  assert.equal(depois!.severity, "ok"); assert.equal(depois!.since, null);
  now = new Date(now.getTime() + 5 * 60_000);
  assert.equal((await rodar(saudavel(now))).avisos.length, 0);
  await _limparSaude();
});
test("leitura indisponível depois de um alerta não declara resolvido", async () => {
  await _limparSaude();
  let now = NOW;
  const b = saudavel(); b.memoria = { ...b.memoria!, percentualUso: 97 };
  await verificarSaude({ now: () => now, sondas: sondasDe(b) });
  now = new Date(now.getTime() + 5 * 60_000);
  const r = await verificarSaude({ now: () => now, sondas: sondasDe({ ...saudavel(), memoria: null }) });
  assert.equal(r.avisos.length, 0);
  const n = await noticesOf(ids.dono!);
  assert.equal(n.length, 1);
  await _limparSaude();
});

/* ---------- isolation ---------- */

test("isolamento: alerta do sistema só para o dono; alerta da empresa para o dono e os administradores dela", async () => {
  await _limparSaude();
  const b = saudavel();
  b.disco = { ...b.disco!, percentualUso: 95 };
  b.empresas = [{ id: empresaId, nome: "Teste", intervaloMin: 60, recebida: false, ultimaOkEm: iso(10), ultima: { ok: false, status: "concluida", erro: "origem fora do ar", em: iso(1) } }];
  const r = await verificarSaude({ now: () => NOW, sondas: sondasDe(b) });
  assert.equal(r.avisos.length, 2);
  const dono = await noticesOf(ids.dono!), admin = await noticesOf(ids.admin!), gestor = await noticesOf(ids.gestor!), outro = await noticesOf(ids.outroAdmin!);
  assert.deepEqual(dono.map(x => x.title).sort(), ["Disco a 95 %", "Teste: dados desatualizados"]);
  assert.equal(admin.length, 1); assert.equal(admin[0]!.companyId, empresaId); assert.match(admin[0]!.title, /Teste: dados/);
  assert.equal(gestor.length, 0, "gestores não recebem alertas do sistema");
  assert.equal(outro.length, 0, "administradores de outra empresa não recebem");
  await _limparSaude();
});

/* ---------- routes ---------- */

test("rotas: painel do dono, verificar agora, caixa de avisos do dono; empresa não acessa", async () => {
  await _limparSaude();
  const vazio = await call("GET", "/api/plataforma/saude", "dono");
  assert.equal(vazio.status, 200); assert.equal(vazio.body.verificadoEm, null); assert.deepEqual(vazio.body.grupos, []);
  const ver = await call("POST", "/api/plataforma/saude/verificar", "dono");
  assert.equal(ver.status, 200); assert.ok(ver.body.verificadoEm); assert.ok(ver.body.grupos.length >= 5);
  assert.ok(["ok", "atencao", "critico"].includes(ver.body.geral));
  const chaves = ver.body.grupos.flatMap((g: { itens: Array<{ chave: string }> }) => g.itens.map(i => i.chave));
  for (const k of ["banco", "reinicios", "erros", "backup", "restore-test", "disco", "memoria", "certificado", "custo:plataforma", "seguranca:login"]) assert.ok(chaves.includes(k), k);
  const banco = ver.body.grupos.flatMap((g: { itens: Array<{ chave: string; gravidade: string }> }) => g.itens).find((i: { chave: string }) => i.chave === "banco");
  assert.equal(banco.gravidade, "ok");
  // without systemd, the service and backup checks are grey and never notify
  const reinicios = ver.body.grupos.flatMap((g: { itens: Array<{ chave: string; gravidade: string }> }) => g.itens).find((i: { chave: string }) => i.chave === "reinicios");
  assert.equal(reinicios.gravidade, "desconhecido");
  const caixa = await call("GET", "/api/plataforma/notificacoes", "dono");
  assert.equal(caixa.status, 200); assert.ok(Array.isArray(caixa.body.itens)); assert.equal(typeof caixa.body.naoLidas, "number");
  const lidas = await call("POST", "/api/plataforma/notificacoes/lidas", "dono", { todas: true });
  assert.equal(lidas.status, 200);
  const push = await call("GET", "/api/plataforma/push", "dono");
  assert.equal(push.status, 200); assert.equal(push.body.assinaturas, 0);
  assert.equal((await call("GET", "/api/plataforma/saude", "admin")).status, 403);
  assert.equal((await call("GET", "/api/plataforma/notificacoes", "gestor")).status, 403);
  assert.equal((await call("POST", "/api/plataforma/saude/verificar", "admin")).status, 403);
  await _limparSaude();
});
test("aplicar: chaves que sumiram saem do quadro", async () => {
  await _limparSaude();
  const itens = avaliar(saudavel(), NOW);
  await aplicar(itens, NOW);
  await aplicar(itens.filter(i => i.chave !== "logs"), NOW);
  const rows = await db.select({ key: systemAlertsTable.key }).from(systemAlertsTable);
  assert.ok(!rows.some(r => r.key === "logs"));
  await _limparSaude();
});
