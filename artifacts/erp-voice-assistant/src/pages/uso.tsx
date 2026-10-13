import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';
import { fmtDateTime } from '@/lib/format';

type Turn = { id: number; quando: string; pergunta: string; latenciaMs: number; custoUsd: number | null; funcao: string | null; dominio: string | null; fallback: boolean };
type Uso = {
  dias: number; truncado: boolean;
  resumo: { respostas: number; custoTotalUsd: number; custoMedioUsd: number | null; latenciaMediaMs: number | null; latenciaP50Ms: number | null; latenciaP95Ms: number | null; comFallback: number; medidas: number };
  porDia: Array<{ dia: string; respostas: number; custoUsd: number }>; maisCaras: Turn[]; maisLentas: Turn[];
};
const usd = (v: number | null) => (v === null ? '—' : `US$ ${v.toFixed(4)}`);
const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const PERIODS = [7, 30, 90] as const;

/** What the answers cost and how long they take, from the values each turn recorded. */
export default function UsoPage() {
  const [dias, setDias] = useState<number>(30);
  const q = useQuery({ queryKey: ['uso', dias], queryFn: () => api<Uso>('GET', `/uso?dias=${dias}`) });
  const d = q.data;
  const maxDay = Math.max(0.0001, ...(d?.porDia.map(x => x.custoUsd) ?? [0]));
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="display text-3xl">Custo e tempo</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">Valores registrados em cada resposta (tokens e tempo reais). Voz e transcrição ainda não entram no custo.</p>
        <div className="flex gap-2" role="tablist">{PERIODS.map(p => (
          <button key={p} role="tab" aria-selected={dias === p} onClick={() => setDias(p)} className={`h-9 px-3 rounded border text-sm ${dias === p ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>Últimos {p} dias</button>
        ))}</div>
      </header>
      {q.isLoading && <div className="skel h-32" />}
      {q.isError && <p className="text-sm">{errorMessage(q.error)} <button className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>}
      {d && (d.resumo.respostas === 0 ? <p className="text-sm text-muted-foreground">Nenhuma resposta neste período.</p> : <>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="resumo-uso">
          {[['Respostas', String(d.resumo.respostas)], ['Custo total', usd(d.resumo.custoTotalUsd)], ['Custo médio', usd(d.resumo.custoMedioUsd)], ['Tempo médio', sec(d.resumo.latenciaMediaMs)],
            ['Metade responde em até', sec(d.resumo.latenciaP50Ms)], ['95% responde em até', sec(d.resumo.latenciaP95Ms)],
            ['Resposta de segurança', `${d.resumo.comFallback} de ${d.resumo.medidas} medidas`]].map(([k, v]) => (
            <div key={k} className="border border-border rounded p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg num">{v}</dd></div>
          ))}
        </dl>
        {d.truncado && <p className="text-xs text-muted-foreground">Mostrando as 5.000 respostas mais recentes do período.</p>}
        <section className="space-y-2"><h2 className="display text-xl">Custo por dia</h2>
          <ul className="space-y-1">{d.porDia.map(x => (
            <li key={x.dia} className="grid grid-cols-[6rem_1fr_9rem] items-center gap-3 text-sm num">
              <span>{x.dia.split('-').reverse().slice(0, 2).join('/')}</span>
              <span className="h-3 bg-muted rounded overflow-hidden" aria-hidden><span className="block h-full bg-primary" style={{ width: `${Math.max(2, (x.custoUsd / maxDay) * 100)}%` }} /></span>
              <span className="text-right">{usd(x.custoUsd)} · {x.respostas} resp.</span>
            </li>))}</ul></section>
        <TurnList title="Respostas mais caras" turns={d.maisCaras} />
        <TurnList title="Respostas mais lentas" turns={d.maisLentas} />
      </>)}
    </div>
  );
}

function TurnList({ title, turns }: { title: string; turns: Turn[] }) {
  return (
    <section className="space-y-2"><h2 className="display text-xl">{title}</h2>
      <ul className="divide-y divide-border border border-border rounded">{turns.map(t => (
        <li key={t.id} className="p-3 text-sm space-y-1">
          <p>{t.pergunta}</p>
          <p className="text-xs text-muted-foreground num">{fmtDateTime(t.quando)} · {usd(t.custoUsd)} · {sec(t.latenciaMs)} · {t.dominio ?? 'sem domínio'} · {t.funcao ?? 'consulta livre/conversa'}{t.fallback ? ' · resposta de segurança' : ''}</p>
        </li>))}</ul></section>
  );
}
