import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; listeners.forEach(l => l()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach(l => l()); });
}

export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as { MSStream?: unknown }).MSStream;
/** Touch-first screens default to staying signed in; a shared desktop browser does not. */
export const isMobileLike = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Install state for the discreet "Instalar app" control: native prompt when the browser offers one, a two-line hint on iPhone. */
export function useInstallPrompt() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick(n => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const install = async () => { const ev = deferred; if (!ev) return; await ev.prompt(); await ev.userChoice.catch(() => undefined); deferred = null; tick(n => n + 1); };
  return { canPrompt: !!deferred && !isStandalone(), ios: isIos() && !isStandalone(), standalone: isStandalone(), install };
}

/** A new version of the app waiting to take over (service worker installed but not yet controlling the page). */
let esperando: ServiceWorkerRegistration | null = null;
const ouvintesDeVersao = new Set<() => void>();
const avisarVersao = () => ouvintesDeVersao.forEach(l => l());
let recarregou = false;
const recarregarUmaVez = () => { if (!recarregou) { recarregou = true; window.location.reload(); } };

/** Applies the waiting version with one reload. Called only from a person's tap (the refresh icon with the dot). */
export function aplicarAtualizacao() {
  const reg = esperando;
  if (!reg?.waiting) { window.location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', recarregarUmaVez);
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  // A worker that never takes control (e.g. another tab holds the old one) must not leave the app stuck.
  setTimeout(recarregarUmaVez, 4000);
}

/** React view of the waiting version: the refresh icon shows a dot and the tap applies it instead of refetching. */
export function useAtualizacaoDoApp() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick(n => n + 1); ouvintesDeVersao.add(l); return () => { ouvintesDeVersao.delete(l); }; }, []);
  return { disponivel: !!esperando?.waiting, aplicar: aplicarAtualizacao };
}

/**
 * Registers the service worker in production builds. A version found right after opening is applied at once (one reload,
 * before the person did anything); a version found later waits for the person to tap the refresh icon, so a conversation
 * is never interrupted, and is applied on the next opening at the latest.
 */
export function registerServiceWorker(base: string) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const activateWaiting = (reg: ServiceWorkerRegistration) => {
    if (!reg.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', recarregarUmaVez);
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  const openedAt = Date.now();
  navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` })
    .then(reg => {
      activateWaiting(reg);
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        fresh?.addEventListener('statechange', () => {
          if (fresh.state !== 'installed' || !navigator.serviceWorker.controller) return;
          if (Date.now() - openedAt < 15_000) activateWaiting(reg);
          else { esperando = reg; avisarVersao(); }
        });
      });
      // Looks for a new version when the app comes back to the foreground (installed apps rarely get a fresh load).
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => undefined); });
    })
    .catch(() => undefined);
}
