import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { getPainelPublicData } from '@workspace/api-client-react';
import { TvPainel } from '@/components/painel/tv-painel';
import { ESTADO_INICIAL, minutosDesatualizado, PainelPoller, type TvEstado } from '@/lib/painel-controller';

/**
 * The page left open on the TV. Public: no session, no menus. The secret code lives only in the address and in memory;
 * it is sent in the Authorization header, never in the API URL, never stored, logged or used as a query key.
 */
function useMeta(nome: string, conteudo: string) {
  useEffect(() => {
    const m = document.createElement('meta'); m.name = nome; m.content = conteudo; document.head.appendChild(m);
    return () => { m.remove(); };
  }, [nome, conteudo]);
}

/** An older worker may have stored a /painel/ URL: remove only those entries, keep every other cache, never log. */
function limparCachesDoPainel() {
  useEffect(() => {
    if (typeof caches === 'undefined') return;
    void (async () => {
      try {
        for (const nome of await caches.keys()) {
          const cache = await caches.open(nome);
          for (const req of await cache.keys()) if (new URL(req.url).pathname.includes('/painel/')) await cache.delete(req);
        }
      } catch { /* cache API unavailable: nothing to clean */ }
    })();
  }, []);
}

function useTelaCheiaECursor() {
  const [cheia, setCheia] = useState(false);
  const [cursor, setCursor] = useState(true);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const mostrar = () => { setCursor(true); if (t) clearTimeout(t); t = setTimeout(() => setCursor(false), 3000); };
    const fs = () => setCheia(!!document.fullscreenElement);
    mostrar();
    window.addEventListener('mousemove', mostrar); window.addEventListener('keydown', mostrar); document.addEventListener('fullscreenchange', fs);
    return () => { if (t) clearTimeout(t); window.removeEventListener('mousemove', mostrar); window.removeEventListener('keydown', mostrar); document.removeEventListener('fullscreenchange', fs); };
  }, []);
  const alternar = useCallback(() => {
    try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); } catch { /* unsupported: stay as is */ }
  }, []);
  return { cheia, cursor, alternar };
}

/** Keeps the screen awake when the browser allows it; silent otherwise. */
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    let lock: Sentinel | null = null; let ativo = true;
    const pedir = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const l = await nav.wakeLock.request('screen');
        if (!ativo) { void l.release().catch(() => {}); return; }
        lock = l;
      } catch { /* denied or unsupported: degrade silently */ }
    };
    const vis = () => { if (document.visibilityState === 'visible') void pedir(); };
    void pedir(); document.addEventListener('visibilitychange', vis);
    return () => { ativo = false; document.removeEventListener('visibilitychange', vis); void lock?.release().catch(() => {}); };
  }, []);
}

export default function PainelPublico({ apelido, codigo }: { apelido: string; codigo: string }) {
  useMeta('robots', 'noindex, nofollow');
  useMeta('referrer', 'no-referrer');
  useWakeLock();
  limparCachesDoPainel();
  const { cheia, cursor, alternar } = useTelaCheiaECursor();
  const [estado, setEstado] = useState<TvEstado>(ESTADO_INICIAL);
  const [agora, setAgora] = useState(() => Date.now());
  const pollerRef = useRef<PainelPoller | null>(null);

  useEffect(() => {
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const tick = setInterval(() => setAgora(Date.now()), 15_000);
    return () => { clearInterval(tick); document.documentElement.style.overflow = prevOverflow; };
  }, []);

  // New address or code: the old poller is aborted and its payload forgotten before the new one starts.
  useEffect(() => {
    setEstado(ESTADO_INICIAL);
    const poller = new PainelPoller({
      buscar: sinal => getPainelPublicData(apelido, { headers: { Authorization: 'Painel ' + codigo }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: sinal }),
      agora: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      aoMudar: setEstado,
    });
    pollerRef.current = poller; poller.start();
    const vis = () => { if (document.visibilityState === 'visible') poller.atualizarAgora(); };
    const online = () => poller.atualizarAgora();
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', online);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', online); poller.stop(true); pollerRef.current = null; };
  }, [apelido, codigo]);

  const atraso = useMemo(() => minutosDesatualizado(agora, estado.ultimoSucessoEm, estado.painel?.atualizacaoSegundos ?? 300), [agora, estado.ultimoSucessoEm, estado.painel?.atualizacaoSegundos]);

  return (
    <main className={'fixed inset-0 bg-background text-foreground ' + (cursor ? '' : 'cursor-none')} data-testid="painel-publico">
      {estado.fase === 'desativado' ? (
        <div className="h-full grid place-items-center p-8 text-center" role="alert" data-testid="painel-desativado">
          <div><span className="inline-block h-3 w-3 rounded-full bg-muted-foreground mb-5" aria-hidden /><h1 className="display text-4xl mb-2">Este painel foi desativado</h1><p className="text-muted-foreground text-lg">Peça um novo link a quem administra o Tato na empresa.</p></div>
        </div>
      ) : !estado.painel ? (
        <div className="h-full p-6 grid grid-cols-3 grid-rows-2 gap-4" aria-busy="true" aria-label="Carregando painel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel rounded-xl" />)}</div>
      ) : (
        <TvPainel key={estado.ciclo} painel={estado.painel} agora={agora} atualizadoEmMs={estado.ultimoSucessoEm} desatualizadoMin={atraso}
          acoes={<button type="button" onClick={alternar} aria-label={cheia ? 'Sair da tela cheia' : 'Tela cheia'} title={cheia ? 'Sair da tela cheia' : 'Tela cheia'} data-testid="tv-tela-cheia" className="h-7 w-7 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground">{cheia ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>} />
      )}
    </main>
  );
}
