import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, pool } from "@workspace/db";
import { garantirEspelho } from "../lib/carga";
import { verifyCompanyData } from "../lib/company-setup";
import { fichaDoEspelho } from "../lib/ficha-espelho";
import { fichaSchema } from "../lib/ficha";
import { runFreeQuery } from "../lib/free-query";
import { PACOTE_SANKHYA } from "../lib/pacotes/sankhya";
import { capabilitiesMap, hasShortcuts, responseToolsFor } from "../lib/tool-contracts";
import { runAsTenant } from "../lib/tenant";
import { REGRAS_PADRAO } from "../lib/regras-sankhya";

// A company built only from copied tables: no governed views, no shortcut tools, and still any question answerable from the tables.
const tag = Math.random().toString(36).slice(2, 8);
const schema = `el_${tag}`;
let scoped: pg.Pool; let companyId = 0;
const ficha = fichaDoEspelho({ empresa: "Empresa espelho", erp: "sankhya", pacote: PACOTE_SANKHYA, assuntos: ["vendas", "financeiro"] });

before(async () => {
  const [c] = await db.insert(companiesTable).values({ name: `Espelho ${tag}`, erp: "sankhya", dataReady: false }).returning(); companyId = c!.id;
  // a database of its own, because the real thing reads the public schema of the company's database
  await pool.query(`CREATE DATABASE ${schema}`);
  const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${schema}`;
  scoped = new pg.Pool({ connectionString: url.toString(), max: 2 });
  await garantirEspelho(scoped, PACOTE_SANKHYA, [...new Set(Object.values(PACOTE_SANKHYA.assuntos).flat())]);
  await scoped.query(`INSERT INTO espelho_controle VALUES ('tgfcab', now() - interval '3 hours'), ('tgfite', now() - interval '3 hours')`);
  await scoped.query(`INSERT INTO tgfpar(codparc, nomeparc) VALUES (1, 'Cliente A')`);
  await scoped.query(`INSERT INTO tgfcab(nunota, codparc, tipmov, statusnota, dtneg, codtipoper, dhtipoper) VALUES (1, 1, 'V', 'L', '2026-09-10', 1100, '2026-01-01'), (2, 1, 'V', 'P', '2026-09-11', 1100, '2026-01-01')`);
  await scoped.query(`INSERT INTO tgfite(nunota, sequencia, codprod, qtdneg, vlrtot, vlrdesc) VALUES (1, 1, 10, 1, 100, 10), (2, 1, 10, 1, 40, 0)`);
});
after(async () => {
  await scoped.end(); await pool.query(`DROP DATABASE IF EXISTS ${schema}`);
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)); await pool.end();
});

test("the ficha built from the mirror is valid, names every copied table, carries the dictionary's code meanings and the company's definitions", () => {
  assert.ok(fichaSchema.safeParse(ficha).success);
  assert.deepEqual(ficha.visoes.map(v => v.nome).sort(), ["tgfcab", "tgffin", "tgfgru", "tgfite", "tgfnat", "tgfpar", "tgfpro", "tgftop", "tgftpv", "tgfven", "tsicus", "tsiemp"].sort());
  const status = ficha.visoes.find(v => v.nome === "tgfcab")!.colunas.find(c => c.nome === "statusnota")!;
  assert.equal(status.tipo, "codigo"); assert.equal(status.valores?.L, "Liberada");
  assert.match(ficha.orientacoes!, /tipmov em \('V'\)/); assert.match(ficha.orientacoes!, /statusnota em \('L'\)/); assert.match(ficha.orientacoes!, /dtneg/);
  const custom = fichaDoEspelho({ empresa: "x", erp: "sankhya", pacote: PACOTE_SANKHYA, assuntos: ["vendas"], regras: { ...REGRAS_PADRAO, dataVenda: "DTFATUR", operacoesExcluidas: [1200] } });
  assert.match(custom.orientacoes!, /dtfatur/); assert.match(custom.orientacoes!, /operações 1200/);
  assert.equal(custom.visoes.some(v => v.nome === "tgffin"), false, "only the chosen subjects are released");
});

test("without the governed views there are no shortcut tools, and the demonstration still has them", () => {
  assert.equal(hasShortcuts(ficha), false);
  assert.deepEqual(capabilitiesMap().consultas.length > 0, true, "the demonstration (no tenant) keeps its shortcuts");
  const names = (f: typeof ficha) => responseToolsFor(f).map(t => (t as { name: string }).name);
  assert.ok(!names(ficha).includes("faturamento") && !names(ficha).includes("contas_a_receber_vencidas"));
  assert.ok(names(ficha).includes("consultar_dados") && names(ficha).includes("responder"));
});

test("the company is verified and released from its tables alone, and a free question over them returns rows with the age of the copy", async () => {
  const report = await verifyCompanyData(companyId, scoped, ficha);
  assert.ok(report.ok, JSON.stringify(report));
  assert.ok(!report.passos.some(p => /atalhos/i.test(p.passo)), "the shortcut check is skipped when the ficha has no governed views");
  const result = await runAsTenant({ companyId, userId: 0, role: "administrador", data: { pool: scoped, ficha } }, () =>
    runFreeQuery("SELECT c.nunota, i.vlrtot - COALESCE(i.vlrdesc, 0) AS liquido FROM tgfcab c JOIN tgfite i ON i.nunota = c.nunota WHERE c.tipmov = 'V' AND c.statusnota = 'L'", ficha));
  assert.deepEqual(result.rows, [{ nunota: "1", liquido: "90.0000" }]);
  assert.ok(result.updatedAt, "the age comes from the load control");
  assert.ok(Date.now() - new Date(result.updatedAt!).getTime() > 2.5 * 3_600_000, "three hours old, as recorded");
  await assert.rejects(runAsTenant({ companyId, userId: 0, role: "administrador", data: { pool: scoped, ficha } }, () => runFreeQuery("SELECT * FROM espelho_controle", ficha)), /não liberada/);
});
