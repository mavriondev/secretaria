import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MetricResult } from '@workspace/api-client-react';
import { brl, fmtDate, fmtDateTime, metricLabel } from '@/lib/format';

type Props = {
  functionName: string | null;
  parameters: Record<string, unknown>;
  result: MetricResult;
  id: string;
};

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className="text-sm mt-0.5 break-words">{children}</dd>
    </div>
  );
}

export function MetricPanel({ functionName, parameters, result, id }: Props) {
  const [open, setOpen] = useState(false);
  const p = result.period;
  const showQty = result.details.some((d) => d.quantity != null);
  const showDue = result.details.some((d) => d.daysPastDue != null);
  const showBucket = result.details.some((d) => d.bucket != null);
  return (
    <div className="border border-border rounded-md bg-card" data-testid={`panel-metric-${id}`}>
      <div className="p-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{metricLabel[result.metric] ?? result.metric}</div>
          <div className="display text-3xl" data-testid={`text-value-${id}`}>{brl(result.value)}</div>
        </div>
        <div className="text-right text-xs text-muted-foreground num">
          {p.label}
          <br />
          {p.startDate || p.endDate ? `${fmtDate(p.startDate)} a ${fmtDate(p.endDate)}` : ''}
        </div>
      </div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 border-t border-border text-xs font-medium text-primary hover:bg-muted transition-colors"
        data-testid={`button-inspect-${id}`}
        aria-expanded={open}
      >
        Inspecionar cálculo
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border p-4 space-y-4 rise">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field k="Função"><span className="num">{functionName ?? result.metric}</span></Field>
            <Field k="Período"><span className="num">{p.label}</span></Field>
            <Field k="Início / fim"><span className="num">{fmtDate(p.startDate)} / {fmtDate(p.endDate)}</span></Field>
            <Field k="Data de referência"><span className="num">{fmtDate(p.referenceDate)}</span></Field>
            <Field k="Atualizado em"><span className="num">{fmtDateTime(result.lastUpdatedAt)}</span></Field>
            <Field k="Filtros">{result.filters.length ? result.filters.join('; ') : 'Nenhum'}</Field>
          </dl>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Parâmetros</div>
            <pre className="num text-xs bg-muted rounded p-2 overflow-x-auto">{JSON.stringify(parameters, null, 2)}</pre>
          </div>
          {result.comparisons.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Comparações</div>
              <ul className="divide-y divide-border border border-border rounded">
                {result.comparisons.map((c, i) => (
                  <li key={i} className="flex justify-between gap-2 px-3 py-1.5 text-sm">
                    <span>{c.label}</span>
                    <span className="num">
                      {brl(c.value)}
                      {c.variationPct != null && (
                        <span className={c.variationPct >= 0 ? 'text-chart-4' : 'text-destructive'}>
                          {' '}({c.variationPct >= 0 ? '+' : ''}{c.variationPct.toFixed(1).replace('.', ',')}%)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detalhes ({result.details.length})</div>
            {result.details.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma linha de detalhe retornada.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Item</th>
                      <th className="text-right px-3 py-1.5 font-medium">Valor</th>
                      {showQty && <th className="text-right px-3 py-1.5 font-medium">Qtd.</th>}
                      {showDue && <th className="text-right px-3 py-1.5 font-medium">Dias de atraso</th>}
                      {showBucket && <th className="text-left px-3 py-1.5 font-medium">Faixa</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.details.map((d, i) => (
                      <tr key={i} className="hover:bg-muted/60">
                        <td className="px-3 py-1.5">{d.subject}</td>
                        <td className="px-3 py-1.5 text-right num">{brl(d.amount)}</td>
                        {showQty && <td className="px-3 py-1.5 text-right num">{d.quantity ?? '—'}</td>}
                        {showDue && <td className="px-3 py-1.5 text-right num">{d.daysPastDue ?? '—'}</td>}
                        {showBucket && <td className="px-3 py-1.5">{d.bucket ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Resultado bruto</div>
            <pre className="num text-xs bg-muted rounded p-2 overflow-auto max-h-60" data-testid={`text-raw-${id}`}>{JSON.stringify(result.rawResult, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
