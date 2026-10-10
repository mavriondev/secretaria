import type OpenAI from "openai";
import { factPrefix, metricFacts, requestedComparisonFacts, type Fact } from "./facts";
import { buildCandidates, type Presentation, type ToolResult } from "./relevance";
import { deterministicHeadline, deterministicLists } from "./deterministic";
import { composeAnswer, parseSuggestion, type CompositionInput } from "./compose";
import { alreadyOffered, type ConversationState, type SuggestedAction } from "./conversation-state";
import { validateAction } from "./tool-contracts";
import { safeValidate } from "./validate-text";

export type CompositionStatus = "nao-necessaria" | "executada" | "rejeitada" | "falhou";
export type Presented = {
  display: string; spoken: string;
  presentedKeys: string[];
  offered: SuggestedAction | null;
  candidates: number;
  composition: CompositionStatus;
  fallbackReason?: string;
  /** Model text discarded by the validator, kept in the log for audit; never shown or spoken. */
  discarded?: string;
  compositionMs: number; validationMs: number;
  usage: { input: number; output: number };
  facts: Fact[];
};
export type Composer = (input: CompositionInput, signal?: AbortSignal) => ReturnType<typeof composeAnswer>;
export const openaiComposer = (client: OpenAI, model: string): Composer => (input, signal) => composeAnswer(client, model, input, signal);

/** Facts → relevance filter → at most one composition call → validator → deterministic fallback. */
export async function presentResults(input: {
  question: string; level: 0 | 1 | 2; presentation: Presentation; results: ToolResult[]; state: ConversationState;
  composer: Composer | null; signal?: AbortSignal;
  /** Manager knowledge as labelled data: tone/vocabulary context for the composition and known words for the validator; never numbers. */
  knowledge?: { text: string; facts: Fact[] };
}): Promise<Presented> {
  const multiple = input.results.length > 1;
  const results = input.results.map(r => ({ ...r, prefix: multiple ? factPrefix(r.result) : "" }));
  const facts = results.flatMap(r => metricFacts(r.result, r.prefix));
  const revenue = results.filter(r => r.result.metric === "faturamento" && !r.result.rawResult.groups);
  const requested = input.presentation === "comparar" && revenue.length === 2 ? requestedComparisonFacts(revenue[0]!, revenue[1]!) : [];
  const allFacts = [...facts, ...requested];
  const headline = deterministicHeadline(results, facts, input.presentation, requested);
  const lists = deterministicLists(results, facts, input.presentation);
  const keysOf = (ids: string[]) => ids.map(id => allFacts.find(f => f.id === id)?.key).filter((k): k is string => !!k);
  const base: Presented = {
    display: [headline.display, lists.display].filter(Boolean).join("\n\n"),
    spoken: [headline.spoken, lists.spoken].filter(Boolean).join(" "),
    presentedKeys: [...new Set(keysOf([...headline.usedIds, ...lists.usedIds]))],
    offered: null, candidates: 0, composition: "nao-necessaria", compositionMs: 0, validationMs: 0, usage: { input: 0, output: 0 }, facts: allFacts,
  };
  const candidates = buildCandidates({ results, facts: allFacts, state: input.state, level: input.level, presentation: input.presentation });
  base.candidates = candidates.length;
  const complete = input.presentation === "completo";
  // Explicit "completo" always composes (the user asked for prose and questions); otherwise only when there is something to decide.
  if (input.presentation === "conciso" || !input.composer || (!complete && (!candidates.length || input.level === 0))) return base;

  const started = Date.now();
  let raw: Awaited<ReturnType<typeof composeAnswer>>;
  try {
    raw = await input.composer({
      question: input.question, level: input.level, presentation: input.presentation as "normal" | "comparar" | "completo", facts: allFacts, candidates, state: input.state,
      headlineTemplate: headlineTemplateOf(headline, allFacts), listedIds: lists.usedIds, knowledge: input.knowledge?.text ?? null,
    }, input.signal);
  } catch (error) {
    input.signal?.throwIfAborted();
    return { ...base, composition: "falhou", fallbackReason: error instanceof Error ? error.name : "erro", compositionMs: Date.now() - started };
  }
  const compositionMs = Date.now() - started;
  const usage = { input: raw.usage?.input_tokens ?? 0, output: raw.usage?.output_tokens ?? 0 };
  const validationStart = Date.now();
  const validated = safeValidate(raw.raw.texto, facts, input.question, [...requested, ...(input.knowledge?.facts ?? [])]);
  const reject = (reason: string): Presented => ({ ...base, composition: "rejeitada", fallbackReason: reason, discarded: raw.raw.texto, compositionMs, validationMs: Date.now() - validationStart, usage });
  if (!validated.ok) return reject(validated.reason);
  const suggestion = input.level === 2 || complete ? parseSuggestion(raw.raw.sugestao, action => validateAction(action) && !alreadyOffered(input.state, action)) : null;
  if (/\?\s*$/.test(validated.display) && !suggestion && !complete) return reject("pergunta de continuação sem sugestão válida");
  // The answer must stay anchored in the consultation, unless those facts were already presented earlier in the conversation (follow-up questions such as "foi bom?").
  const headlineKnown = keysOf(headline.usedIds).every(key => input.state.apresentado.includes(key));
  if (!validated.usedIds.some(id => headline.usedIds.includes(id)) && !headlineKnown) return reject("o texto não responde ao pedido com os fatos da consulta");
  if (validated.usedIds.filter(id => lists.usedIds.includes(id) && /\.(nome|faixa)$/.test(id)).length > 2) return reject("o texto repete a lista exibida pelo código");
  const citedCandidates = candidates.filter(c => c.kind === "comentario" && c.factIds.some(id => validated.usedIds.includes(id)));
  return {
    ...base,
    display: [validated.display, lists.display].filter(Boolean).join("\n\n"),
    spoken: [validated.spoken, lists.spoken].filter(Boolean).join(" "),
    presentedKeys: [...new Set(keysOf([...validated.usedIds, ...lists.usedIds, ...citedCandidates.flatMap(c => c.factIds)]))],
    offered: suggestion, composition: "executada", compositionMs, validationMs: Date.now() - validationStart, usage,
  };
}
/** Rebuilds the marker template of the deterministic headline for the model to reuse. */
function headlineTemplateOf(headline: { display: string; usedIds: string[] }, facts: Fact[]): string {
  let template = headline.display;
  for (const id of [...headline.usedIds].sort((a, b) => (facts.find(f => f.id === b)?.display.length ?? 0) - (facts.find(f => f.id === a)?.display.length ?? 0))) {
    const fact = facts.find(f => f.id === id);
    if (fact) template = template.split(fact.display).join(`{{${id}}}`);
  }
  return template;
}
