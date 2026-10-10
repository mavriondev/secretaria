import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod } from "../lib/periods";
import { publicTopic, safePublicUrl } from "../lib/public-research";
test("relative months are explicit, bounded and calendar-safe", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  assert.equal(resolvePeriod({preset:"completed_months",months:3}, now).startDate,"2026-07-01");
  assert.equal(resolvePeriod({preset:"completed_months",months:3}, now).endDate,"2026-09-30");
  assert.equal(resolvePeriod({preset:"including_current_month",months:3}, now).startDate,"2026-08-01");
  assert.equal(resolvePeriod({preset:"rolling_months",months:3}, now).startDate,"2026-07-09");
  assert.equal(resolvePeriod({preset:"rolling_months",months:1},new Date("2024-03-31T15:00:00Z")).startDate,"2024-02-29");
  assert.equal(resolvePeriod({preset:"completed_months",months:3},new Date("2026-01-09T15:00:00Z")).startDate,"2025-10-01");
  assert.throws(()=>resolvePeriod({preset:"completed_months",months:0}));
});
test("public research blocks obvious private identifiers and unsafe links", () => {
  assert.equal(publicTopic("cotação dólar"),"cotação dólar");
  assert.throws(()=>publicTopic("CPF 12345678900"));
  assert.throws(()=>publicTopic("cliente maria@example.com"));
  assert.equal(safePublicUrl("http://127.0.0.1"),false);
  assert.equal(safePublicUrl("https://192.168.1.3"),false);
  assert.equal(safePublicUrl("https://www.bcb.gov.br"),true);
});
