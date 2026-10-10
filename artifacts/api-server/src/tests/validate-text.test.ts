import { test } from "node:test";
import assert from "node:assert/strict";
import { metricFacts } from "../lib/facts";
import { safeValidate } from "../lib/validate-text";
import { revenueResult } from "./fixtures";

const facts = metricFacts(revenueResult());
const question = "Qual foi o faturamento de setembro?";

test("markers are replaced by display and spoken forms", () => {
  const result = safeValidate("Em {{periodo}}, o faturamento líquido foi {{total}}.", facts, question);
  assert.ok(result.ok);
  assert.equal(result.display, "Em setembro de 2026, o faturamento líquido foi R$ 630.359,91.");
  assert.equal(result.spoken, "Em setembro de dois mil e vinte e seis, o faturamento líquido foi seiscentos e trinta mil, trezentos e cinquenta e nove reais e noventa e um centavos.");
  assert.deepEqual(result.usedIds, ["periodo", "total"]);
});
test("a simulated model that invents a number, a name or a percentage is rejected", () => {
  assert.equal(safeValidate("O faturamento foi {{total}}, uma queda de 3% sobre agosto.", facts, question).ok, false);
  assert.equal(safeValidate("O faturamento foi {{total}}; o cliente Fantasma Ltda liderou.", facts, question).ok, false);
  assert.equal(safeValidate("O faturamento foi R$ 650.000,00.", facts, question).ok, false);
  assert.equal(safeValidate("O faturamento foi de seiscentos mil reais.", facts, question).ok, false);
  assert.equal(safeValidate("Foi {{total}} em 15/09/2026.", facts, question).ok, false);
  assert.equal(safeValidate("Foi {{total_geral}}.", facts, question).ok, false);
  assert.equal(safeValidate("Foi {{total}} ou cerca de {{total.", facts, question).ok, false);
});
test("legitimate small numbers never cause fallback", () => {
  const facts3 = metricFacts(revenueResult({ monthly: [{ month: "2026-07", amount: 1 }, { month: "2026-08", amount: 2 }, { month: "2026-09", amount: 3 }] }));
  assert.ok(safeValidate("Nos 3 meses pedidos, o total foi {{total}}.", facts3, "Qual foi o faturamento nos últimos 3 meses?").ok);
  assert.ok(safeValidate("Os 3 maiores clientes somam parte do total {{total}}.", facts, "Quais os 3 maiores clientes?").ok);
  assert.ok(safeValidate("O total foi {{total}}, com variação de 2,56% ({{comparacao.direcao}}).", facts, question).ok, "exact display match of a fact is allowed");
  assert.equal(safeValidate("Nos 4 meses, o total foi {{total}}.", facts3, "Qual foi o faturamento nos últimos 3 meses?").ok, false);
});
test("names present in the facts and month names are accepted", () => {
  const ok = safeValidate("Em {{periodo}}, {{cliente.1.nome}} liderou; Comercial Litoral 12 aparece no topo e Setembro foi o mês consultado.", facts, question);
  assert.ok(ok.ok);
});
