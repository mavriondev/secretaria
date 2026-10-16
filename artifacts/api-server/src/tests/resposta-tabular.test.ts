import { test } from "node:test";
import assert from "node:assert/strict";
import { montarRespostaTabular } from "../lib/resposta-tabular";
import type { FreeQueryResult } from "../lib/free-query";
const sample = (n: number): FreeQueryResult => ({
  sql: "SELECT cliente, saldo FROM vw_titulos_receber", views: ["vw_titulos_receber"], updatedAt: "2026-10-09T18:18:00Z", truncated: false,
  columns: [{ name: "cliente", oid: 25 }, { name: "saldo", oid: 1700 }],
  rows: Array.from({ length: n }, (_, i) => ({ cliente: `Cliente ${i}`, saldo: i ? String(i * 10.03) : null })),
});
const formats = [{ coluna: "saldo", formato: "dinheiro", rotulo: "Saldo em aberto" }] as const;
test("view adapter preserves each original cell, friendly types and age; never mutates source", () => {
  const original = sample(35), copy = structuredClone(original);
  const table = montarRespostaTabular(original, [...formats])!;
  assert.deepEqual(original, copy); assert.deepEqual(table.rows, original.rows);
  assert.equal(table.rows.length, 35); assert.equal(table.forma, "tabela");
  assert.equal(table.columns[1]!.label, "Saldo em aberto"); assert.equal(table.columns[1]!.type, "dinheiro");
  assert.equal(table.updatedAt, original.updatedAt);
  const preview = table.previas.tabela!;
  assert.ok(preview.form === "tabela");
  assert.equal(preview.rows.length, 10);
  assert.equal(table.rows[0]!.saldo, null);
});
test("only loaded authorized rows up to200 are exposed and truncation is explicit", () => {
  const r = montarRespostaTabular(sample(201), [...formats])!;
  assert.equal(r.rows.length, 200); assert.equal(r.truncated, true);
});
test("repeated labels cannot produce newly aggregated bar values", () => {
  const original = sample(6); original.rows[1]!.cliente = original.rows[0]!.cliente!;
  const table = montarRespostaTabular(original, [...formats])!;
  assert.ok(!table.formas.includes("ranking"));
  assert.deepEqual(table.rows, original.rows);
});
test("empty lists and a single scalar leave the existing answer untouched", () => {
  assert.equal(montarRespostaTabular(sample(0), []), null);
  const scalar = sample(1); scalar.columns = [{ name: "saldo", oid: 1700 }]; scalar.rows = [{ saldo: "630359.91" }];
  assert.equal(montarRespostaTabular(scalar, [...formats]), null);
});
test("receivables buckets and top clients are clearly labelled and never aggregated into bars", () => {
  const input = sample(5); input.columns.push({ name: "dias", oid: 23 });
  input.rows[0] = { cliente: "Atraso: 1-30 dias", saldo: "100.00", dias: null };
  const r = montarRespostaTabular(input, [...formats])!;
  assert.equal(r.columns[0]!.label, "Cliente / faixa de atraso");
  assert.ok(!r.formas.includes("ranking")); assert.deepEqual(r.rows, input.rows);
});
