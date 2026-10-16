import { test } from "node:test";
import assert from "node:assert/strict";
import { clarificationSpeech, spokenAnswer } from "../lib/spoken-answer";
import { emptyState, advanceState } from "../lib/conversation-state";
import { registrarPergunta } from "../lib/esclarecimento";
import { LiveTurns } from "../lib/live-turns";
import type { AssistantResponse } from "@workspace/api-zod";

const response = (campo: "entidade" | "periodo" | "metrica") => {
  const state = emptyState();
  const next = advanceState(state, { presented: [], executed: [], offered: null, refusedPending: false,
    perguntaAberta: "Qual cliente: Comercial Litoral 32 ou Comercial Litoral 40?",
    esclarecimento: registrarPergunta(state, "Vendas da Litoral", "Qual cliente?", campo) });
  return { responseKind: "clarification", ajustes: [{ rotulo: "Comercial Litoral 32", pergunta: "Comercial Litoral 32" }],
    answer: "Qual cliente: Comercial Litoral 32 ou Comercial Litoral 40?", parameters: { _state: next } } as AssistantResponse;
};
test("clarification speech is code-built, short and never reads numbers or option names", () => {
  for (const field of ["entidade", "periodo", "metrica"] as const) {
    const r = response(field), speech = spokenAnswer(r);
    assert.ok(speech.split(/\s+/).length <= 12);
    assert.doesNotMatch(speech, /\d|Litoral|Comercial/);
    assert.match(speech, /Escolha na tela ou fale/);
    assert.match(r.answer, /Litoral 32/);
  }
});
test("second clarification shortens the invitation; normal answers and hypotheses stay unchanged", () => {
  const r = response("periodo");
  (r.parameters._state as { esclarecimento: { rodadas: number } }).esclarecimento.rodadas = 2;
  assert.match(spokenAnswer(r), /Escolha na tela\.$/);
  r.responseKind = "erp"; r.answer = "O faturamento foi R$ 173.107,22.";
  assert.equal(clarificationSpeech(r), null);
  assert.equal(spokenAnswer(r), r.answer);
});
test("a text choice cancels ongoing speech but retains the same clarification context", () => {
  const turns = new LiveTurns();
  turns.begin("spoken-question", 1);
  const r = response("entidade");
  turns.remember("spoken-question", { logId: 1, question: "Vendas da Litoral", answer: r.answer, functionName: null, parameters: r.parameters });
  const previous = turns.current!;
  turns.begin("tapped-choice", 1);
  assert.equal(previous.controller.signal.aborted, true);
  assert.equal(turns.context.length, 1);
  assert.deepEqual(turns.context[0]!.parameters, r.parameters);
  assert.equal(turns.isCurrent("spoken-question"), false);
});
