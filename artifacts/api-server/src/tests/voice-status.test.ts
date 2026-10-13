import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createVoiceStatusCheck } from "../lib/voice-status";
import { elevenRequest, ElevenLabsError } from "../lib/elevenlabs";
import { voiceStatusRoutes } from "../routes/voice-status";
import { authorize } from "../lib/access";
import type { SessionUser } from "../lib/auth";

test("read-only check discards provider data and coalesces calls, caches for 30 seconds", async () => {
  let calls = 0, cancelled = 0, time = 1000;
  const check = createVoiceStatusCheck(async (path, init) => {
    calls++;
    assert.equal(path, "/v1/voices");
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.ok(init?.signal);
    await new Promise(resolve => setImmediate(resolve));
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"private":"balance-and-key"}')); },
      cancel() { cancelled++; },
    }));
  }, () => time);
  const results = await Promise.all(Array.from({ length: 12 }, () => check()));
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
  assert.deepEqual(results[0], { status: "reachable", checkedAt: new Date(1000).toISOString(), expiresAt: new Date(31000).toISOString() });
  assert.ok(results.every(r => JSON.stringify(r) === JSON.stringify(results[0])));
  time = 30999; await check(); assert.equal(calls, 1);
  time = 31000; await check(); assert.equal(calls, 2);
  assert.ok(!JSON.stringify(results).includes("balance-and-key"));
});

test("safe classifications are reused and failures are cached without token issuance", async () => {
  for (const code of ["configuration", "authorization", "permissions", "quota", "unavailable"] as const) {
    let calls = 0;
    const check = createVoiceStatusCheck(async () => {
      calls++; throw new ElevenLabsError(code);
    });
    assert.equal((await check()).status, code);
    assert.equal((await check()).status, code);
    assert.equal(calls, 1);
  }
  const check = createVoiceStatusCheck(async () => { throw new Error("secret provider body"); });
  const result = await check();
  assert.equal(result.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("read-only probe classifies actual transport metadata safely", async () => {
  for (const [status, provider, expected] of [
    [400, "invalid_api_key", "authorization"],
    [401, "missing_permissions", "permissions"],
    [403, "", "permissions"],
    [429, "", "quota"],
    [503, "", "unavailable"],
  ] as const) {
    const check = createVoiceStatusCheck((path, init) => elevenRequest(path, init, {
      env: { ELEVENLABS_API_KEY: "fake-key" },
      connector: () => { throw new Error("No fallback"); },
      direct: async () => new Response(JSON.stringify({ detail: { status: provider, message: "private" } }), { status }),
    }));
    const result = await check();
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes("private"));
  }
  const missing = createVoiceStatusCheck((path, init) => elevenRequest(path, init, {
    env: {}, connector: () => { throw new Error("No call"); }, direct: async () => { throw new Error("No call"); },
  }));
  assert.equal((await missing()).status, "configuration");
});

const user: SessionUser = { id: 1, name: "test", email: "test@example.test", role: "administrador",
  companyId: 1, companyName: "test", dataReady: false, mustChangePassword: false };

test("authorization allows admin before ERP setup, but denies manager, owner and temporary password", () => {
  const path = "/settings/voice-status";
  assert.ok(authorize(user, "GET", path).ok);
  for (const patch of [{ role: "gestor" }, { role: "dono", companyId: null }, { mustChangePassword: true }] as const) {
    assert.ok(!authorize({ ...user, ...patch }, "GET", path).ok);
  }
});

test("route defense never returns a diagnostic to unauthorized sessions", async () => {
  const app = Fastify();
  let session: SessionUser | null = null;
  app.decorateRequest("user", null);
  app.addHook("onRequest", async req => { req.user = session; });
  await app.register(voiceStatusRoutes, { prefix: "/api" });
  try {
    for (const [current, status] of [
      [null, 401], [{ ...user, role: "gestor" }, 403],
      [{ ...user, role: "dono" }, 403], [{ ...user, mustChangePassword: true }, 403],
    ] as const) {
      session = current;
      const res = await app.inject({ method: "GET", url: "/api/settings/voice-status" });
      assert.equal(res.statusCode, status);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.deepEqual(Object.keys(res.json()), ["error"]);
    }
  } finally { await app.close(); }
});

test("conversation availability warns managers without exposing administrative classifications", async () => {
  const app = Fastify();
  let session: SessionUser | null = { ...user, role: "gestor", dataReady: true };
  let calls = 0;
  const check = createVoiceStatusCheck(async () => {
    calls++; throw new ElevenLabsError("authorization");
  });
  app.decorateRequest("user", null);
  app.addHook("onRequest", async req => { req.user = session; });
  await app.register(voiceStatusRoutes, { prefix: "/api", check });
  try {
    const path = "/assistant/voice/availability";
    assert.ok(authorize(session!, "GET", path).ok);
    const first = await app.inject({ method: "GET", url: `/api${path}` });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["cache-control"], "no-store");
    assert.equal(first.json().reachable, false);
    assert.deepEqual(Object.keys(first.json()).sort(), ["checkedAt", "expiresAt", "reachable"]);
    assert.ok(!first.body.includes("authorization"));
    assert.equal((await app.inject({ method: "GET", url: "/api/settings/voice-status" })).statusCode, 403);
    session = user;
    const admin = await app.inject({ method: "GET", url: "/api/settings/voice-status" });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.json().status, "authorization");
    assert.equal(calls, 1, "public and administrative views share one cached probe");
    for (const current of [null, { ...user, role: "dono" } as SessionUser, { ...user, mustChangePassword: true }]) {
      session = current;
      const denied = await app.inject({ method: "GET", url: `/api${path}` });
      assert.equal(denied.statusCode, current === null ? 401 : 403);
      assert.deepEqual(Object.keys(denied.json()), ["error"]);
    }
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
