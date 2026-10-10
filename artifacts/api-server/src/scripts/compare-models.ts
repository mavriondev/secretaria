import { answerQuestion } from "../lib/assistant";
import { aiConfig } from "../lib/openai-direct";
import { pool } from "@workspace/db";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const results: Array<Record<string, unknown>> = [];
  for (const model of [...new Set([aiConfig.textModel, "gpt-6-astra"])]) {
    let reference: number | undefined;
    const cases = [
      { question: "Qual o faturamento nos últimos três meses?", check: (r: any) => r.metricResult?.period.startDate === "2026-07-01" && r.metricResult?.period.endDate === "2026-09-30" },
      { question: "E por vendedor?", check: (r: any) => r.metricResult?.rawResult.agrupamento === "vendedor" && r.metricResult?.period.startDate === "2026-07-01" },
      { question: "Quanto vendeu o cliente QA — Cliente Sazonal em julho, agosto e setembro de 2026, por mês?", check: (r: any) => r.metricResult?.value === 2400 && JSON.stringify(r.metricResult?.rawResult.groups?.map((g: any) => g.amount)) === "[900,0,1500]" },
      { question: "Qual foi o lucro líquido da empresa hoje?", check: (r: any) => r.metricResult == null && /lucro|cust|dispon|calcular/i.test(r.answer) },
      { question: "Quanto vendeu o cliente Horizonte nos últimos três meses?", check: (r: any) => r.responseKind === "clarification" && r.metricResult == null },
      { question: "Bom dia! Tudo bem?", check: (r: any) => r.responseKind === "general" && r.metricResult == null },
    ];
    for (const c of cases) {
      const start = Date.now();
      try {
        const r = await answerQuestion({ question: c.question, freedomLevel: 1, includeVoice: false, ...(reference ? { referenceLogId: reference } : {}) }, null, start, { textModel: model, signal: AbortSignal.timeout(45000) });
        results.push({ model, question: c.question, pass: Boolean(c.check(r)), elapsedMs: Date.now() - start, inputTokens: r.inputTokens, outputTokens: r.outputTokens, answer: r.answer, kind: r.responseKind });
        reference = r.id;
      } catch (e) {
        results.push({ model, question: c.question, pass: false, elapsedMs: Date.now() - start, error: e instanceof Error ? e.name : "Error" });
      }
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  const output = new URL("../../../../generated-artifacts/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL("model-comparison.json", output), JSON.stringify({ date: "2026-10-09", note: "Small text-only smoke comparison, not a statistical or voice benchmark. No model-specific pricing assumed.", results }, null, 2));
  await pool.end();
}
main().catch(e => { console.error(e instanceof Error ? e.name : "Error"); process.exitCode = 1; });
