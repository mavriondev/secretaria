import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { contasAReceberVencidas, faturamento, produtosMaisVendidos } from "../lib/metrics";
import { addDays, assertDate, localToday, range, resolvePeriod } from "../lib/periods";
import { withMetricReader } from "../lib/metric-reader";

let fixtureStart: string;
before(async () => {
  const { rows } = await pool.query("SELECT fixture_start_date::text AS day FROM demo_metadata WHERE id = 1");
  assert.ok(rows[0], "Run db:push and demo:setup before metric tests");
  fixtureStart = rows[0].day;
});
after(() => pool.end());

// The expected figures below are hand-calculated from the six golden fixture
// lines and six finance records, not by copying/re-running the metric SQL.
test("revenue: discounts included; cancelled and purchase notes excluded", async () => {
  const result = await faturamento(range(fixtureStart, addDays(fixtureStart, 2)));
  // 100 - 10 + 50 + 150 - 15 + 200 - 20 = 455
  assert.equal(result.value, 455);
  assert.deepEqual(result.details.map(d => d.amount), [320, 135]);
  assert.equal(result.period.startDate, fixtureStart);
  assert.equal(result.comparisons[0]?.value, 0);
  assert.equal(result.comparisons[0]?.variationPct, null);
});
test("revenue: equivalent previous day and same weekday comparisons", async () => {
  const day = addDays(fixtureStart, 1);
  const result = await faturamento(range(day, day));
  assert.equal(result.value, 135);
  assert.equal(result.comparisons[0]?.value, 140);
  assert.equal(result.comparisons[0]?.variationPct, -3.57);
  assert.equal(result.comparisons[1]?.value, 0);
  assert.equal(result.comparisons[1]?.variationPct, null);
});
test("receivables: unpaid revenues, strict due date, debtors and aging", async () => {
  const result = await contasAReceberVencidas(addDays(fixtureStart, 2));
  // 100 + 250 + 300 = 650; paid 999, expense 777 and due-today 400 excluded
  assert.equal(result.value, 650);
  assert.equal(result.rawResult.quantidade, 3);
  assert.deepEqual(result.details.filter(d => !d.bucket).map(d => [d.amount, d.quantity]), [[400, 2], [250, 1]]);
  assert.deepEqual(result.details.filter(d => d.bucket).map(d => d.amount), [100, 250, 0, 300]);
});
test("receivables: date boundary moves only the now-overdue title", async () => {
  const result = await contasAReceberVencidas(addDays(fixtureStart, 3));
  assert.equal(result.value, 1050);
  assert.equal(result.rawResult.quantidade, 4);
});
test("products: net-value ranking, quantities and requested limit", async () => {
  const result = await produtosMaisVendidos(range(fixtureStart, addDays(fixtureStart, 2)), 2);
  assert.equal(result.value, 225);
  assert.equal(result.rawResult.totalPeriodo, 455);
  assert.equal(result.details.length, 2);
  assert.deepEqual(result.details.map(d => [d.amount, d.quantity]), [[225, 5], [180, 1]]);
});
test("products: all three fixture products appear in expected order", async () => {
  const result = await produtosMaisVendidos(range(fixtureStart, addDays(fixtureStart, 2)), 5);
  assert.deepEqual(result.details.map(d => [d.amount, d.quantity]), [[225, 5], [180, 1], [50, 1]]);
});
test("invalid arguments fail instead of inventing or broadening the query", async () => {
  assert.throws(() => assertDate("2026-02-30"));
  assert.throws(() => range("2026-10-10", "2026-10-01"));
  await assert.rejects(() => produtosMaisVendidos(range(fixtureStart, fixtureStart), 21));
  await assert.rejects(() => contasAReceberVencidas("today"));
});
test("Sao Paulo calendar boundaries are independent of server timezone", () => {
  assert.equal(localToday(new Date("2026-10-10T02:59:59Z")), "2026-10-09");
  assert.equal(localToday(new Date("2026-10-10T03:00:00Z")), "2026-10-10");
  assert.deepEqual(resolvePeriod({ preset: "last_month" }, new Date("2026-10-09T15:00:00Z")), { startDate: "2026-09-01", endDate: "2026-09-30", label: "Mês passado", comparisonMonths: 1 });
  assert.equal(resolvePeriod({ preset: "this_week" }, new Date("2026-10-09T15:00:00Z")).startDate, "2026-10-05");
});
test("metric role cannot read raw ERP tables or audit logs", async () => {
  for (const sql of ['SELECT * FROM "TGFCAB" LIMIT 1', "SELECT * FROM query_logs LIMIT 1"]) {
    await assert.rejects(() => withMetricReader(client => client.query(sql)), (error: unknown) => (error as { code: string }).code === "42501");
  }
});
test("metric transactions cannot write data", async () => {
  await assert.rejects(() => withMetricReader(client => client.query("UPDATE vw_titulos_receber SET valor = 0")));
});
