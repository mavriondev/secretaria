import { useState } from 'react';
import { Download, Play, AlertTriangle } from 'lucide-react';
import { useRunConference } from '@workspace/api-client-react';
import { MetricPanel } from '@/components/metric-panel';
import { brl, fmtDate, isoToday, metricLabel } from '@/lib/format';

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function Conference() {
  const run = useRunConference();
  const today = isoToday();
  const [startDate, setStart] = useState(today.slice(0, 8) + '01');
  const [endDate, setEnd] = useState(today);
  const [referenceDate, setRef] = useState(today);
  const [productLimit, setLimit] = useState(5);
  const data = run.data;
  const invalid = !startDate || !endDate || !referenceDate || startDate > endDate || productLimit < 1 || productLimit > 20;

  const exportCsv = () => {
    if (!data) return;
    const head = ['metrica', 'valor_total_brl', 'inicio', 'fim', 'referencia', 'atualizado_em', 'filtros', 'item', 'valor_item_brl', 'quantidade', 'dias_atraso', 'faixa'];
    const rows: string[] = [head.join(';')];
    for (const r of data.results) {
      const base = [metricLabel[r.metric] ?? r.metric, r.value.toFixed(2).replace('.', ','), fmtDate(r.period.startDate), fmtDate(r.period.endDate), fmtDate(r.period.referenceDate), r.lastUpdatedAt, r.filters.join(' | ')];
      if (!r.details.length) rows.push([...base, '', '', '', '', ''].map(csvCell).join(';'));
      for (const d of r.details) rows.push([...base, d.subject, d.amount.toFixed(2).replace('.', ','), d.quantity ?? '', d.daysPastDue ?? '', d.bucket ?? ''].map(csvCell).join(';'));
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `conferencia_${data.startDate}_${data.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inp = 'h-10 px-2 rounded border border-input bg-card num text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full';
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Conferência</h1>
        <p className="text-sm text-muted-foreground mt-1">Execute as três métricas para um período e compare com o que o assistente respondeu.</p>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) run.mutate({ data: { startDate, endDate, referenceDate, productLimit } }); }}
        className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end border border-border rounded-md bg-card p-4">
        {[['Data inicial', startDate, setStart, 'start'], ['Data final', endDate, setEnd, 'end'], ['Data de referência', referenceDate, setRef, 'ref']].map(([l, v, s, t]) => (
          <label key={t as string} className="text-xs text-muted-foreground">{l as string}
            <input type="date" className={inp + ' mt-1'} value={v as string} onChange={(e) => (s as (x: string) => void)(e.target.value)} data-testid={`input-${t}-date`} />
          </label>
        ))}
        <label className="text-xs text-muted-foreground">Limite de produtos (1–20)
          <input type="number" min={1} max={20} className={inp + ' mt-1'} value={productLimit} onChange={(e) => setLimit(Number(e.target.value))} data-testid="input-product-limit" />
        </label>
        <button type="submit" disabled={invalid || run.isPending} data-testid="button-run"
          className="h-10 rounded bg-primary text-primary-foreground text-sm flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50">
          <Play className="h-4 w-4" />{run.isPending ? 'Executando' : 'Executar'}
        </button>
        {startDate > endDate && <p className="col-span-full text-xs text-destructive">A data inicial deve ser anterior à final.</p>}
      </form>

      {run.isPending && <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="skel h-24" />)}</div>}
      {run.isError && (
        <div className="border border-destructive/40 bg-destructive/5 rounded p-3 text-sm flex items-center gap-2" role="alert" data-testid="status-error">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="flex-1">{run.error instanceof Error ? run.error.message : 'Falha ao executar a conferência.'}</span>
          <button className="underline" onClick={() => run.mutate({ data: { startDate, endDate, referenceDate, productLimit } })} data-testid="button-retry">Tentar novamente</button>
        </div>
      )}
      {!data && !run.isPending && !run.isError && (
        <div className="border border-dashed border-border rounded-md p-8 text-center">
          <p className="display text-xl">Nenhuma conferência executada</p>
          <p className="text-sm text-muted-foreground mt-1">Escolha as datas e execute para ver as três métricas.</p>
        </div>
      )}
      {data && !run.isPending && (
        <section className="space-y-3 rise">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm num text-muted-foreground">{fmtDate(data.startDate)} a {fmtDate(data.endDate)} · ref. {fmtDate(data.referenceDate)}</p>
            <button onClick={exportCsv} data-testid="button-export-csv" className="h-9 px-3 rounded border border-primary text-primary text-sm flex items-center gap-2 hover:bg-primary hover:text-primary-foreground transition-colors">
              <Download className="h-4 w-4" />Exportar CSV
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.results.map((r) => (
              <div key={r.metric} className="border border-border rounded bg-card p-3">
                <div className="text-xs text-muted-foreground">{metricLabel[r.metric]}</div>
                <div className="display text-xl">{brl(r.value)}</div>
              </div>
            ))}
          </div>
          {data.results.map((r) => (
            <MetricPanel key={r.metric} id={r.metric} functionName={r.metric} parameters={{ startDate: data.startDate, endDate: data.endDate, referenceDate: data.referenceDate, productLimit }} result={r} />
          ))}
        </section>
      )}
    </div>
  );
}
