import { test } from "node:test";
import assert from "node:assert/strict";
import { metricFacts, numberToWordsPt, periodForms, requestedComparisonFacts, spokenPercent, spokenReais } from "../lib/facts";
import { revenueResult, receivablesResult } from "./fixtures";

test("spoken numbers follow Brazilian Portuguese", () => {
  assert.equal(numberToWordsPt(100), "cem");
  assert.equal(numberToWordsPt(101), "cento e um");
  assert.equal(numberToWordsPt(1000), "mil");
  assert.equal(numberToWordsPt(2026), "dois mil e vinte e seis");
  assert.equal(numberToWordsPt(630359), "seiscentos e trinta mil, trezentos e cinquenta e nove");
  assert.equal(numberToWordsPt(1_000_000), "um milhão");
  assert.equal(numberToWordsPt(1_959_861), "um milhão, novecentos e cinquenta e nove mil, oitocentos e sessenta e um");
  assert.equal(spokenReais(630359.91), "seiscentos e trinta mil, trezentos e cinquenta e nove reais e noventa e um centavos");
  assert.equal(spokenReais(1), "um real");
  assert.equal(spokenReais(0.5), "cinquenta centavos");
  assert.equal(spokenPercent(-2.56), "dois vírgula cinquenta e seis por cento");
  assert.equal(spokenPercent(13.5), "treze vírgula cinquenta por cento");
  assert.equal(spokenPercent(7.05), "sete vírgula zero cinco por cento");
});
test("periods keep calendar meaning in both forms", () => {
  assert.deepEqual(periodForms("2026-09-01", "2026-09-30"), { display: "setembro de 2026", spoken: "setembro de dois mil e vinte e seis" });
  assert.equal(periodForms("2026-07-01", "2026-09-30").display, "julho a setembro de 2026");
  assert.equal(periodForms("2026-09-01", "2026-09-09").display, "01/09/2026 a 09/09/2026");
  assert.equal(periodForms("2026-09-01", "2026-09-09").spoken, "primeiro de setembro de dois mil e vinte e seis a nove de setembro de dois mil e vinte e seis");
});
test("comparison is a fact with id, display and spoken, not attached text", () => {
  const facts = metricFacts(revenueResult());
  const ids = facts.map(f => f.id);
  assert.ok(ids.includes("total") && ids.includes("periodo") && ids.includes("comparacao.valor") && ids.includes("comparacao.variacao") && ids.includes("comparacao.direcao"));
  const variation = facts.find(f => f.id === "comparacao.variacao")!;
  assert.equal(variation.display, "2,56%"); assert.equal(variation.spoken, "dois vírgula cinquenta e seis por cento");
  assert.equal(facts.find(f => f.id === "comparacao.direcao")!.display, "abaixo");
  assert.equal(facts.find(f => f.id === "total")!.display, "R$ 630.359,91");
  assert.match(facts.find(f => f.id === "concentracao.cliente")!.display, /%$/);
  // Keys are qualified by period so the same fact of another month is new information.
  assert.equal(facts.find(f => f.id === "comparacao.variacao")!.key, "faturamento:comparacao.variacao@2026-09-01..2026-09-30");
  const prefixed = metricFacts(revenueResult(), "faturamento_2026-09");
  assert.ok(prefixed.every(f => f.id.startsWith("faturamento_2026-09.")));
});
test("receivables expose debtors and overdue buckets as facts", () => {
  const facts = metricFacts(receivablesResult());
  assert.equal(facts.find(f => f.id === "devedor.1.nome")!.display, "Distribuidora Norte 4");
  assert.equal(facts.find(f => f.id === "atraso.acima_90.participacao")!.display, "58,75%");
  assert.equal(facts.find(f => f.id === "titulos.quantidade")!.spoken, "nove títulos");
});
test("explicit two-period comparison is computed by code", () => {
  const sep = { prefix: "faturamento_2026-09", result: revenueResult({ value: 630359.91 }) };
  const jul = { prefix: "faturamento_2026-07", result: revenueResult({ start: "2026-07-01", end: "2026-07-31", value: 682603.2 }) };
  const facts = requestedComparisonFacts(sep, jul);
  assert.equal(facts.find(f => f.id === "comparacao_pedida.variacao")!.display, "7,65%");
  assert.equal(facts.find(f => f.id === "comparacao_pedida.direcao")!.display, "abaixo");
  assert.equal(requestedComparisonFacts(sep, { ...jul, result: revenueResult({ value: 0 }) })[0]!.id, "comparacao_pedida.sem_base");
});
