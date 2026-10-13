import assert from "node:assert/strict";
import { test } from "node:test";
import { versaoInstalada } from "../lib/versao";

test("the installed version is the commit the update routine recorded, or says it is development", () => {
  const antes = process.env.TATO_VERSAO;
  try {
    delete process.env.TATO_VERSAO;
    assert.match(versaoInstalada(), /^(desenvolvimento|[a-f0-9]{7,40})$/);
    process.env.TATO_VERSAO = "a".repeat(40);
    assert.equal(versaoInstalada(), "a".repeat(40));
  } finally { if (antes === undefined) delete process.env.TATO_VERSAO; else process.env.TATO_VERSAO = antes; }
});
