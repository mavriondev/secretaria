import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Lock } from 'lucide-react';
import { getExecutarFavoritoQueryKey, useExecutarFavorito, type Favorito, type FavoritoExecucao } from '@workspace/api-client-react';
import { CartaoNumero } from '@/components/graficos/CartaoNumero';
import { CartaoSerie } from '@/components/graficos/CartaoSerie';
import { CartaoRanking } from '@/components/graficos/CartaoRanking';
import { CartaoTabela } from '@/components/graficos/CartaoTabela';
import { fmtCarimbo } from '@/lib/cartao-format';
import { apiMessage, useVisivel } from '@/lib/favoritos';

/** Draws one result in its form. Shared by cards, the dialog preview and the home strip. */
export function CorpoCartao({ execucao, variacao, compacto = false }: { execucao: FavoritoExecucao; variacao?: number | null; compacto?: boolean }) {
  const dados = execucao.resultado?.dados;
  if (!dados) return null;
  if (dados.form === 'numero') return <CartaoNumero dados={dados} variacao={variacao} compacto={compacto} />;
  if (dados.form === 'serie') return <CartaoSerie dados={dados} mini={compacto} />;
  if (dados.form === 'ranking') return <CartaoRanking dados={dados} />;
  return <CartaoTabela dados={dados} />;
}

export function EsqueletoCartao({ compacto = false }: { compacto?: boolean }) {
  return <div className={'skel w-full ' + (compacto ? 'h-16' : 'h-40')} aria-hidden />;
}

type Props = {
  favorito: Favorito;
  compacto?: boolean;
  /** Called when a live card fails and the person asks to redo it. */
  onRefazer?: (favorito: Favorito) => void;
  children?: React.ReactNode;
  /** Where the card's menu goes (page only). */
  menu?: React.ReactNode;
  dragHandle?: React.ReactNode;
};

/**
 * One favourite with its states: skeleton (same height), value, "refazer" after a failed query, "sem acesso", and a
 * stale badge when the last refresh is older than two intervals. Live cards refresh on their interval only while on
 * screen and while the tab is visible; nothing here ever calls the model.
 */
export function CartaoFavorito({ favorito, compacto = false, onRefazer, children, menu, dragHandle }: Props) {
  const [ref, visible] = useVisivel<HTMLElement>();
  const vivo = favorito.tipo === 'vivo';
  const interval = (favorito.intervaloSeg ?? 300) * 1000;
  const query = useExecutarFavorito(favorito.id, { query: {
    queryKey: getExecutarFavoritoQueryKey(favorito.id), enabled: visible, retry: false,
    refetchInterval: vivo ? interval : false, refetchIntervalInBackground: false, refetchOnWindowFocus: vivo, staleTime: vivo ? Math.min(interval, 30_000) : Infinity,
    placeholderData: previous => previous,
  } });
  const lastOk = useRef<FavoritoExecucao | null>(null);
  if (query.data?.estado === 'ok') lastOk.current = query.data;
  // Stale: refreshed longer than two intervals ago (the tab was hidden, the network failed...).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!vivo) return; const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, [vivo]);
  const executedAt = lastOk.current?.resultado?.executadoEm ? new Date(lastOk.current.resultado.executadoEm).getTime() : null;
  const stale = vivo && executedAt !== null && now - executedAt > interval * 2;
  const status = (query.error as { status?: number } | null)?.status;
  const semAcesso = status === 403 || status === 409;

  return (
    <article ref={ref} className={'min-w-0 rounded-xl border border-border bg-card flex flex-col ' + (compacto ? 'p-3 gap-2' : 'p-4 gap-3')} data-testid={'favorito-cartao-' + favorito.id} aria-busy={query.isFetching && !lastOk.current}>
      <header className="flex items-start gap-2 min-w-0">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <h3 className={'font-medium truncate ' + (compacto ? 'text-sm' : 'text-base')} title={favorito.titulo}>{favorito.titulo}</h3>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            {vivo ? (
              <><span className="inline-flex items-center gap-1" aria-label="Ao vivo"><span className={'h-1.5 w-1.5 rounded-full ' + (stale ? 'bg-muted-foreground' : 'bg-accent')} aria-hidden />ao vivo</span>
              {executedAt !== null && <span className="num">· {fmtCarimbo(new Date(executedAt).toISOString())}</span>}
              {stale && <span className="rounded-full bg-muted px-1.5 py-px text-muted-foreground" data-testid="favorito-desatualizado">desatualizado</span>}</>
            ) : favorito.guardadoEm ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden />guardado em {fmtCarimbo(favorito.guardadoEm)}</span> : null}
          </p>
        </div>
        {menu}
      </header>
      <div className="min-w-0 flex-1">
        {semAcesso ? <p className="text-sm text-muted-foreground" data-testid="favorito-sem-acesso">Sem acesso a estes dados no momento.</p>
        : query.data?.estado === 'refazer' ? (
          <div className="space-y-2" role="alert" data-testid="favorito-refazer">
            <p className="text-sm text-destructive">A consulta deste favorito parou de funcionar.</p>
            <p className="text-xs text-muted-foreground break-words">{query.data.erro}</p>
            {onRefazer && <button type="button" onClick={() => onRefazer(favorito)} className="h-9 px-3 rounded-md border border-border text-sm inline-flex items-center gap-2 hover:bg-muted"><RefreshCw className="h-3.5 w-3.5" />Refazer consulta</button>}
          </div>
        ) : lastOk.current ? <CorpoCartao execucao={lastOk.current} variacao={lastOk.current.variacao} compacto={compacto} />
        : query.isError ? <p className="text-sm text-destructive" role="alert">{apiMessage(query.error)} <button className="underline" onClick={() => query.refetch()}>Tentar novamente</button></p>
        : <EsqueletoCartao compacto={compacto} />}
      </div>
      {children}
    </article>
  );
}
