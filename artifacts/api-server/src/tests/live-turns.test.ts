import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveTurns } from "../lib/live-turns";

test("a newer voice turn aborts old work and rejects stale responses", () => {
  const turns = new LiveTurns();
  const old = turns.begin("first", 0);
  turns.begin("second", 2);
  assert.equal(old.controller.signal.aborted, true);
  assert.equal(turns.isCurrent("first"), false);
  assert.equal(turns.isCurrent("second"), true);
  turns.remember("first", { question: "stale", functionName: "faturamento", parameters: {} });
  assert.equal(turns.context.length, 0);
});
test("context is bounded, contains only trusted consultation metadata and expires", () => {
  const turns = new LiveTurns();
  for (let i = 0; i < 8; i++) {
    const id = `turn-${i}`;
    turns.begin(id, 1);
    turns.remember(id, { question: `${i}`, functionName: "faturamento", parameters: { periodo: "today" } });
  }
  assert.deepEqual(turns.context.map(c => c.question), ["4", "5", "6", "7"]);
  const active = turns.current!;
  turns.clear();
  assert.equal(active.controller.signal.aborted, true);
  assert.equal(turns.context.length, 0);
  assert.equal(turns.current, null);
});
test("turn IDs cannot be reused and canceled work cannot update context", () => {
  const turns = new LiveTurns();
  turns.begin("id", 1); turns.cancel();
  assert.throws(() => turns.begin("id", 0));
  turns.remember("id", { question: "discarded", functionName: null, parameters: {} });
  assert.equal(turns.context.length, 0);
});
