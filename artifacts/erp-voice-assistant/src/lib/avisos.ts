import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEstadoDoPushQueryKey, getListarNotificacoesQueryKey, useEstadoDoPush, useListarNotificacoes, useAssinarPush, useCancelarAssinaturaPush,
  type AvisoCondicao,
} from '@workspace/api-client-react';
import { appBasePath } from '@/lib/app-path';
import { api } from '@/lib/auth-client';

export const CONDICAO_LABEL: Record<AvisoCondicao, string> = { acima: 'Passar de', abaixo: 'Ficar abaixo de', variacao: 'Variar mais de', mudou: 'Mudar' };
export const CONDICAO_AJUDA: Record<AvisoCondicao, string> = {
  acima: 'Avisa quando o valor ultrapassar o número informado; volta a avisar só depois de cair e subir de novo.',
  abaixo: 'Avisa quando o valor ficar menor que o número informado.',
  variacao: 'Compara com a última carga de dados e avisa quando subir ou cair além do informado.',
  mudou: 'Avisa quando o resultado for diferente do anterior (um estado novo, uma linha nova).',
};

/** How often the inbox counter is refreshed (visible tab only); a push arriving in the background refreshes it on focus. */
export const NOTIFICACOES_POLL_MS = 60_000;
export function useNotificacoes(enabled = true) {
  const query = useListarNotificacoes({ query: {
    queryKey: getListarNotificacoesQueryKey(), enabled, retry: false, staleTime: 30_000,
    refetchInterval: NOTIFICACOES_POLL_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true,
  } });
  return { ...query, itens: query.data?.itens ?? [], naoLidas: query.data?.naoLidas ?? 0 };
}
export function useInvalidateNotificacoes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getListarNotificacoesQueryKey() });
}

const toKey = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIosBrowser = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
export const isStandaloneApp = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

export type EstadoPush = 'indisponivel-servidor' | 'sem-suporte' | 'ios-sem-instalar' | 'negado' | 'desligado' | 'ligado' | 'carregando';
/**
 * Push on this device: whether the server has keys, whether the browser supports it, and whether this browser is subscribed.
 * Permission is requested only when the person turns it on (never at page load).
 */
export const PUSH_DONO_KEY = ['plataforma', 'push'] as const;
type EstadoPushServidor = { disponivel: boolean; chavePublica: string | null; assinaturas: number };
type Assinatura = { endpoint: string; keys: { p256dh: string; auth: string }; navegador?: string };
/** The owner's devices live under /plataforma (no company); companies use the generated client for /avisos/push. */
function usePushDono(enabled: boolean) {
  const servidor = useQuery({ queryKey: PUSH_DONO_KEY, queryFn: () => api<EstadoPushServidor>('GET', '/plataforma/push'), staleTime: 300_000, retry: false, enabled });
  const assinar = useMutation({ mutationFn: (v: { data: Assinatura }) => api<{ ok: boolean }>('POST', '/plataforma/push/assinatura', v.data) });
  const cancelar = useMutation({ mutationFn: (v: { data: { endpoint: string } }) => api<void>('DELETE', '/plataforma/push/assinatura', v.data) });
  return { servidor, assinar, cancelar };
}
function usePushEmpresa(enabled: boolean) {
  const servidor = useEstadoDoPush({ query: { queryKey: getEstadoDoPushQueryKey(), staleTime: 300_000, retry: false, enabled } });
  const assinar = useAssinarPush();
  const cancelar = useCancelarAssinaturaPush();
  return { servidor, assinar, cancelar };
}
export function usePush(escopo: 'empresa' | 'dono' = 'empresa') {
  const qc = useQueryClient();
  const dono = usePushDono(escopo === 'dono');
  const empresa = usePushEmpresa(escopo === 'empresa');
  const { servidor, assinar, cancelar } = escopo === 'dono' ? dono : empresa;
  const chaveServidor = escopo === 'dono' ? PUSH_DONO_KEY : getEstadoDoPushQueryKey();
  const [local, setLocal] = useState<PushSubscription | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [semWorker, setSemWorker] = useState(false);
  /** The app's own worker; `ready` is only awaited when a registration exists (in development there is none, and `ready` would never settle). */
  const registration = useCallback(async () => {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration(`${appBasePath}/`).catch(() => undefined);
    if (!reg) return null;
    return reg.active ? reg : navigator.serviceWorker.ready.catch(() => reg);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const reg = await registration();
      const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      if (alive) { setLocal(sub); setSemWorker(pushSupported() && !reg); }
    })();
    return () => { alive = false; };
  }, [registration]);

  const estado: EstadoPush = servidor.isLoading || local === undefined ? 'carregando'
    : !servidor.data?.disponivel ? 'indisponivel-servidor'
      : !pushSupported() || semWorker ? (isIosBrowser() && !isStandaloneApp() ? 'ios-sem-instalar' : 'sem-suporte')
        : Notification.permission === 'denied' ? 'negado'
          : local ? 'ligado' : 'desligado';

  const ligar = async (): Promise<boolean> => {
    setErro(null);
    const chave = servidor.data?.chavePublica;
    const reg = await registration();
    if (!chave || !reg) { setErro('Este navegador não permite notificações para o Tato.'); return false; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setErro(permission === 'denied' ? 'As notificações foram bloqueadas no navegador. Libere nas configurações do site para usar.' : 'Permissão não concedida.'); setLocal(l => l ?? null); return false; }
    try {
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(chave) });
      const json = sub.toJSON();
      await assinar.mutateAsync({ data: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }, navegador: navigator.userAgent.slice(0, 300) } });
      setLocal(sub);
      void qc.invalidateQueries({ queryKey: chaveServidor });
      return true;
    } catch (e) { setErro(e instanceof Error && e.message ? e.message : 'Não foi possível ativar as notificações neste aparelho.'); return false; }
  };
  const desligar = async () => {
    setErro(null);
    const sub = local;
    if (!sub) return;
    await cancelar.mutateAsync({ data: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
    setLocal(null);
    void qc.invalidateQueries({ queryKey: chaveServidor });
  };
  return { estado, erro, ligar, desligar, ocupado: assinar.isPending || cancelar.isPending, assinaturas: servidor.data?.assinaturas ?? 0 };
}

export const fmtHora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
