import { Responses } from "openai/resources/responses/responses";
import { answerQuestion } from "../lib/assistant";
import { pool } from "@workspace/db";

/**
 * Development-only probe: how much of each OpenAI call is served from the prompt cache today, and how long each call takes.
 * Wraps the SDK's Responses.create to read usage.input_tokens_details.cached_tokens; asks a few questions twice in a row.
 *   tsx src/scripts/medir-cache.ts
 */
const original = Responses.prototype.create;
const chamadas: Array<{ pergunta: string; rodada: number; ms: number; input: number; cached: number; output: number; model: string }> = [];
let atual = { pergunta: "", rodada: 0 };
(Responses.prototype as any).create = function (body: any, options: any) {
  const inicio = Date.now();
  // Experiment overrides (development only): MEDIR_EFFORT=minimal|low|medium, MEDIR_TIER=priority|default
  if (process.env.MEDIR_EFFORT && body.reasoning) body = { ...body, reasoning: { ...body.reasoning, effort: process.env.MEDIR_EFFORT } };
  if (process.env.MEDIR_TIER) body = { ...body, service_tier: process.env.MEDIR_TIER };
  const promise = original.call(this, body, options) as any;
  return promise.then((response: any) => {
    chamadas.push({ ...atual, ms: Date.now() - inicio, input: response.usage?.input_tokens ?? 0, cached: response.usage?.input_tokens_details?.cached_tokens ?? 0, output: response.usage?.output_tokens ?? 0, model: `${body.model}/${body.reasoning?.effort ?? "-"}/${response.service_tier ?? body.service_tier ?? "default"}` });
    return response;
  });
};
const perguntas = ["Qual foi o faturamento deste mês?", "Quantos clientes diferentes compraram em setembro de 2026?", "Bom dia, tudo bem?"];
async function main() {
  for (const rodada of (process.env.MEDIR_RODADAS ? [1] : [1, 2])) {
    for (const pergunta of perguntas) {
      atual = { pergunta, rodada };
      const r = await answerQuestion({ question: pergunta, freedomLevel: 1, includeVoice: false }, null, Date.now(), { signal: AbortSignal.timeout(60_000) });
      console.log(`rodada ${rodada} | ${pergunta} | ${r.latencyMs} ms | ${r.responseKind}`);
    }
  }
  for (const c of chamadas) console.log(`  r${c.rodada} ${c.pergunta.slice(0, 28).padEnd(28)} ${c.model} ${String(c.ms).padStart(5)} ms  input ${c.input} (cache ${c.cached}) output ${c.output}`);
  await pool.end();
}
main().catch(error => { console.error(error instanceof Error ? error.message : "erro"); process.exit(1); });
