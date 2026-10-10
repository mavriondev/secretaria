import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { faturamento } from "../lib/metrics";
import { addDays, range, yearAgoPeriod } from "../lib/periods";
import { metricFacts } from "../lib/facts";
import { deterministicHeadline } from "../lib/deterministic";
import { validateAction, faturamentoSchema } from "../lib/tool-contracts";
import { revenueResult, toolResult } from "./fixtures";

let fixtureStart: string;
before(async () => {
  const { rows } = await pool.query("SELECT fixture_start_date::text AS day FROM demo_metadata WHERE id = 1");
  assert.ok(rows[0], "Run db:push and demo:setup before metric tests");
  fixtureStart = rows[0].day;
});
after(() => pool.end());

test("year-ago period keeps the calendar interval and whole months", () => {
  const ago = (a: string, b: string) => { const p = yearAgoPeriod(range(a, b)); return [p.startDate, p.endDate]; };
  assert.deepEqual(ago("2026-08-01", "2026-09-30"), ["2025-08-01", "2025-09-30"]);
  assert.deepEqual(ago("2026-09-01", "2026-09-09"), ["2025-09-01", "2025-09-09"]);
  assert.deepEqual(ago("2026-10-10", "2026-10-10"), ["2025-10-10", "2025-10-10"]);
  // Leap-year edges never produce an invalid date.
  assert.deepEqual(ago("2028-02-29", "2028-02-29"), ["2027-02-28", "2027-02-28"]);
  assert.deepEqual(ago("2028-02-01", "2028-02-29"), ["2027-02-01", "2027-02-28"]);
  assert.deepEqual(ago("2027-02-01", "2027-02-28"), ["2026-02-01", "2026-02-28"]);
});

test("revenue year-over-year: the backend resolves the base, and empty history is not reported as zero revenue", async () => {
  const period = range(fixtureStart, addDays(fixtureStart, 2));
  const result = await faturamento(period, "ano_anterior");
  assert.equal(result.value, 455);
  const base = result.rawResult.periodoAnterior as { startDate: string; endDate: string };
  assert.equal(base.startDate, yearAgoPeriod(period).startDate);
  assert.equal(result.rawResult.comparadoCom, "ano_anterior");
  assert.equal(result.rawResult.baseTemDados, false);
  assert.equal(result.comparisons[0]?.variationPct, null);
  assert.match(result.comparisons[0]!.label, /^Mesmo período do ano anterior/);
  // The default base is unchanged.
  const standard = await faturamento(period);
  assert.equal(standard.rawResult.comparadoCom, "anterior");
});

test("facts name the base and tell missing history from a zero base", () => {
  const withBase = revenueResult();
  withBase.rawResult = { ...withBase.rawResult, comparadoCom: "ano_anterior", baseTemDados: true, periodoAnterior: { startDate: "2025-09-01", endDate: "2025-09-30" } };
  const facts = metricFacts(withBase);
  assert.equal(facts.find(f => f.id === "comparacao.base_nome")!.display, "No mesmo período do ano anterior");
  assert.equal(facts.find(f => f.id === "comparacao.periodo")!.display, "setembro de 2025");
  assert.ok(facts.find(f => f.id === "comparacao.variacao"));
  // The dedupe key carries the base period, so another base for the same period is new information.
  const previousBase = metricFacts(revenueResult()).find(f => f.id === "comparacao.valor")!;
  assert.notEqual(facts.find(f => f.id === "comparacao.valor")!.key, previousBase.key);

  const noHistory = revenueResult({ previous: 0 });
  noHistory.rawResult = { ...noHistory.rawResult, comparadoCom: "ano_anterior", baseTemDados: false, periodoAnterior: { startDate: "2025-09-01", endDate: "2025-09-30" } };
  assert.match(metricFacts(noHistory).find(f => f.id === "comparacao.sem_base")!.display, /não há vendas registradas/);

  const zeroBase = revenueResult({ previous: 0 });
  zeroBase.rawResult = { ...zeroBase.rawResult, comparadoCom: "ano_anterior", baseTemDados: true, periodoAnterior: { startDate: "2025-09-01", endDate: "2025-09-30" } };
  assert.match(metricFacts(zeroBase).find(f => f.id === "comparacao.sem_base")!.display, /base não nula/);
});

test("explicit comparison headline uses the year-ago wording", () => {
  const result = revenueResult();
  result.rawResult = { ...result.rawResult, comparadoCom: "ano_anterior", baseTemDados: true, periodoAnterior: { startDate: "2025-09-01", endDate: "2025-09-30" } };
  const results = [toolResult(result)];
  const facts = metricFacts(result);
  const headline = deterministicHeadline(results, facts, "comparar");
  assert.match(headline.display, /No mesmo período do ano anterior, setembro de 2025, foi/);
  assert.doesNotMatch(headline.display, /período anterior equivalente/);
});

test("tool contract accepts comparar_com and keeps old calls valid", () => {
  const base = { periodo: "custom", meses: null, data_inicio: "2026-08-01", data_fim: "2026-09-30", apresentacao: "comparar" };
  assert.ok(faturamentoSchema.safeParse({ ...base, comparar_com: "ano_anterior" }).success);
  assert.ok(faturamentoSchema.safeParse({ ...base, comparar_com: null }).success);
  assert.ok(faturamentoSchema.safeParse(base).success);
  assert.ok(!faturamentoSchema.safeParse({ ...base, comparar_com: "mes_passado" }).success);
  assert.ok(validateAction({ tool: "faturamento", params: { periodo: "custom", meses: null, data_inicio: "2026-08-01", data_fim: "2026-09-30" } }));
  assert.ok(validateAction({ tool: "faturamento", params: { periodo: "custom", meses: null, data_inicio: "2026-08-01", data_fim: "2026-09-30", comparar_com: "ano_anterior" } }));
});
