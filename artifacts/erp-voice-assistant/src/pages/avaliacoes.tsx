import { useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';
import { fmtDateTime } from '@/lib/format';

type Item = {
  id: number; logId: number; motivo: string; status: 'nova' | 'revisada' | 'descartada'; tratativa: string; criadaEm: string; revisadaEm: string | null;
  pergunta: string; resposta: string; funcao: string | null; dominio: string | null; fallback: boolean | null; latenciaMs: number; custoUsd: number | null; respondidaEm: string;
};
const FILTERS = [{ v: 'nova', l: 'Para revisar' }, { v: 'revisada', l: 'Revisadas' }, { v: 'descartada', l: 'Descartadas' }, { v: '', l: 'Todas' }] as const;

/** Answers that managers flagged as wrong. The administrator reads the evidence, records what was done and closes the review. */
export default function Avaliacoes() {
  const [status, setStatus] = useState<string>('nova');
  const list = useQuery({ queryKey: ['avaliacoes', status], queryFn: () => api<Item[]>('GET', `/avaliacoes${status ? `?status=${status}` : ''}`) });
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="display text-3xl">Respostas ruins</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">Respostas que os gestores marcaram como erradas. Veja o que foi perguntado e respondido, anote o que fez e feche. Quando a causa for falta de contexto, ensine a IA na aba <Link href="/admin/dados" className="underline">Dados</Link> (por coluna) ou em <Link href="/admin/conhecimento" className="underline">Conhecimento</Link>.</p>
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTERS.map(f => (
            <button key={f.v} role="tab" aria-selected={status === f.v} onClick={() => setStatus(f.v)}
              className={`h-9 px-3 rounded border text-sm ${status === f.v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>{f.l}</button>
          ))}
        </div>
      </header>
      {list.isLoading && <div className="skel h-32" />}
      {list.isError && <p className="text-sm">{errorMessage(list.error)} <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
      {list.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma resposta nesta lista.</p>}
      <ul className="space-y-4">{list.data?.map(item => <Review key={item.id} item={item} />)}</ul>
    </div>
  );
}

function Review({ item }: { item: Item }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(item.tratativa);
  const set = useMutation({
    mutationFn: (status: Item['status']) => api('PATCH', `/avaliacoes/${item.id}`, { status, tratativa: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['avaliacoes'] }),
  });
  return (
    <li className="border border-border rounded p-4 space-y-3" data-testid={`avaliacao-${item.id}`}>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Pergunta · {fmtDateTime(item.respondidaEm)}</p>
        <p>{item.pergunta}</p>
        <p className="text-sm text-muted-foreground">Resposta</p>
        <p className="whitespace-pre-wrap">{item.resposta}</p>
      </div>
      <p className="text-sm"><span className="text-muted-foreground">Motivo informado: </span>{item.motivo || 'não informado'}</p>
      <p className="text-xs text-muted-foreground num">
        {item.dominio ?? 'sem domínio'} · {item.funcao ?? 'consulta livre/conversa'} · {(item.latenciaMs / 1000).toFixed(1)} s{item.custoUsd !== null ? ` · US$ ${item.custoUsd.toFixed(4)}` : ''}{item.fallback ? ' · usou resposta de segurança' : ''}
      </p>
      <label className="block text-sm">O que foi feito
        <textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full px-3 py-2 rounded border border-input bg-card text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {item.status !== 'revisada' && <button disabled={set.isPending} onClick={() => set.mutate('revisada')} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">Marcar como revisada</button>}
        {item.status !== 'descartada' && <button disabled={set.isPending} onClick={() => set.mutate('descartada')} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted">Descartar</button>}
        {item.status !== 'nova' && <button disabled={set.isPending} onClick={() => set.mutate('nova')} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted">Reabrir</button>}
        {set.isError && <span role="alert" className="text-sm text-destructive">{errorMessage(set.error)}</span>}
      </div>
    </li>
  );
}
