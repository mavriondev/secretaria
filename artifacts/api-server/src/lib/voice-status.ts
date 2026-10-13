import { elevenRequest, ElevenLabsError } from "./elevenlabs";

const CACHE_MS = 30_000;
type Status = "reachable" | "configuration" | "authorization" | "permissions" | "quota" | "unavailable";
type Snapshot = { status: Status; checkedAt: string; expiresAt: string };

/** Cache sanitized results (including failures), never credentials or provider data. */
export function createVoiceStatusCheck(request = elevenRequest, now = Date.now) {
  let cached: Snapshot | undefined;
  let pending: Promise<Snapshot> | undefined;
  return async (): Promise<Snapshot> => {
    if (cached && now() < Date.parse(cached.expiresAt)) return cached;
    if (pending) return pending;
    pending = (async () => {
      let status: Status = "reachable";
      try {
        // Listing voices only checks read access. Do not issue Scribe tokens,
        // synthesize speech, or inspect subscription/balance to diagnose voice.
        const response = await request("/v1/voices", { method: "GET", signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
      } catch (error) {
        status = error instanceof ElevenLabsError ? error.code : "unavailable";
      }
      const checked = now();
      cached = { status, checkedAt: new Date(checked).toISOString(), expiresAt: new Date(checked + CACHE_MS).toISOString() };
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

export const getVoiceStatus = createVoiceStatusCheck();
