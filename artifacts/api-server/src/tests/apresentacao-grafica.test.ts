import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoCartao, escolherForma, formasCompativeis, reduzirRanking, reduzirSerie, toNumber, type CardColumn } from "../lib/apresentacao-grafica";

const col = (name: string, type: CardColumn["type"]): CardColumn => ({ name, label: name, type });

test("the form is chosen by the shape of the result, never by the model", () => {
  assert.equal(escolherForma([col("total", "dinheiro")], [{ total: "1200.5" }]), "numero");
  assert.equal(escolherForma([col("data", "data"), col("total", "dinheiro")], [{ data: "2026-10-01", total: "1" }, { data: "2026-10-02", total: "2" }]), "serie");
  assert.equal(escolherForma([col("cliente", "texto"), col("total", "dinheiro")], [{ cliente: "A", total: "1" }, { cliente: "B", total: "2" }]), "ranking");
  assert.equal(escolherForma([col("cliente", "texto"), col("produto", "texto")], [{ cliente: "A", produto: "x" }, { cliente: "B", produto: "y" }]), "tabela");
  const many = Array.from({ length: 40 }, (_, i) => ({ cliente: `C${i}`, total: String(i) }));
  assert.equal(escolherForma([col("cliente", "texto"), col("total", "dinheiro")], many), "tabela");
  assert.deepEqual(formasCompativeis([col("cliente", "texto"), col("total", "dinheiro")], many), ["tabela", "ranking"]);
  // A detail listing with several rows per day is a table, not a line.
  assert.equal(escolherForma([col("data", "data"), col("cliente", "texto"), col("total", "dinheiro")], [{ data: "2026-10-01", cliente: "A", total: "1" }, { data: "2026-10-01", cliente: "B", total: "2" }]), "tabela");
  // An identifier column is a label, not a measure.
  assert.equal(escolherForma([col("cliente_id", "inteiro"), col("total", "dinheiro")], [{ cliente_id: "7", total: "1" }, { cliente_id: "9", total: "2" }]), "ranking");
});

test("series are reduced keeping first, last, maximum and minimum; rankings group the rest into Outros; tables stop at ten rows", () => {
  const points = Array.from({ length: 400 }, (_, i) => ({ x: `2025-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}#${i}`, y: i === 200 ? 9999 : i === 300 ? -50 : i }));
  const reduced = reduzirSerie(points);
  assert.ok(reduced.summarized && reduced.points.length <= 124 && reduced.points.length >= 120);
  assert.equal(reduced.points[0], points[0]); assert.equal(reduced.points.at(-1), points.at(-1));
  assert.ok(reduced.points.some(p => p.y === 9999) && reduced.points.some(p => p.y === -50));
  const bars = reduzirRanking(Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, value: 10 })));
  assert.equal(bars.bars.length, 15); assert.equal(bars.bars.at(-1)?.label, "Outros"); assert.equal(bars.bars.at(-1)?.value, 60); assert.equal(bars.grouped, 6);
  const table = dadosDoCartao("tabela", [col("a", "texto")], Array.from({ length: 25 }, (_, i) => ({ a: String(i) })));
  assert.ok(table.form === "tabela" && table.rows.length === 10 && table.total === 25 && table.truncated);
});

test("absurd values become dashes instead of breaking a scale", () => {
  assert.equal(toNumber("NaN"), null); assert.equal(toNumber(null), null); assert.equal(toNumber("1e20"), null); assert.equal(toNumber("-12.5"), -12.5);
  const numero = dadosDoCartao("numero", [col("total", "dinheiro")], [{ total: "abc" }]);
  assert.ok(numero.form === "numero" && numero.value === null && numero.raw === "abc");
  const serie = dadosDoCartao("serie", [col("data", "data"), col("total", "dinheiro")], [{ data: "2026-01-02", total: null }, { data: "2026-01-01", total: "3" }]);
  assert.ok(serie.form === "serie" && serie.points[0]?.x === "2026-01-01" && serie.points[1]?.y === null, "sorted by date, null kept as a gap");
});
