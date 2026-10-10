import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, selectedVoice, thinkingPhrase } from "../lib/preferences";
import { csvCell, exportPreviousRequested, exportRequested } from "../lib/documents";
import { withThinkingSpeech } from "../lib/thinking-speech";

const settings = { preferredName: "Ana", voiceGender: "male" as const, thinkingSpeech: true };
test("personal address remains plain text and both voice choices map to supported voices", () => {
  assert.equal(normalizeName("  Ana  Maria "), "Ana Maria");
  assert.equal(normalizeName("João d'Ávila"), "João d'Ávila");
  assert.throws(() => normalizeName("<script>"));
  assert.throws(() => normalizeName("123"));
  assert.equal(selectedVoice(settings), "cedar");
  assert.equal(selectedVoice({ ...settings, voiceGender: "female" }), "marin");
  assert.notEqual(thinkingPhrase(settings), thinkingPhrase(settings));
  assert.doesNotMatch(thinkingPhrase(settings), /\d|R\$/);
});
test("CSV neutralizes formulas, quotes and multiline user content", () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell("  @cmd"), '"\'  @cmd"');
  assert.equal(csvCell('a;"b"\n'), '"a;""b""\n"');
  assert.equal(csvCell(null), '""');
});
test("export requests recognize previous results without exporting negations", () => {
  assert.ok(exportPreviousRequested("Exporte essa consulta"));
  assert.ok(exportPreviousRequested("Gere um relatório"));
  assert.ok(exportRequested("Qual o faturamento hoje? Exporte em CSV."));
  assert.equal(exportPreviousRequested("Qual o faturamento hoje? Exporte em CSV."), false);
  assert.equal(exportRequested("Não exporte essa consulta"), false);
  assert.equal(exportRequested("Quanto faturei hoje?"), false);
});
test("thinking speech runs alongside the query, never invents figures and uses the selected voice", async () => {
  const events: string[] = [];
  const value = await withThinkingSpeech(settings, new AbortController().signal, async () => {}, async () => {
    events.push("query"); return "trusted answer";
  }, async (phrase, _signal, _chunk, voice) => {
    events.push("filler"); assert.equal(voice, "cedar"); assert.doesNotMatch(phrase, /\d/);
  });
  assert.equal(value, "trusted answer");
  assert.deepEqual(events, ["filler", "query"]);
});
test("filler failure and disabled filler do not suppress trusted answers", async () => {
  const signal = new AbortController().signal;
  assert.equal(await withThinkingSpeech(settings, signal, async () => {}, async () => 7, async () => { throw new Error("TTS unavailable"); }), 7);
  assert.equal(await withThinkingSpeech({ ...settings, thinkingSpeech: false }, signal, async () => {}, async () => 8,
    async () => { assert.fail("should not synthesize disabled filler"); }), 8);
});
test("interrupting a query aborts its acknowledgement and does not return stale answers", async () => {
  const controller = new AbortController();
  let fillerSignal: AbortSignal | null = null;
  const result = withThinkingSpeech(settings, controller.signal, async () => {}, async () => {
    controller.abort(); return "old";
  }, async (_text, signal) => {
    fillerSignal = signal;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  await assert.rejects(result);
  assert.ok(fillerSignal!.aborted);
});
