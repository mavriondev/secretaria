/**
 * Web Push with VAPID. Keys live only in the environment (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT); when they
 * are absent push is simply unavailable and the in-app inbox remains the guarantee. The payload carries the favourite's
 * title and the observed value, nothing else: details only inside the authenticated app.
 */
import webpush from "web-push";
import type { PushResult } from "./avisos";

type Config = { publicKey: string; privateKey: string; subject: string };
let configured: Config | null | undefined;
function config(): Config | null {
  if (configured !== undefined) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "", privateKey = process.env.VAPID_PRIVATE_KEY ?? "", subject = process.env.VAPID_SUBJECT ?? "";
  if (!publicKey || !privateKey || !subject) return (configured = null);
  try { webpush.setVapidDetails(subject, publicKey, privateKey); configured = { publicKey, privateKey, subject }; }
  catch { configured = null; }
  return configured;
}
export const _reconfigurarPush = () => { configured = undefined; };

export const pushDisponivel = (): { disponivel: boolean; chavePublica: string | null } => {
  const c = config();
  return { disponivel: c !== null, chavePublica: c?.publicKey ?? null };
};

export async function enviarPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: { title: string; body: string; url: string }): Promise<PushResult> {
  if (!config()) return { ok: false, error: "push-indisponivel" };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
    return { ok: true };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped the subscription; it must be forgotten.
    return { ok: false, gone: status === 404 || status === 410, error: `http-${status ?? "erro"}` };
  }
}
