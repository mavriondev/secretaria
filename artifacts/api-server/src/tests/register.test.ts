import { test } from "node:test";
import assert from "node:assert/strict";
import { presentResults, type Composer } from "../lib/presentation";
import { buildCandidates, resolvePresentation } from "../lib/relevance";
import { advanceState, emptyState, openQuestion, registerOnlyTurn, stateFrom } from "../lib/conversation-state";
import { compositionInstructions } from "../lib/compose";
import { capabilitiesMap, capabilitiesText } from "../lib/tool-contracts";
import { dollarFacts, dollarText } from "../lib/public-research";
import { revenueResult, toolResult } from "./fixtures";

const composerOf = (texto: string, sugestao: { tool: string | null; params: string | null } = { tool: null, params: null }) => {
  const box = { calls: 0, inputs: [] as Array<{ presentation: string; candidates: unknown[]; level: number }>, composer: (async (input: { presentation: string; candidates: unknown[]; level: number }) => { box.calls++; box.inputs.push(input); return { raw: { texto, idsUsados: [], sugestao, encerrar: false }, usage: undefined }; }) as unknown as Composer };
  return box;
};
const neverCompose: Composer = async () => { throw new Error("composition must not be called"); };

test("'Eu quero saber só o valor do faturamento do último mês': one sentence, no list, no comparison, no call", async () => {
  const resolved = resolvePresentation("conciso", "Eu quero saber só o valor do faturamento do último mês");
  assert.equal(resolved.presentation, "conciso"); assert.equal(resolved.origem, "roteador");
  const presented = await presentResults({ question: "Eu quero saber só o valor do faturamento do último mês", level: 2, presentation: "conciso", results: [toolResult(revenueResult({ previous: 800000, monthly: [{ month: "2026-08", amount: 1 }, { month: "2026-09", amount: 2 }] }))], state: emptyState(), composer: neverCompose });
  assert.equal(presented.display, "O faturamento líquido de setembro de 2026 foi R$ 630.359,91.\n\nDados atualizados em 09/10/2026 18:18.");
  assert.equal(presented.spoken, "O faturamento líquido de setembro de dois mil e vinte e seis foi seiscentos e trinta mil, trezentos e cinquenta e nove reais e noventa e um centavos.");
  assert.equal(presented.candidates, 0); assert.equal(presented.composition, "nao-necessaria");
});

test("'Agora me fala completo' is a continuation of the last consultation, not a new question", () => {
  const state = advanceState(emptyState(), { presented: [], executed: [{ tool: "faturamento", params: { periodo: "custom", data_inicio: "2026-09-01", data_fim: "2026-09-30", meses: null } }], offered: null, refusedPending: false });
  assert.deepEqual(state.ultimaAcao?.tool, "faturamento");
  assert.equal(registerOnlyTurn("Agora me fala completo"), "completo");
  assert.equal(registerOnlyTurn("resumido, por favor"), "conciso");
  assert.equal(registerOnlyTurn("pode voltar ao normal"), "normal");
  assert.equal(registerOnlyTurn("A partir de agora seja objetivo"), null, "a standing preference goes through the router (definir_registro)");
  assert.equal(registerOnlyTurn("me fala completo o faturamento de agosto"), null, "a new consultation goes through the router");
  assert.equal(registerOnlyTurn("Qual foi o faturamento de setembro?"), null);
});

test("'completo': every insight becomes a candidate, composition always runs and may end with questions tied to valid actions", async () => {
  const result = toolResult(revenueResult({ previous: 640000 }), { periodo: "last_month" });
  assert.equal(buildCandidates({ results: [result], facts: [], state: emptyState(), level: 1, presentation: "normal" }).length, 0, "a 1.5% variation is below the normal threshold");
  const box = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}, {{comparacao.movimento}} de {{comparacao.variacao}} em relação a {{comparacao.periodo}}. Quer que eu abra por cliente?", { tool: "consultar_vendas", params: JSON.stringify({ periodo: "custom", data_inicio: "2026-09-01", data_fim: "2026-09-30", meses: null, agrupar: "cliente", filtro_tipo: null, filtro_nome: null, limite: 10 }) });
  const presented = await presentResults({ question: "Agora me fala completo", level: 0, presentation: "completo", results: [result], state: emptyState(), composer: box.composer });
  assert.equal(box.calls, 1, "explicit request wins over the initiative level");
  assert.ok(box.inputs[0]!.candidates.length >= 1, "comparison enters as a candidate in the complete register");
  assert.equal(presented.composition, "executada");
  assert.match(presented.display, /queda de 1,51% em relação a agosto de 2026\. Quer que eu abra por cliente\?/);
  assert.equal(presented.offered?.tool, "consultar_vendas");
  assert.match(compositionInstructions(0, "completo"), /COMPLETO/);
  assert.match(compositionInstructions(1, "normal"), /nunca obrigatória/);
  assert.match(compositionInstructions(1, "normal"), /Saudação só se o usuário cumprimentou/);
});

test("normal register: a closing question without a valid suggestion still falls back to the deterministic text", async () => {
  const box = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}. Quer ver mais alguma coisa?");
  const presented = await presentResults({ question: "Como foi setembro?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: box.composer });
  assert.equal(presented.composition, "rejeitada");
  assert.doesNotMatch(presented.display, /\?/);
});

test("'A partir de agora seja objetivo': the standing register applies to later turns until the user changes it", () => {
  const standing = advanceState(emptyState(), { presented: [], executed: [], offered: null, refusedPending: false, registroPadrao: "conciso" });
  const later = advanceState(standing, { presented: [], executed: [], offered: null, refusedPending: false });
  assert.equal(stateFrom([{ parameters: { _state: later } }]).registroPadrao, "conciso");
  assert.deepEqual(resolvePresentation("normal", "Qual foi o faturamento de agosto?", later.registroPadrao), { presentation: "conciso", origem: "conversa" });
  assert.deepEqual(resolvePresentation("completo", "Me explica tudo sobre agosto", later.registroPadrao), { presentation: "completo", origem: "roteador" }, "an explicit request in the turn wins");
  const reset = advanceState(later, { presented: [], executed: [], offered: null, refusedPending: false, registroPadrao: null });
  assert.equal(reset.registroPadrao, null);
  assert.deepEqual(resolvePresentation(undefined, "Qual foi o faturamento?", null), { presentation: "normal", origem: "roteador" });
});

test("an open clarification is remembered for exactly one turn", () => {
  const asked = advanceState(emptyState(), { presented: [], executed: [], offered: null, refusedPending: false, perguntaAberta: "Você quer o faturamento de setembro ou de outubro?" });
  assert.equal(openQuestion(asked)?.pergunta, "Você quer o faturamento de setembro ou de outubro?");
  const answered = advanceState(asked, { presented: [], executed: [], offered: null, refusedPending: false });
  assert.equal(openQuestion(answered), null);
});

test("dollar quote follows the register from code-computed facts: concise, normal and complete", () => {
  const facts = dollarFacts({ cotacaoCompra: 5.4312, cotacaoVenda: 5.4318, dataHoraCotacao: "2026-10-09 13:09:31.72" }, { cotacaoVenda: 5.4 });
  assert.equal(dollarText(facts, "conciso").answer, "R$ 5,43 (PTAX de 09/10/2026).");
  assert.equal(dollarText(facts, "conciso").spoken, "cinco reais e quarenta e três centavos (PTAX de nove de outubro de dois mil e vinte e seis).");
  assert.equal(dollarText(facts, "normal").answer, "O dólar está em R$ 5,43 para venda, pela cotação PTAX do Banco Central de 09/10/2026; não é dólar turismo nem cotação comercial em tempo real.");
  const complete = dollarText(facts, "completo").answer;
  assert.match(complete, /R\$ 5,4318 para venda e R\$ 5,4312 para compra/);
  assert.match(complete, /alta de 0,59%/);
  assert.doesNotMatch(dollarText(dollarFacts({ cotacaoCompra: 5.4312, cotacaoVenda: 5.4318, dataHoraCotacao: "2026-10-09 13:09:31.72" }), "completo").answer, /anterior/);
});

test("the capabilities map comes from the tool contracts, not from hand-written phrases", () => {
  const map = capabilitiesMap();
  assert.deepEqual(map.agrupamentos, ["mes", "cliente", "produto", "vendedor"]);
  assert.ok(map.consultas.some(c => c.startsWith("faturamento:")));
  assert.ok(!map.consultas.some(c => /pesquisar|responder|definir_registro/.test(c)));
  assert.match(capabilitiesText(), /Não existe nesta base: lucro/);
  assert.match(capabilitiesText(), /frota/);
});
