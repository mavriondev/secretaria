import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { idadeDado } from '@/lib/painel-controller';
import type { CartaoDados, PainelCartaoPublico, PainelPublico } from '@workspace/api-client-react';
import { CartaoNumero } from '@/components/graficos/CartaoNumero';
import { CartaoRanking } from '@/components/graficos/CartaoRanking';
import { CartaoSerie } from '@/components/graficos/CartaoSerie';
import { CartaoTabela } from '@/components/graficos/CartaoTabela';
import { barrasQueCabem, layoutPainel, linhasQueCabem, type Celula, type CartaoLayout } from '@/lib/painel-layout';

/** The TV stage is designed at 1280x720 and scaled to the screen, so 1366x768, 1080p and 4K look the same and never scroll. */
const BASE_W = 1280;
const BASE_H = 720;

export const hhmm = (v: number | string | Date) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(v));

const CLARO: CSSProperties = {
  ['--background' as string]: '40 30% 96%', ['--foreground' as string]: '214 28% 14%', ['--card' as string]: '0 0% 100%', ['--card-foreground' as string]: '214 28% 14%',
  ['--muted' as string]: '40 20% 90%', ['--muted-foreground' as string]: '214 12% 38%', ['--border' as string]: '40 14% 80%', ['--popover' as string]: '0 0% 100%', ['--popover-foreground' as string]: '214 28% 14%',
  ['--chart-1' as string]: '36 92% 40%', ['--chart-2' as string]: '168 80% 28%', ['--chart-5' as string]: '212 12% 50%', ['--accent' as string]: '168 80% 28%', ['--destructive' as string]: '4 70% 46%',
};

function useAltura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setH(Math.floor(el.clientHeight)));
    ro.observe(el); setH(Math.floor(el.clientHeight));
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

function ajustar(dados: CartaoDados, altura: number): CartaoDados {
  if (dados.form === 'ranking') return { ...dados, bars: (dados.bars ?? []).filter(b => !b.others).slice(0, barrasQueCabem(altura)) };
  if (dados.form === 'tabela') {
    const cols = (dados.columns ?? []);
    const visiveis = cols.length > 1 ? cols.filter(c => !/(^|_)id$/.test(c.name)) : cols;
    return { ...dados, columns: visiveis, rows: (dados.rows ?? []).slice(0, Math.min(8, linhasQueCabem(altura))) };
  }
  return dados;
}

function CorpoTv({ dados, altura }: { dados: CartaoDados; altura: number }) {
  if (!altura) return null;
  if (dados.form === 'numero') return <CartaoNumero dados={dados} compacto={altura < 110} />;
  if (dados.form === 'serie') return <CartaoSerie dados={dados} altura={Math.max(60, altura - 8)} />;
  if (dados.form === 'ranking') return <CartaoRanking dados={ajustar(dados, altura)} />;
  return <div className="overflow-hidden"><CartaoTabela dados={ajustar(dados, altura)} todas /></div>;
}

function CartaoTv({ cartao, atraso, agora }: { cartao: PainelCartaoPublico; atraso: boolean; agora: number }) {
  const [ref, altura] = useAltura<HTMLDivElement>();
  return (
    <article className="h-full min-h-0 min-w-0 rounded-xl border border-border bg-card p-3 flex flex-col gap-1.5 overflow-hidden" data-testid={'tv-cartao-' + cartao.chave}>
      <header className="flex items-baseline justify-between gap-2 min-w-0">
        <h2 className="text-[15px] font-medium truncate" title={cartao.titulo}>{cartao.titulo}</h2>
        {cartao.estado === 'ok' && cartao.atualizadoEm && <span title={cartao.atualizadoEm} className={'num text-[11px] shrink-0 ' + (atraso ? 'text-destructive' : 'text-muted-foreground')} data-testid="tv-cartao-idade">{hhmm(cartao.atualizadoEm)} · há {idadeDado(cartao.atualizadoEm, agora)}</span>}
      </header>
      <div ref={ref} className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {cartao.estado === 'removido' ? <p className="text-sm text-muted-foreground" data-testid="tv-cartao-removido">Cartão removido</p>
        : cartao.dados ? <CorpoTv dados={cartao.dados} altura={altura} />
        : <p className="text-sm text-muted-foreground" data-testid="tv-cartao-sem-dados">Sem dados no momento.</p>}
      </div>
      {cartao.estado === 'erro' && cartao.dados && <p className="text-[11px] text-muted-foreground" data-testid="tv-cartao-erro">Atualização falhou, mostrando o último valor.</p>}
    </article>
  );
}

type Props = { painel: PainelPublico; agora: number; atualizadoEmMs: number | null; desatualizadoMin: number | null; acoes?: ReactNode; pagina?: number };

export function TvPainel({ painel, agora, atualizadoEmMs, desatualizadoMin, acoes }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: BASE_W, h: BASE_H });
  useEffect(() => {
    const el = outer.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setDim({ w: el.clientWidth || BASE_W, h: el.clientHeight || BASE_H }));
    ro.observe(el); setDim({ w: el.clientWidth || BASE_W, h: el.clientHeight || BASE_H });
    return () => ro.disconnect();
  }, []);
  const escala = Math.min(dim.w / BASE_W, dim.h / BASE_H) || 1;

  const entrada: CartaoLayout[] = useMemo(() => painel.cartoes.map(c => ({ id: c.chave, forma: c.dados?.form ?? 'numero', tamanho: c.tamanho, pagina: c.pagina })), [painel.cartoes]);
  const paginas = useMemo(() => layoutPainel(painel.modelo, entrada, painel.ordemAutomatica), [painel.modelo, entrada, painel.ordemAutomatica]);
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (idx >= paginas.length) setIdx(0); }, [paginas.length, idx]);
  useEffect(() => {
    if (painel.modelo !== 'rotativo' || paginas.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % paginas.length), Math.max(10, painel.rotacaoSegundos) * 1000);
    return () => clearInterval(t);
  }, [painel.modelo, painel.rotacaoSegundos, paginas.length]);

  const porChave = useMemo(() => new Map(painel.cartoes.map(c => [c.chave, c])), [painel.cartoes]);
  const pagina = paginas[Math.min(idx, Math.max(0, paginas.length - 1))];
  const limite = Math.max(60, painel.atualizacaoSegundos) * 1500 + 5000;
  const atrasoDe = (c: PainelCartaoPublico) => !!c.atualizadoEm && agora - new Date(c.atualizadoEm).getTime() > limite + 600_000;
  const lw = dim.w / escala, lh = dim.h / escala;

  return (
    <div ref={outer} className="relative w-full h-full overflow-hidden bg-background" style={painel.tema === 'claro' ? CLARO : undefined} data-testid="tv-palco" data-tema={painel.tema}>
      <div className="absolute left-0 top-0 flex flex-col gap-2.5 p-4 bg-background text-foreground" style={{ width: lw, height: lh, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
        <header className="flex items-center gap-4 shrink-0 h-9">
          <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" aria-hidden />
          <h1 className="display text-2xl leading-none truncate" data-testid="tv-nome">{painel.nome}</h1>
          <span className="text-sm text-muted-foreground truncate">{painel.empresa}</span>
          <div className="ml-auto flex items-center gap-4 text-sm shrink-0">
            {painel.modelo === 'rotativo' && paginas.length > 1 && (
              <span className="flex items-center gap-1" aria-label={'Página ' + (idx + 1) + ' de ' + paginas.length} data-testid="tv-paginas">
                {paginas.map((p, i) => <span key={p.numero} className={'h-1.5 rounded-full transition-all ' + (i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/40')} />)}
              </span>
            )}
            {desatualizadoMin !== null && <span className="rounded-full bg-destructive/15 text-destructive px-2.5 py-0.5" data-testid="tv-desatualizado">Desatualizado há {desatualizadoMin} min</span>}
            <span className="num text-muted-foreground" data-testid="tv-atualizado" title={painel.atualizadoEm ?? undefined}>{painel.atualizadoEm ? `Atualizado às ${hhmm(painel.atualizadoEm)} · há ${idadeDado(painel.atualizadoEm, agora)}` : 'Dados sem horário de atualização'}</span>
            <span className="num display text-2xl leading-none" data-testid="tv-relogio">{hhmm(agora)}</span>
            {acoes}
          </div>
        </header>
        <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }} data-testid="tv-grade">
          {pagina?.celulas.map((c: Celula) => {
            const cartao = porChave.get(c.id); if (!cartao) return null;
            return <div key={c.id} className="min-h-0 min-w-0" style={{ gridColumn: `${c.col} / span ${c.colSpan}`, gridRow: `${c.row} / span ${c.rowSpan}` }}><CartaoTv cartao={cartao} atraso={atrasoDe(cartao)} agora={agora} /></div>;
          })}
          {!painel.cartoes.length && <p className="col-span-12 row-span-6 grid place-items-center text-muted-foreground">Este painel ainda não tem cartões.</p>}
        </div>
      </div>
    </div>
  );
}
