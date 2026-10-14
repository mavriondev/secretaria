import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListFavoritosQueryKey, useListFavoritos, type FavoritosLista } from '@workspace/api-client-react';

/** Message of a failed favourites call: the server's sentence when there is one. */
export const apiMessage = (e: unknown): string => {
  const data = (e as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  return e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.';
};

export const EMPTY: FavoritosLista = { itens: [], faixaTelaInicial: true, cota: 30, limiteTelaInicial: 3, intervaloMinimoSeg: 60, intervalos: [60, 300, 900, 3600] };
export function useFavoritos() {
  const query = useListFavoritos({ query: { queryKey: getListFavoritosQueryKey(), staleTime: 30_000 } });
  return { ...query, lista: query.data ?? EMPTY };
}
export function useInvalidateFavoritos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() });
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
