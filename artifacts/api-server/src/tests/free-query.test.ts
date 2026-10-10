import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import { fichaViewNames } from "../lib/ficha";
import { guardSql } from "../lib/sql-guard";
import { FreeQueryError, MAX_FREE_ROWS, runFreeQuery } from "../lib/free-query";

after(() => pool.end());
const views = fichaViewNames();
const rejects = (sql: string, pattern: RegExp) => { const r = guardSql(sql, views); assert.ok(!r.ok, `deveria recusar: ${sql}`); assert.match((r as { reason: string }).reason, pattern); };

test("guard accepts ordinary read queries: joins, CTEs, aggregates and dates", () => {
  for (const sql of [
    "SELECT placa, situacao FROM vw_frota_veiculos WHERE situacao = 'M'",
    "select v.placa, count(*) as viagens from vw_frota_viagens vi join vw_frota_veiculos v on v.veiculo_id = vi.veiculo_id group by v.placa order by 2 desc limit 5;",
    "WITH parados AS (SELECT veiculo_id FROM vw_frota_ocorrencias WHERE tipo = 'PARADO' AND inicio_em BETWEEN '2026-08-01' AND '2026-08-31') SELECT v.placa FROM vw_frota_veiculos v JOIN parados p ON p.veiculo_id = v.veiculo_id",
    "SELECT date_trunc('month', inicio_em) AS mes, count(*) FROM vw_frota_ocorrencias GROUP BY 1",
    "SELECT placa FROM public.vw_frota_veiculos WHERE observacao ILIKE '%freio%' UNION SELECT placa FROM vw_frota_ocorrencias",
  ]) { const r = guardSql(sql, views); assert.ok(r.ok, `${sql} -> ${r.ok ? "" : r.reason}`); }
});
test("guard refuses writes, extra statements, other relations and unknown functions", () => {
  rejects("DELETE FROM vw_frota_veiculos", /SELECT/);
  rejects("UPDATE frota_veiculos SET situacao = 'D'", /SELECT/);
  rejects("DROP TABLE frota_veiculos", /SELECT|sintaxe/);
  rejects("SELECT * FROM vw_frota_veiculos; DELETE FROM frota_veiculos", /exatamente uma/);
  rejects("SELECT * FROM frota_veiculos", /não liberada/);
  rejects("SELECT * FROM pg_user", /não liberada/);
  rejects("SELECT * FROM information_schema.tables", /esquema não permitido/);
  rejects("SELECT * FROM pg_catalog.pg_tables", /esquema não permitido/);
  rejects("SELECT pg_sleep(10) FROM vw_frota_veiculos", /função não permitida: pg_sleep/);
  rejects("SELECT set_config('role','postgres',false) FROM vw_frota_veiculos", /função não permitida/);
  rejects("SELECT pg_catalog.pg_read_file('x') FROM vw_frota_veiculos", /função com esquema/);
  rejects("SELECT * FROM vw_frota_veiculos FOR UPDATE", /bloqueio de linhas/);
  rejects("WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT 1 FROM r) SELECT * FROM r", /RECURSIVE|nenhuma view|sintaxe/);
  rejects("SELECT 1", /nenhuma view liberada/);
  rejects("", /vazia/);
  // A CTE named like a forbidden relation does not make that relation readable inside its own body.
  rejects("WITH pg_user AS (SELECT * FROM pg_user) SELECT * FROM pg_user", /não liberada: pg_user/);
});

test("free query returns rows as text with the freshness of the views read", async () => {
  const result = await runFreeQuery("SELECT placa, situacao, capacidade_kg FROM vw_frota_veiculos WHERE situacao = 'M' ORDER BY placa");
  assert.deepEqual(result.rows.map(r => r.placa), ["MNB9J01", "UIO3C45"]);
  assert.equal(result.rows[0]!.capacidade_kg, "9000");
  assert.deepEqual(result.views, ["vw_frota_veiculos"]);
  assert.ok(result.updatedAt);
  assert.equal(result.truncated, false);
});
test("free query caps the number of rows and says so", async () => {
  const result = await runFreeQuery("SELECT * FROM vw_vendas_itens");
  assert.equal(result.rows.length, MAX_FREE_ROWS);
  assert.equal(result.truncated, true);
});
test("a comment cannot break out of the wrapping query", async () => {
  const result = await runFreeQuery("SELECT placa FROM vw_frota_veiculos LIMIT 2 -- ) AS q; DROP TABLE frota_veiculos");
  assert.equal(result.rows.length, 2);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM frota_veiculos");
  assert.equal(rows[0].n, 12);
});
test("database errors are reported for repair, not thrown as crashes", async () => {
  await assert.rejects(runFreeQuery("SELECT coluna_inexistente FROM vw_frota_veiculos"), (error: unknown) => error instanceof FreeQueryError && error.kind === "database" && /coluna_inexistente/.test(error.message));
  await assert.rejects(runFreeQuery("SELECT * FROM frota_veiculos"), (error: unknown) => error instanceof FreeQueryError && error.kind === "guard");
});
test("the database itself refuses what the guard would miss: base tables and writes", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE erp_free_reader");
    await assert.rejects(client.query("SELECT * FROM frota_veiculos"), /permission denied/);
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE erp_free_reader");
    await assert.rejects(client.query("UPDATE frota_veiculos SET situacao = 'D'"), /permission denied/);
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE erp_free_reader");
    await assert.rejects(client.query("SELECT * FROM erp_free_dummy_does_not_matter"), /does not exist|permission denied/);
    await client.query("ROLLBACK");
  } finally { client.release(); }
});
test("WITH, UNION and ORDER BY survive the wrapping query", async () => {
  const withCte = await runFreeQuery("WITH abertas AS (SELECT veiculo_id FROM vw_frota_ocorrencias WHERE fim_em IS NULL) SELECT v.placa FROM vw_frota_veiculos v JOIN abertas a ON a.veiculo_id = v.veiculo_id ORDER BY v.placa");
  assert.ok(withCte.rows.length >= 2);
  assert.deepEqual(withCte.rows.map(r => r.placa), [...withCte.rows.map(r => r.placa)].sort());
  const union = await runFreeQuery("SELECT placa FROM vw_frota_veiculos WHERE situacao = 'M' UNION SELECT placa FROM vw_frota_veiculos WHERE situacao = 'P' ORDER BY 1");
  assert.equal(union.rows.length, 3);
  assert.deepEqual(union.views, ["vw_frota_veiculos"]);
  const agg = await runFreeQuery("SELECT situacao, count(*) AS veiculos FROM vw_frota_veiculos GROUP BY situacao ORDER BY veiculos DESC, situacao");
  assert.equal(agg.rows[0]!.situacao, "D");
  assert.equal(agg.rows[0]!.veiculos, "6");
});
