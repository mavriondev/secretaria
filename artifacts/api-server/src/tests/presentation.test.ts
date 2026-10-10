import { test } from "node:test";
import assert from "node:assert/strict";
import { presentResults, type Composer } from "../lib/presentation";
import { buildCandidates, detectPresentation, resolvePresentation } from "../lib/relevance";
import { metricFacts } from "../lib/facts";
import { acceptsSuggestion, advanceState, emptyState, pendingSuggestion, refusesSuggestion, stateFrom } from "../lib/conversation-state";
import { compositionInstructions } from "../lib/compose";
import { validateAction } from "../lib/tool-contracts";
import { revenueResult, receivablesResult, toolResult } from "./fixtures";

const composerOf = (texto: string, extra: Partial<{ sugestao: { tool: string | null; params: string | null }; encerrar: boolean }> = {}): { composer: Composer; calls: number; inputs: unknown[] } => {
  const box = { calls: 0, inputs: [] as unknown[], composer: (async (input: unknown) => { box.calls++; box.inputs.push(input); return { raw: { texto, idsUsados: [], sugestao: extra.sugestao ?? { tool: null, params: null }, encerrar: extra.encerrar ?? true }, usage: undefined }; }) as unknown as Composer };
  return box;
};
const neverCompose: Composer = async () => { throw new Error("composition must not be called"); };

test("'Qual foi o faturamento de setembro?': value and period, no comparison, no question, no extra call", async () => {
  const presented = await presentResults({ question: "Qual foi o faturamento de setembro?", level: 1, presentation: "normal", results: [toolResult(revenueResult())], state: emptyState(), composer: neverCompose });
  assert.equal(presented.display, "Em setembro de 2026, o faturamento líquido foi R$ 630.359,91.");
  assert.doesNotMatch(presented.display, /Compara|agosto|\?/);
  assert.equal(presented.composition, "nao-necessaria");
  assert.equal(presented.candidates, 0, "a 2.56% variation stays below the threshold");
  assert.match(presented.spoken, /seiscentos e trinta mil/);
});
test("level 2 with a candidate makes exactly one composition call; the model may still only answer the request", async () => {
  const box = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}.");
  const presented = await presentResults({ question: "Como foi o faturamento?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: box.composer });
  assert.equal(box.calls, 1);
  assert.equal(presented.composition, "executada");
  assert.equal(presented.display, "Em setembro de 2026, o faturamento líquido foi R$ 630.359,91.");
  assert.equal(presented.offered, null);
});
test("level 0 never composes even when candidates exist", async () => {
  const presented = await presentResults({ question: "Faturamento de setembro", level: 0, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: neverCompose });
  assert.equal(presented.composition, "nao-necessaria");
  assert.doesNotMatch(presented.display, /agosto/);
});
test("'Compare setembro com agosto': comparison with both periods clear, even below threshold", async () => {
  const presented = await presentResults({ question: "Compare setembro com agosto", level: 1, presentation: "comparar", results: [toolResult(revenueResult())], state: emptyState(), composer: neverCompose });
  assert.match(presented.display, /setembro de 2026.*R\$ 630\.359,91/);
  assert.match(presented.display, /agosto de 2026, foi R\$ 646\.897,93; o resultado atual ficou 2,56% abaixo/);
  assert.match(presented.spoken, /dois vírgula cinquenta e seis por cento abaixo/);
});
test("'Compare setembro com julho': two consultations, labelled facts and a code-computed variation", async () => {
  const sep = toolResult(revenueResult({ value: 630359.91 }));
  const jul = toolResult(revenueResult({ start: "2026-07-01", end: "2026-07-31", value: 682603.2 }));
  const presented = await presentResults({ question: "Compare setembro com julho", level: 2, presentation: "comparar", results: [sep, jul], state: emptyState(), composer: neverCompose });
  assert.match(presented.display, /Em setembro de 2026, o faturamento líquido foi R\$ 630\.359,91\. Em julho de 2026, o faturamento líquido foi R\$ 682\.603,20\. setembro de 2026 ficou 7,65% abaixo de julho de 2026\./);
  assert.doesNotMatch(presented.display, /agosto|junho/, "automatic adjacent comparisons are not shown when the user set the base");
  assert.ok(presented.facts.some(f => f.id === "faturamento_2026-09.total") && presented.facts.some(f => f.id === "faturamento_2026-07.total"));
});
test("after a comparison was presented, another question does not offer it again", async () => {
  const result = toolResult(revenueResult({ previous: 800000 }));
  const first = await presentResults({ question: "Como foi setembro?", level: 1, presentation: "normal", results: [result], state: emptyState(), composer: composerOf("Em {{periodo}}, {{total}}; {{comparacao.variacao}} {{comparacao.direacao}}").composer });
  assert.equal(first.composition, "rejeitada", "typo in a marker falls back");
  const ok = await presentResults({ question: "Como foi setembro?", level: 1, presentation: "normal", results: [result], state: emptyState(), composer: composerOf("Em {{periodo}}, o faturamento foi {{total}}, {{comparacao.variacao}} {{comparacao.direcao}} de {{comparacao.periodo}}.").composer });
  assert.equal(ok.composition, "executada");
  const state = advanceState(emptyState(), { presented: ok.presentedKeys, executed: [], offered: null, refusedPending: false });
  assert.ok(state.apresentado.includes("faturamento:comparacao.variacao@2026-09-01..2026-09-30>2026-08-01..2026-08-31"));
  const second = await presentResults({ question: "E os clientes?", level: 1, presentation: "normal", results: [result], state, composer: neverCompose });
  assert.equal(second.candidates, 0);
  assert.equal(second.composition, "nao-necessaria");
});
test("'Só me diga o total': only the total, no lists, no call", async () => {
  const monthly = [{ month: "2026-07", amount: 682603.2 }, { month: "2026-08", amount: 646897.93 }, { month: "2026-09", amount: 630359.91 }];
  const result = toolResult(revenueResult({ start: "2026-07-01", end: "2026-09-30", value: 1959861.04, previous: 1726665.29, monthly }));
  assert.deepEqual(resolvePresentation("normal", "Só me diga o total do trimestre"), { presentation: "conciso", origem: "padrao" });
  const presented = await presentResults({ question: "Só me diga o total", level: 2, presentation: "conciso", results: [result], state: emptyState(), composer: neverCompose });
  assert.equal(presented.display, "O faturamento líquido de julho a setembro de 2026 foi R$ 1.959.861,04.");
  const normal = await presentResults({ question: "Faturamento do trimestre", level: 0, presentation: "normal", results: [result], state: emptyState(), composer: neverCompose });
  assert.match(normal.display, /Por mês, dentro desse intervalo:\njulho de 2026: R\$ 682\.603,20/);
  assert.doesNotMatch(normal.display, /abril|13,51/);
});
test("'O faturamento foi bom?': instructions forbid judging; neutral composed text passes and must cite the request facts", async () => {
  assert.match(compositionInstructions(1, "normal"), /Não trate aumento ou queda como bom ou ruim/);
  assert.match(compositionInstructions(1, "normal"), /o que falta para avaliar/);
  const result = toolResult(revenueResult({ previous: 800000 }));
  const neutral = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}, {{comparacao.variacao}} {{comparacao.direcao}} de {{comparacao.periodo}}. Os dados não trazem metas, margem ou sazonalidade, então não dá para classificar o resultado como bom ou ruim.");
  const presented = await presentResults({ question: "O faturamento foi bom?", level: 1, presentation: "normal", results: [result], state: emptyState(), composer: neutral.composer });
  assert.equal(presented.composition, "executada");
  assert.match(presented.display, /não dá para classificar/);
  const drifted = await presentResults({ question: "O faturamento foi bom?", level: 1, presentation: "normal", results: [result], state: emptyState(), composer: composerOf("Os dados não trazem metas, então não dá para avaliar.").composer });
  assert.equal(drifted.composition, "rejeitada", "a composition that drops the requested facts falls back");
});
test("'Sim, pode detalhar' executes the pending suggestion; refusal marks it refused; an offered action is never repeated", async () => {
  const action = { tool: "consultar_vendas" as const, params: { periodo: "custom", meses: null, data_inicio: "2026-09-01", data_fim: "2026-09-30", agrupar: "produto", filtro_tipo: null, filtro_nome: null, limite: 5 } };
  const offered = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}, {{comparacao.variacao}} {{comparacao.direcao}} de {{comparacao.periodo}}. Posso detalhar por produto?", { sugestao: { tool: action.tool, params: JSON.stringify(action.params) }, encerrar: false });
  const presented = await presentResults({ question: "Como foi setembro?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: offered.composer });
  assert.deepEqual(presented.offered, action);
  const state = advanceState(emptyState(), { presented: presented.presentedKeys, executed: [], offered: presented.offered, refusedPending: false });
  assert.deepEqual(pendingSuggestion(state)?.acao, action);
  assert.ok(acceptsSuggestion("Sim, pode detalhar") && acceptsSuggestion("pode") && !acceptsSuggestion("sim, mas por cliente") && !acceptsSuggestion("Qual foi o faturamento?"));
  // New questions that start like an acceptance go to the router instead of running the pending suggestion.
  for (const accepted of ["sim", "pode detalhar", "quero ver", "pode ser", "vamos ver", "detalha por favor"]) assert.ok(acceptsSuggestion(accepted), accepted);
  for (const question of ["mostra as vendas de ontem", "quero ver o faturamento de agosto", "pode comparar com julho", "quero ver por cliente", "mostra o ranking de produtos", "pode me dizer o dólar de hoje"]) assert.ok(!acceptsSuggestion(question), question);
  assert.ok(refusesSuggestion("Não, obrigado") && !refusesSuggestion("não sei, qual foi o faturamento de agosto?"));
  const done = advanceState(state, { presented: [], executed: [action], offered: null, refusedPending: false });
  assert.equal(done.sugestoes[0]!.status, "feita");
  const refused = advanceState(state, { presented: [], executed: [], offered: null, refusedPending: true });
  assert.equal(refused.sugestoes[0]!.status, "recusada");
  assert.equal(pendingSuggestion(refused), null);
  // Already offered: neither as a candidate nor as a model suggestion.
  const candidates = buildCandidates({ results: [toolResult(revenueResult({ previous: 800000 }))], facts: metricFacts(revenueResult({ previous: 800000 })), state: refused, level: 2, presentation: "normal" });
  assert.ok(!candidates.some(c => c.acao && c.acao.params.agrupar === "produto"));
  const again = await presentResults({ question: "E agora?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ start: "2026-08-01", end: "2026-08-31", previous: 800000 }))], state: refused, composer: offered.composer });
  assert.equal(again.offered, null);
  assert.equal(again.composition, "rejeitada", "a question without a valid suggestion is not imposed");
  // Cumulative state is reconstructed from the latest log only.
  assert.deepEqual(stateFrom([{ parameters: { _state: state } }, { parameters: {} }]).sugestoes, state.sugestoes);
  assert.equal(stateFrom([{ parameters: { _state: state } }, { parameters: { _state: refused } }]).sugestoes[0]!.status, "recusada");
});
test("suggestions are free within the capabilities; invalid tools or parameters are discarded", async () => {
  assert.equal(validateAction({ tool: "faturamento", params: { periodo: "custom", meses: null, data_inicio: "2026-07-01", data_fim: "2026-07-31" } }), true);
  assert.equal(validateAction({ tool: "contas_a_receber_vencidas", params: { data_referencia: "hoje" } }), true);
  assert.equal(validateAction({ tool: "consultar_vendas", params: { periodo: "custom", meses: null, data_inicio: "2026-07-01", data_fim: "2026-07-31", agrupar: "vendedor", filtro_tipo: null, filtro_nome: null, limite: 5 } }), true);
  assert.equal(validateAction({ tool: "consultar_vendas", params: { periodo: "custom", agrupar: "lucro" } }), false);
  assert.equal(validateAction({ tool: "faturamento", params: { periodo: "custom", meses: null, data_inicio: null, data_fim: null } }), false);
  const invented = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}, {{comparacao.variacao}} {{comparacao.direcao}} de {{comparacao.periodo}}.", { sugestao: { tool: "lucro", params: "{}" } });
  const presented = await presentResults({ question: "Como foi?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: invented.composer });
  assert.equal(presented.offered, null); assert.equal(presented.composition, "executada");
});
test("'Qual foi o lucro?': capabilities never list profit and the unavailable list is in the instructions", () => {
  assert.doesNotMatch(emptyState().capacidades.join(" "), /lucro/);
  assert.match(compositionInstructions(2, "normal"), /lucro, custos, margem, estoque, saldo bancário/);
});
test("a sufficient answer without a useful next step ends naturally", async () => {
  const box = composerOf("Em {{periodo}}, o faturamento líquido foi {{total}}, {{comparacao.variacao}} {{comparacao.direcao}} de {{comparacao.periodo}}.", { encerrar: true });
  const presented = await presentResults({ question: "Como foi setembro?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: box.composer });
  assert.doesNotMatch(presented.display, /\?/);
  assert.equal(presented.offered, null);
});
test("relevance thresholds and novelty: receivables candidates, text pattern detection", () => {
  const result = receivablesResult();
  const candidates = buildCandidates({ results: [toolResult(result)], facts: metricFacts(result), state: emptyState(), level: 1, presentation: "normal" });
  assert.deepEqual(candidates.map(c => c.id).sort(), ["atraso_longo", "maior_devedor"]);
  assert.equal(buildCandidates({ results: [toolResult(result)], facts: metricFacts(result), state: emptyState(), level: 1, presentation: "conciso" }).length, 0);
  assert.equal(detectPresentation("Só me diga o total"), "conciso");
  assert.equal(detectPresentation("Compare setembro com agosto"), "comparar");
  assert.equal(detectPresentation("Qual foi o faturamento de setembro?"), null);
});
test("composition failure or timeout falls back to deterministic text without a second call", async () => {
  let calls = 0;
  const failing: Composer = async () => { calls++; throw new Error("TimeoutError"); };
  const presented = await presentResults({ question: "Como foi?", level: 2, presentation: "normal", results: [toolResult(revenueResult({ previous: 800000 }))], state: emptyState(), composer: failing });
  assert.equal(calls, 1);
  assert.equal(presented.composition, "falhou");
  assert.equal(presented.display, "Em setembro de 2026, o faturamento líquido foi R$ 630.359,91.");
});
