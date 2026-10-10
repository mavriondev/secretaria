import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeItem } from "@workspace/api-zod";
import { erpCatalog, catalogHas, knowledgeContext, knowledgeFacts, KNOWLEDGE_LIMITS, mentionsInternalSubject, teachableReason } from "../lib/knowledge";
import { conversationStateSchema, emptyState, advanceState } from "../lib/conversation-state";
import { safeValidate } from "../lib/validate-text";
import { responseTools, trainingResponseTools } from "../lib/tool-contracts";

const item = (id: number, category: KnowledgeItem["category"], title: string, content: string, extra: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({ id, category, title, content, url: null, erpRef: null, active: true, origin: "painel", createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z", ...extra });

test("financial figures are refused as knowledge; concepts and tags are accepted", () => {
  assert.ok(teachableReason({ title: "Faturamento", content: "O faturamento de setembro foi R$ 630 mil" }));
  assert.ok(teachableReason({ title: "Meta", content: "A margem é de 12%" }));
  assert.equal(teachableReason({ title: "Linha Premium", content: "Chamamos de Premium os produtos da família Alfa; são a prioridade comercial" }), null);
  assert.equal(teachableReason({ title: "Tom", content: "Fale comigo de forma direta, sem rodeios, e me chame de Marcos" }), null);
});

test("knowledge context: profile first, relevance reorders the rest, size ceiling holds, ids are reported", () => {
  const items = [
    item(1, "interesses", "Valor Econômico", "Acompanho câmbio e juros", { url: "https://valor.globo.com" }),
    item(2, "empresa", "Linha Premium", "Produtos da família Alfa"),
    item(3, "perfil", "Tom", "Direto, sem rodeios"),
    item(4, "erp", "TIPMOV V", "Tipo de movimento V é venda", { erpRef: "TGFCAB.TIPMOV" }),
    item(5, "empresa", "Setor Sul", "Clientes do Rio Grande do Sul", { active: false }),
  ];
  const ctx = knowledgeContext(items, "como foi a linha premium este mês?", { research: true });
  assert.ok(ctx.text && ctx.text.startsWith("BASE DE CONHECIMENTO DO GESTOR"));
  assert.equal(ctx.ids[0], 3, "profile comes first");
  assert.equal(ctx.ids[1], 2, "the item matching the question comes next");
  assert.ok(!ctx.ids.includes(5), "inactive items never enter");
  assert.deepEqual(ctx.sources, [{ title: "Valor Econômico", url: "https://valor.globo.com" }]);
  assert.deepEqual(knowledgeContext(items, "x", { research: false }).sources, []);
  const many = Array.from({ length: 80 }, (_, i) => item(100 + i, "empresa", `Tag ${i}`, "x".repeat(300)));
  const capped = knowledgeContext(many, "qualquer coisa");
  assert.ok(capped.text!.length <= KNOWLEDGE_LIMITS.contextChars + 200);
  assert.ok(capped.ids.length < many.length);
  assert.equal(knowledgeContext([], "oi").text, null);
});

test("knowledge terms are known words for the validator, but no number can enter through knowledge", () => {
  const items = [item(2, "empresa", "Linha Premium", "Produtos da família Alfa, cerca de 300 itens")];
  const facts = knowledgeFacts(items, [2]);
  assert.doesNotMatch(facts[0]!.display, /\d/);
  const total = { id: "total", label: "total", kind: "money" as const, value: 1, display: "R$ 1,00", spoken: "um real", key: "total" };
  assert.equal(safeValidate("A linha Premium rendeu {{total}}.", [total], "como foi a Premium?", facts).ok, true);
  const rejected = safeValidate("A linha Premium tem 300 itens e rendeu {{total}}.", [total], "como foi a Premium?", facts);
  assert.equal(rejected.ok, false);
  assert.equal(safeValidate("A linha Premium rendeu {{total}}.", [total], "como foi?").ok, false, "without knowledge the term is an unknown proper name");
});

test("domain guard: a subject taught as internal is never researched", () => {
  const items = [item(2, "empresa", "Projeto Horizonte", "Nome interno da expansão para o Nordeste"), item(1, "interesses", "Dólar", "Acompanho o câmbio")];
  assert.equal(mentionsInternalSubject("notícias sobre o projeto horizonte", items), true);
  assert.equal(mentionsInternalSubject("cotação do dólar hoje", items), false);
});

test("ERP catalog comes from the real schema and validates references", () => {
  const catalog = erpCatalog();
  const cab = catalog.tables.find(t => t.name === "TGFCAB");
  assert.ok(cab && cab.columns.some(c => c.name === "TIPMOV" && c.role === "movement"));
  assert.ok(catalogHas("TGFCAB.TIPMOV")); assert.ok(catalogHas("tgfpar"));
  assert.equal(catalogHas("TGFCAB.NAOEXISTE"), false); assert.equal(catalogHas("TGFXXX"), false);
  assert.equal(catalog.limits.perCategory, KNOWLEDGE_LIMITS.perCategory);
});

test("training is an explicit milestone in the typed state; older states default to closed", () => {
  const legacy = conversationStateSchema.parse({ periodo: null, filtros: null, apresentado: [], sugestoes: [], capacidades: [], turno: 3 });
  assert.equal(legacy.treinamento, false); assert.deepEqual(legacy.ensinados, []);
  const opened = advanceState(emptyState(), { presented: [], executed: [], offered: null, refusedPending: false, treinamento: true });
  assert.equal(opened.treinamento, true);
  const taught = advanceState(opened, { presented: [], executed: [], offered: null, refusedPending: false, ensinados: [7] });
  assert.equal(taught.treinamento, true, "the milestone persists until closed"); assert.deepEqual(taught.ensinados, [7]);
  const closed = advanceState(taught, { presented: [], executed: [], offered: null, refusedPending: false, treinamento: false });
  assert.equal(closed.treinamento, false);
});

test("tool sets: outside training nothing can be taught; inside training no ERP query or research exists", () => {
  const names = (tools: Array<{ type: string; name?: string }>) => tools.map(t => t.name);
  assert.ok(names(responseTools).includes("iniciar_treinamento"));
  assert.ok(!names(responseTools).includes("ensinar"));
  assert.deepEqual(names(trainingResponseTools).sort(), ["encerrar_treinamento", "ensinar", "esquecer", "responder"]);
});
