import { test } from "node:test";
import assert from "node:assert/strict";
import { guardSql } from "../lib/sql-guard";

const view = "vw_frota_veiculos";
for (const statement of [
  `DELETE FROM ${view} RETURNING *`,
  `UPDATE ${view} SET placa = 'X' RETURNING *`,
  `INSERT INTO ${view}(placa) VALUES ('X') RETURNING *`,
]) {
  test(`rejects a writing CTE before database execution: ${statement.split(" ")[0]}`, () => {
    for (const sql of [
      `WITH x AS (${statement}) SELECT * FROM x`,
      `WITH a AS (SELECT * FROM ${view}), x AS (${statement}) SELECT * FROM a`,
      `WITH a AS (WITH x AS (${statement}) SELECT * FROM x) SELECT * FROM a`,
    ]) {
      const r = guardSql(sql, [view]);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /leitura.*qualquer nível/);
    }
  });
}
test("SELECT, read CTE, UNION, nested CTE and windows remain accepted unchanged", () => {
  for (const sql of [
    `SELECT * FROM ${view}`,
    `WITH x AS (SELECT * FROM ${view}) SELECT * FROM x`,
    `WITH a AS (WITH x AS (SELECT * FROM ${view}) SELECT * FROM x) SELECT * FROM a`,
    `SELECT placa FROM ${view} UNION ALL SELECT placa FROM ${view}`,
    `SELECT placa, row_number() OVER (ORDER BY placa) FROM ${view}`,
    `SELECT * FROM (SELECT placa FROM ${view}) x`,
  ]) {
    const r = guardSql(sql, [view]);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) assert.equal(r.sql, sql);
  }
});
