import { test } from "node:test";
import assert from "node:assert/strict";
import { previousPeriod, resolvePeriod, monthlySeries, range } from "../lib/periods";
import { exportPreviousRequested } from "../lib/documents";
import { withThinkingSpeech } from "../lib/thinking-speech";

test("calendar comparisons align complete months, month-to-date and year-to-date", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  assert.deepEqual(previousPeriod(resolvePeriod({ preset: "completed_months", months: 3 }, now)), range("2026-04-01", "2026-06-30"));
  assert.deepEqual(previousPeriod(resolvePeriod({ preset: "this_month" }, now)), range("2026-09-01", "2026-09-09"));
  assert.deepEqual(previousPeriod(resolvePeriod({ preset: "year_to_date" }, now)), range("2025-01-01", "2025-10-09"));
  assert.deepEqual(previousPeriod(range("2024-02-01", "2024-02-29")), range("2024-01-01", "2024-01-31"));
  assert.deepEqual(previousPeriod(resolvePeriod({ preset: "year_to_date" }, new Date("2026-10-31T15:00:00Z"))), range("2025-01-01", "2025-10-31"));
});
test("monthly series fills absent calendar months", () => {
  assert.deepEqual(monthlySeries(range("2026-07-01", "2026-09-30"), [{month:"2026-07",amount:900},{month:"2026-09",amount:1500}]).map(r=>r.amount), [900,0,1500]);
});
test("an explicit new period cannot export a stale previous result", () => {
  assert.equal(exportPreviousRequested("Exporte essa consulta"), true);
  assert.equal(exportPreviousRequested("Exporte o faturamento dessa semana"), false);
  assert.equal(exportPreviousRequested("Exporte essa consulta para agosto"), false);
});
test("fast queries do not generate a delayed acknowledgement", async () => {
  let called = false;
  const answer = await withThinkingSpeech({ preferredName:"",voiceGender:"female",thinkingSpeech:true }, new AbortController().signal, async()=>{}, async()=>42, async()=>{called=true;}, 50);
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(answer,42); assert.equal(called,false);
});

