import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { CartaoDados } from '@workspace/api-client-react';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { fmtAxis, fmtCompact, fmtDia, fmtFull } from '@/lib/cartao-format';

const config: ChartConfig = { y: { label: 'Valor', color: 'hsl(var(--chart-1))' } };

/** A line over time. "mini" draws the sparkline used on the home strip: no axes, no grid, last value beside it. */
export function CartaoSerie({ dados, mini = false }: { dados: CartaoDados; mini?: boolean }) {
  const points = dados.points ?? [];
  const type = dados.y?.type ?? 'numero';
  const last = [...points].reverse().find(p => p.y !== null);
  const summary = dados.y?.label + ' por ' + (dados.x?.label ?? 'data') + ', ' + points.length + ' pontos' + (last ? ', último ' + fmtFull(String(last.y), type) : '');
  if (!points.length) return <p className="text-sm text-muted-foreground">Sem dados para desenhar.</p>;
  return (
    <div className="min-w-0">
      {mini && last && <p className="display num text-2xl leading-none mb-1" title={fmtFull(String(last.y), type)}>{fmtCompact(last.y, type)}</p>}
      <ChartContainer config={config} className={'w-full min-w-0 aspect-auto ' + (mini ? 'h-12' : 'h-40')} role="img" aria-label={summary}>
        <AreaChart data={points} margin={{ top: 4, right: 4, left: mini ? 0 : 4, bottom: 0 }}>
          <defs>
            <linearGradient id="favorito-serie-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
          </defs>
          {!mini && <CartesianGrid vertical={false} stroke="hsl(var(--border))" />}
          {!mini && <XAxis dataKey="x" tickFormatter={fmtDia} tickLine={false} axisLine={false} minTickGap={28} fontSize={11} />}
          {!mini && <YAxis width={44} tickFormatter={v => fmtAxis(Number(v), type)} tickLine={false} axisLine={false} fontSize={11} />}
          <ChartTooltip cursor={{ stroke: 'hsl(var(--border))' }} content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload as { x: string; y: number | null } | undefined;
            if (!p) return null;
            return <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"><p className="text-muted-foreground">{fmtDia(p.x)}</p><p className="num font-medium">{fmtFull(p.y === null ? null : String(p.y), type)}</p></div>;
          }} />
          <Area type="monotone" dataKey="y" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#favorito-serie-fill)" connectNulls={false} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
      {!mini && dados.summarized && <p className="text-[11px] text-muted-foreground mt-1">Resumido: {points.length} de {dados.total} pontos.</p>}
      <div className="sr-only"><table><caption>{summary}</caption><tbody>{points.map(p => <tr key={p.x}><th scope="row">{fmtDia(p.x)}</th><td>{fmtFull(p.y === null ? null : String(p.y), type)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
