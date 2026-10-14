import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMarcadorDadosQueryKey, getListFavoritosQueryKey, useGetMarcadorDados, useListFavoritos, type FavoritosLista, type MarcadorDados } from '@workspace/api-client-react';

/** Message of a failed favourites call: the server's sentence when there is one. */
export const apiMessage = (e: unknown): string => {
  const data = (e as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  return e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.';
};

export const EMPTY: FavoritosLista = { itens: [], faixaTelaInicial: true, cota: 30, limiteTelaInicial: 3 };
export function useFavoritos() {
  const query = useListFavoritos({ query: { queryKey: getListFavoritosQueryKey(), staleTime: 30_000 } });
  return { ...query, lista: query.data ?? EMPTY };
}
export function useInvalidateFavoritos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() });
}

/** How often the app asks whether new data arrived (only while the tab is visible). */
export const MARCADOR_POLL_MS = 60_000;
/**
 * The company's data marker (instant of the last load/receipt). Polled about once a minute while visible and on focus;
 * when it moves, every live card currently mounted is re-run. While it stays the same, cards never run again.
 */
export function useMarcadorDados(enabled = true) {
  const qc = useQueryClient();
  const query = useGetMarcadorDados({ query: {
    queryKey: getGetMarcadorDadosQueryKey(), enabled, retry: false,
    refetchInterval: MARCADOR_POLL_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true, staleTime: 30_000,
  } });
  const marcador = query.data?.marcador;
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (marcador === undefined) return;
    if (seen.current !== undefined && seen.current !== marcador) qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /^\/api\/favoritos\/\d+\/executar$/.test(q.queryKey[0]) });
    seen.current = marcador;
  }, [marcador, qc]);
  return query.data as MarcadorDados | undefined;
}

/** True while the element is on screen: charts are only drawn and refreshed while visible. */
export function useVisivel<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}
