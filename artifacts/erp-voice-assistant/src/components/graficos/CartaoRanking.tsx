import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts';
import type { CartaoDados } from '@workspace/api-client-react';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { fmtAxis, fmtFull, truncar } from '@/lib/cartao-format';

const config: ChartConfig = { value: { label: 'Valor', color: 'hsl(var(--chart-1))' } };

/** Horizontal bars, largest first; "Outros" (when present) is drawn in the muted colour and labelled, never colour-only. */
export function CartaoRanking({ dados }: { dados: CartaoDados }) {
  const bars = dados.bars ?? [];
  const type = dados.medida?.type ?? 'numero';
  const summary = dados.medida?.label + ' por ' + (dados.categoria?.label ?? 'item') + ': ' + bars.slice(0, 3).map(b => b.label + ' ' + fmtFull(b.value === null ? null : String(b.value), type)).join(', ') + (bars.length > 3 ? ' e mais ' + (bars.length - 3) : '');
  if (!bars.length) return <p className="text-sm text-muted-foreground">Sem dados para desenhar.</p>;
  const height = Math.max(96, bars.length * 26 + 8);
  return (
    <div className="min-w-0">
      <ChartContainer config={config} className="w-full min-w-0 aspect-auto" style={{ height }} role="img" aria-label={summary}>
        <BarChart data={bars} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} tickFormatter={v => fmtAxis(Number(v), type)} />
          <YAxis type="category" dataKey="label" width={96} tickLine={false} axisLine={false} fontSize={11} tickFormatter={v => truncar(String(v), 16)} interval={0} />
          <ChartTooltip cursor={{ fill: 'hsl(var(--muted))' }} content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload as { label: string; value: number | null; others?: boolean } | undefined;
            if (!p) return null;
            return <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md max-w-[240px]"><p className="text-muted-foreground break-words">{p.label}{p.others && dados.grouped ? ' (' + dados.grouped + ' itens)' : ''}</p><p className="num font-medium">{fmtFull(p.value === null ? null : String(p.value), type)}</p></div>;
          }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
            {bars.map(b => <Cell key={b.label} fill={b.others ? 'hsl(var(--chart-5))' : 'hsl(var(--chart-1))'} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="sr-only"><table><caption>{summary}</caption><tbody>{bars.map(b => <tr key={b.label}><th scope="row">{b.label}</th><td>{fmtFull(b.value === null ? null : String(b.value), type)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
