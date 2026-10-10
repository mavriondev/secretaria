import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_FICHA, columnDefinition, fichaPrompt, fichaSchema, loadFicha } from "../lib/ficha";
import { pendingFields, skeletonFicha } from "../lib/ficha-gerar";

const dir = mkdtempSync(join(tmpdir(), "ficha-"));
const write = (name: string, value: unknown) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path; };

test("the demo ficha is valid and spells out what the codes mean", () => {
  assert.ok(fichaSchema.safeParse(DEMO_FICHA).success);
  const prompt = fichaPrompt(DEMO_FICHA);
  assert.match(prompt, /vw_frota_veiculos/);
  assert.match(prompt, /'M' = em manutenção \(defeito\)/);
  assert.equal(columnDefinition("situacao", ["vw_frota_veiculos"], DEMO_FICHA)?.tipo, "codigo");
  assert.equal(columnDefinition("situacao", ["vw_vendas_itens"], DEMO_FICHA), null, "só as views usadas pela consulta contam");
});
test("a client ficha is loaded from FICHA_PATH and wrong files fail loudly", () => {
  assert.equal(loadFicha(write("ok.json", { ...DEMO_FICHA, empresa: "Cliente Teste" })).empresa, "Cliente Teste");
  assert.throws(() => loadFicha(join(dir, "nao-existe.json")), /FICHA_PATH/);
  assert.throws(() => loadFicha(write("ruim.json", { empresa: "X", visoes: [{ nome: "Vw-Ruim", assunto: "a", descricao: "b", colunas: [] }] })), /inválida/);
});
test("a skeleton generated from the database cannot be used until it is described", () => {
  const skeleton = skeletonFicha("Cliente Novo", [
    { view: "vw_notas", column: "valor", dataType: "numeric" }, { view: "vw_notas", column: "emissao", dataType: "date" },
    { view: "vw_notas", column: "atualizado_em", dataType: "timestamp with time zone" }, { view: "vw_notas", column: "obs", dataType: "text" },
  ]);
  assert.ok(fichaSchema.safeParse(skeleton).success);
  assert.deepEqual(skeleton.visoes[0]!.colunas.map(c => c.tipo), ["numero", "data", "data_hora", "texto"]);
  assert.equal(skeleton.visoes[0]!.atualizadoEm, "atualizado_em");
  assert.ok(pendingFields(skeleton).length >= 6);
  assert.throws(() => loadFicha(write("esqueleto.json", skeleton)), /incompleta/);
});
