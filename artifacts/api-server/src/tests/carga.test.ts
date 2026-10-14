import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { carregar, fonteDePool, garantirEspelho } from "../lib/carga";
import { PACOTE_SANKHYA } from "../lib/pacotes/sankhya";

// Source and mirror are two schemas of the same scratch database, so the test needs no second server. Skipped when it is not provisioned.
const URL = process.env.SECOND_DATABASE_URL;
const tag = Math.random().toString(36).slice(2, 8);
const SRC = `src_${tag}`, TGT = `tgt_${tag}`;
let admin: pg.Pool, src: pg.Pool, tgt: pg.Pool;
const inSchema = (schema: string) => new pg.Pool({ connectionString: URL, max: 2, options: `-c search_path=${schema}` });
const mirror = async (sql: string) => (await tgt.query(sql)).rows;
const run = (opts: Partial<Parameters<typeof carregar>[0]> = {}) =>
  carregar({ fonte: fonteDePool(src), destino: tgt, pacote: PACOTE_SANKHYA, assuntos: ["vendas"], ...opts });

before(async () => {
  if (!URL) return;
  admin = new pg.Pool({ connectionString: URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${SRC}`); await admin.query(`CREATE SCHEMA ${TGT}`);
  src = inSchema(SRC); tgt = inSchema(TGT);
  await garantirEspelho(src, PACOTE_SANKHYA, Object.keys(PACOTE_SANKHYA.tabelas), "originais"); // the source gets the same shape as Sankhya
  await src.query(`INSERT INTO "TGFPAR"("CODPARC","NOMEPARC") VALUES (1,'Cliente A'),(2,'Cliente B')`);
  await src.query(`INSERT INTO "TGFPRO"("CODPROD","DESCRPROD") VALUES (10,'Produto X')`);
  await src.query(`INSERT INTO "TGFTOP"("CODTIPOPER","DHALTER","TIPMOV") VALUES (1100,'2026-01-01 00:00:00','V')`);
  await src.query(`INSERT INTO "TGFCAB"("NUNOTA","CODTIPOPER","DHTIPOPER","CODPARC","TIPMOV","STATUSNOTA","DTNEG","DTALTER","VLRNOTA") VALUES
    (1,1100,'2026-01-01 00:00:00',1,'V','L','2026-03-01','2026-03-01 10:00:00',100.5),(2,1100,'2026-01-01 00:00:00',2,'V','L','2026-03-02','2026-03-02 10:00:00',200),
    (3,1100,'2026-01-01 00:00:00',1,'V','L','2026-03-03','2026-03-03 10:00:00',300)`);
  await src.query(`INSERT INTO "TGFITE"("NUNOTA","SEQUENCIA","CODPROD","QTDNEG","VLRTOT","DTALTER") VALUES (1,1,10,2,100.5,'2026-03-01 10:00:00'),(1,2,10,1,0,'2026-03-01 10:00:00'),(2,1,10,1,200,'2026-03-02 10:00:00')`);
});
after(async () => {
  if (!URL) return;
  await src.end(); await tgt.end();
  await admin.query(`DROP SCHEMA ${SRC} CASCADE`); await admin.query(`DROP SCHEMA ${TGT} CASCADE`); await admin.end();
});

test("first load copies everything exactly, dates and amounts untouched, and records the load time", { skip: !URL }, async () => {
  const r = await run({ lote: 2 }); // tiny batches exercise the key pagination
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.tabelas.find(t => t.tabela === "TGFCAB")!.lidas, 3);
  assert.equal(r.tabelas.find(t => t.tabela === "TGFITE")!.lidas, 3);
  const [nota] = await mirror(`SELECT vlrnota::text v, dtneg::text d, dtalter::text a FROM tgfcab WHERE nunota = 1`);
  assert.deepEqual(nota, { v: "100.5000", d: "2026-03-01", a: "2026-03-01 10:00:00" });
  const control = await mirror(`SELECT tabela FROM espelho_controle ORDER BY 1`);
  assert.ok(control.some(c => c.tabela === "tgfcab") && control.some(c => c.tabela === "tgfpar"));
});

test("an incremental load brings only what changed, and a second one with nothing new reads nothing", { skip: !URL }, async () => {
  await src.query(`UPDATE "TGFCAB" SET "VLRNOTA" = 999, "DTALTER" = '2026-03-10 09:00:00' WHERE "NUNOTA" = 2`);
  await src.query(`INSERT INTO "TGFCAB"("NUNOTA","CODTIPOPER","DHTIPOPER","CODPARC","TIPMOV","STATUSNOTA","DTNEG","DTALTER") VALUES (4,1100,'2026-01-01 00:00:00',2,'V','L','2026-03-10','2026-03-10 09:30:00')`);
  const r = await run({ sobreposicaoHoras: 1 });
  const cab = r.tabelas.find(t => t.tabela === "TGFCAB")!;
  assert.equal(cab.modo, "incremental");
  assert.equal(cab.lidas, 3, "the changed note, the new one, and note 3, which sits inside the one-hour overlap before the newest change held (note 1 does not)");
  assert.equal((await mirror(`SELECT count(*)::int n FROM tgfcab`))[0].n, 4);
  assert.equal((await mirror(`SELECT vlrnota::text v FROM tgfcab WHERE nunota = 2`))[0].v, "999.0000");
  const again = await run({ sobreposicaoHoras: 0 });
  assert.equal(again.tabelas.find(t => t.tabela === "TGFCAB")!.lidas, 1, "only the very newest row at the edge is re-read, and it is harmless");
});

test("small tables are replaced whole, so a row deleted at the source disappears; a full load does the same for big ones", { skip: !URL }, async () => {
  await src.query(`DELETE FROM "TGFPAR" WHERE "CODPARC" = 2`);
  await src.query(`DELETE FROM "TGFCAB" WHERE "NUNOTA" = 3`);
  const r = await run();
  assert.equal((await mirror(`SELECT count(*)::int n FROM tgfpar`))[0].n, 1);
  assert.equal((await mirror(`SELECT count(*)::int n FROM tgfcab`))[0].n, 4, "incremental alone does not notice a deleted note");
  assert.ok(r.ok);
  await run({ modo: "completa" });
  assert.equal((await mirror(`SELECT count(*)::int n FROM tgfcab`))[0].n, 3, "the full load drops it");
});

test("a table that fails is rolled back and reported, and the others still load", { skip: !URL }, async () => {
  await src.query(`DROP TABLE "TGFGRU"`);
  const before = (await mirror(`SELECT count(*)::int n FROM tgfpar`))[0].n;
  const r = await run();
  assert.equal(r.ok, false);
  const bad = r.tabelas.find(t => t.tabela === "TGFGRU")!;
  assert.ok(bad.erro && !/postgres:\/\//.test(bad.erro));
  assert.equal(r.tabelas.filter(t => !t.erro).length, r.tabelas.length - 1);
  assert.equal((await mirror(`SELECT count(*)::int n FROM tgfpar`))[0].n, before);
});

test("an unknown subject is refused before touching anything", { skip: !URL }, async () => {
  await assert.rejects(() => run({ assuntos: ["inexistente"] }), /fora do pacote/);
});

test("a mirror created with integer keys is widened to bigint, keeping its views, so note and title numbers beyond 32 bits are accepted", { skip: !URL }, async () => {
  const OLD = `old_${tag}`;
  await admin.query(`CREATE SCHEMA ${OLD}`);
  const old = inSchema(OLD);
  try {
    // An older installation: the same tables, but with integer columns, and a view over two of them (as the Sankhya rules create).
    await old.query(`CREATE TABLE tgfcab (nunota integer NOT NULL PRIMARY KEY, numnota integer, codparc integer, dtneg date)`);
    await old.query(`CREATE TABLE tgfpar (codparc integer NOT NULL PRIMARY KEY, nomeparc text)`);
    await old.query(`CREATE VIEW vw_notas AS SELECT c.nunota, c.numnota, p.nomeparc FROM tgfcab c LEFT JOIN tgfpar p ON p.codparc = c.codparc`);
    await old.query(`INSERT INTO tgfpar VALUES (7, 'Cliente'), (8, 'Outro')`);
    await old.query(`INSERT INTO tgfcab (nunota, numnota, codparc) VALUES (1, 10, 7)`);
    await garantirEspelho(old, PACOTE_SANKHYA, ["TGFCAB", "TGFPAR"]);
    const tipos = (await old.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tgfcab' AND column_name IN ('nunota', 'numnota', 'codparc', 'dtneg') ORDER BY 1`)).rows;
    assert.deepEqual(tipos, [{ column_name: "codparc", data_type: "bigint" }, { column_name: "dtneg", data_type: "date" }, { column_name: "numnota", data_type: "bigint" }, { column_name: "nunota", data_type: "bigint" }]);
    await old.query(`INSERT INTO tgfcab (nunota, numnota, codparc) VALUES (3652237700, 6033706101, 8)`);
    const view = (await old.query(`SELECT numnota::text AS numnota, nomeparc FROM vw_notas ORDER BY nunota`)).rows;
    assert.deepEqual(view, [{ numnota: "10", nomeparc: "Cliente" }, { numnota: "6033706101", nomeparc: "Outro" }], "the view survives and reads the widened column");
    await garantirEspelho(old, PACOTE_SANKHYA, ["TGFCAB", "TGFPAR"]); // nothing left to widen: still fine
  } finally {
    await old.end();
    await admin.query(`DROP SCHEMA ${OLD} CASCADE`);
  }
});
