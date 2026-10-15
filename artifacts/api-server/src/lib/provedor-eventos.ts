/** Transport-only observation. Never changes requests, responses, retries, assistant decisions or customer messages. */
import { pool } from "@workspace/db";
import { logger } from "./logger";
export type Provedor = "openai" | "elevenlabs";
export const LIMITE_ERROS = () => Math.max(2, Math.min(100, Number(process.env.PROVEDOR_ERROS_SEGUIDOS ?? 3) || 3));
export function erroDeCota(status: number, code?: string) {
  return status === 401 || status === 402 || (status === 429 && ["insufficient_quota", "quota_exceeded", "billing_hard_limit_reached", "quota"].includes(code ?? ""));
}
const queue: Record<Provedor, Promise<void>> = { openai: Promise.resolve(), elevenlabs: Promise.resolve() };
let classifications: Promise<void> = Promise.resolve();
const notifyMonitor = () => { void import("./saude-sistema").then(m => m.verificarSaude()).catch(() => undefined); };
export function registrarRespostaProvedor(provider: Provedor, status: number, code?: string, notify = notifyMonitor) {
  const failed = erroDeCota(status, code);
  const run = async () => {
    const previous = (await pool.query("SELECT consecutivos FROM provedores_estado WHERE provedor=$1", [provider])).rows[0]?.consecutivos ?? 0;
    const r = await pool.query(`INSERT INTO provedores_estado(provedor,consecutivos,ultimo_status,atualizado_em) VALUES($1,$2,$3,now())
      ON CONFLICT(provedor) DO UPDATE SET consecutivos=CASE WHEN $2=1 THEN provedores_estado.consecutivos+1 ELSE 0 END,
      ultimo_status=$3,atualizado_em=now() RETURNING consecutivos`, [provider, failed ? 1 : 0, status]);
    if (r.rows[0].consecutivos >= LIMITE_ERROS() || previous >= LIMITE_ERROS()) notify();
  };
  queue[provider] = queue[provider].then(run).catch(() => logger.warn({ provider }, "Não foi possível atualizar o estado do provedor"));
  return queue[provider];
}
export function observarFetch(original: typeof fetch = fetch, observe = registrarRespostaProvedor): typeof fetch {
  return async (input, init) => {
    const response = await original(input, init);
    // Metadata is observed asynchronously; the response body is not consumed or replaced.
    const clone = response.status === 429 ? response.clone() : null;
    classifications = classifications.then(async () => {
      let code: string | undefined;
      if (clone) {
        const reader = clone.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = []; let bytes = 0;
          const deadline = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 1000);
          try {
            while (true) {
              const r = await reader.read(); if (r.done) break;
              bytes += r.value.length; if (bytes > 16384) break; chunks.push(r.value);
            }
            if (bytes <= 16384) code = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error?.code;
          } catch { /* no raw message leaves transport */ }
          finally { clearTimeout(deadline); void reader.cancel().catch(() => undefined); }
        }
      }
      await observe("openai", response.status, code);
    }).catch(() => undefined);
    return response;
  };
}
