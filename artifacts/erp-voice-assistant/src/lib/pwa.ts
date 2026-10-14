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

/**
 * Registers the service worker in production builds. A new version waits until the next opening of the app: at start-up, a waiting worker
 * is activated and the page reloads once, so a person in the middle of a conversation is never interrupted.
 */
export function registerServiceWorker(base: string) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const activateWaiting = (reg: ServiceWorkerRegistration) => {
    if (!reg.waiting) return;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; window.location.reload(); } });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  const openedAt = Date.now();
  navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` })
    .then(reg => {
      activateWaiting(reg);
      // A version found right after opening (before the person did anything) is applied now, with one reload,
      // instead of waiting for the next opening. Later finds wait, so a conversation is never interrupted.
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        fresh?.addEventListener('statechange', () => {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller && Date.now() - openedAt < 15_000) activateWaiting(reg);
        });
      });
    })
    .catch(() => undefined);
}
