/** The only test that calls OpenAI for real: one tiny text call, confirming the processing tier the API reports. Gated by TESTES_PAGOS=1. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { testePago } from "./pagos";
import { aiConfig, openaiClient, serviceTier, textCallOptions, tierUsed } from "../lib/openai-direct";
import { TIERS_PRIORITARIOS } from "../lib/limite-custo";

test("the processing tier requested by OPENAI_SERVICE_TIER is reported back by the API (paid, one call)", testePago(), async () => {
  const response = await openaiClient().responses.create({ model: aiConfig.textModel, store: false, reasoning: { effort: "low" }, max_output_tokens: 40, ...textCallOptions(), input: "Responda apenas: ok" });
  const used = tierUsed(response);
  assert.ok(used, "the response carries service_tier");
  // The API may answer with another name for the same tier (today: "fast" when "priority" is requested); it is logged as returned and priced as priority.
  assert.equal(TIERS_PRIORITARIOS.has(used), serviceTier() === "priority", `tier devolvido: ${used}`);
});
