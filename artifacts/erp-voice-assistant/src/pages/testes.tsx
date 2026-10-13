import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';

type Pergunta = { id: number; pergunta: string; deveConter: string[]; naoDeveConter: string[]; nota: string; ativa: boolean };
type Rodada = { id: number; status: 'executando' | 'concluida' | 'interrompida'; total: number; aprovadas: number; reprovadas: number; custoUsd: number; iniciadaEm: string; concluidaEm: string | null };
type Detalhe = Rodada & { resultados: Array<{ perguntaId: number; pergunta: string; resposta: string; aprovada: boolean; motivo: string; latenciaMs: number | null; custoUsd: number | null; mudou: boolean }> };
const lines = (v: string) => v.split('\n').map(s => s.trim()).filter(Boolean);
const COST_PER_QUESTION = 0.01;

/** Questions whose correct answer is known. Run them all after any change (or before releasing a client) to see what got better or worse. */
export default function Testes() {
  const qc = useQueryClient();
  const perguntas = useQuery({ queryKey: ['testes', 'perguntas'], queryFn: () => api<Pergunta[]>('GET', '/testes/perguntas') });
  const rodadas = useQuery({ queryKey: ['testes', 'rodadas'], queryFn: () => api<Rodada[]>('GET', '/testes/execucoes'), refetchInterval: q => (q.state.data?.[0]?.status === 'executando' ? 3000 : false) });
  const [selected, setSelected] = useState<number | null>(null);
  const active = perguntas.data?.filter(p => p.ativa).length ?? 0;
  const latest = rodadas.data?.[0];
  const running = latest?.status === 'executando';
  const shown = selected ?? latest?.id ?? null;
  const detail = useQuery({ queryKey: ['testes', 'rodada', shown, latest?.aprovadas, latest?.reprovadas], enabled: shown !== null, queryFn: () => api<Detalhe>('GET', `/testes/execucoes/${shown}`) });
  const run = useMutation({
    mutationFn: () => api<{ runId: number }>('POST', '/testes/execucoes'),
    onSuccess: r => { setSelected(r.runId); qc.invalidateQueries({ queryKey: ['testes'] }); },
  });
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="display text-3xl">Perguntas de teste</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">Cadastre perguntas cuja resposta certa você conhece, dizendo o que a resposta precisa conter. Ao rodar, o assistente responde de verdade a cada uma (com custo) e o sistema confere. Serve como critério de aceite antes de liberar uma empresa e para ver se uma mudança piorou algo.</p>
      </header>
      <section className="space-y-3" aria-labelledby="rodar">
        <h2 id="rodar" className="display text-xl">Rodar os testes</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={run.isPending || running || active === 0} onClick={() => { if (window.confirm(`Rodar ${active} pergunta(s)? Cada uma usa a IA de verdade: custo aproximado de US$ ${(active * COST_PER_QUESTION).toFixed(2)}.`)) run.mutate(); }}
            className="h-11 px-5 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-rodar-testes">{running ? 'Rodando…' : `Rodar ${active} pergunta(s)`}</button>
          {run.isError && <span role="alert" className="text-sm text-destructive">{errorMessage(run.error)}</span>}
        </div>
        {!!rodadas.data?.length && (
          <ul className="flex flex-wrap gap-2" aria-label="Rodadas anteriores">{rodadas.data.map(r => (
            <li key={r.id}><button onClick={() => setSelected(r.id)} className={`h-9 px-3 rounded border text-sm num ${shown === r.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
              {new Date(r.iniciadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {r.status === 'executando' ? `${r.aprovadas + r.reprovadas}/${r.total}` : `${r.aprovadas}/${r.total} ok`}{r.status === 'interrompida' ? ' · interrompida' : ''}</button></li>))}</ul>
        )}
        {detail.data && <Result run={detail.data} />}
      </section>
      <Questions items={perguntas.data ?? []} loading={perguntas.isLoading} />
    </div>
  );
}

function Result({ run }: { run: Detalhe }) {
  return (
    <div className="space-y-3" data-testid="resultado-rodada">
      <p className="text-sm num" role="status">{run.aprovadas} aprovadas · {run.reprovadas} reprovadas · de {run.total} · custo US$ {run.custoUsd.toFixed(4)}{run.status === 'executando' ? ' · em andamento…' : ''}</p>
      <ul className="divide-y divide-border border border-border rounded">{[...run.resultados].sort((a, b) => Number(a.aprovada) - Number(b.aprovada)).map(r => (
        <li key={r.perguntaId} className="p-3 text-sm space-y-1">
          <p><span className={r.aprovada ? 'text-chart-4' : 'text-destructive font-medium'}>{r.aprovada ? '✓ Aprovada' : '✗ Reprovada'}</span>{r.mudou ? <span className="ml-2 text-xs border border-border rounded px-1.5 py-0.5">{r.aprovada ? 'melhorou desde a rodada anterior' : 'piorou desde a rodada anterior'}</span> : null} · {r.pergunta}</p>
          {r.motivo && <p className="text-destructive">{r.motivo}</p>}
          <p className="text-muted-foreground whitespace-pre-wrap">{r.resposta || 'Sem resposta.'}</p>
          <p className="text-xs text-muted-foreground num">{r.latenciaMs !== null ? `${(r.latenciaMs / 1000).toFixed(1)} s` : ''}{r.custoUsd !== null ? ` · US$ ${r.custoUsd.toFixed(4)}` : ''}</p>
        </li>))}</ul>
    </div>
  );
}

function Questions({ items, loading }: { items: Pergunta[]; loading: boolean }) {
  const qc = useQueryClient();
  const empty = { pergunta: '', conter: '', naoConter: '', nota: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['testes', 'perguntas'] });
  const save = useMutation({
    mutationFn: () => {
      const data = { pergunta: form.pergunta, deveConter: lines(form.conter), naoDeveConter: lines(form.naoConter), nota: form.nota };
      return editing ? api('PUT', `/testes/perguntas/${editing}`, data) : api('POST', '/testes/perguntas', data);
    },
    onSuccess: () => { setForm(empty); setEditing(null); refresh(); },
  });
  const toggle = useMutation({ mutationFn: (p: Pergunta) => api('PUT', `/testes/perguntas/${p.id}`, { pergunta: p.pergunta, deveConter: p.deveConter, naoDeveConter: p.naoDeveConter, nota: p.nota, ativa: !p.ativa }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (p: Pergunta) => api('DELETE', `/testes/perguntas/${p.id}`), onSuccess: refresh });
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card text-sm';
  return (
    <section className="space-y-4" aria-labelledby="perguntas">
      <h2 id="perguntas" className="display text-xl">Perguntas cadastradas</h2>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="text-sm md:col-span-2">Pergunta
          <input required minLength={3} maxLength={500} value={form.pergunta} onChange={e => setForm({ ...form, pergunta: e.target.value })} className={`${field} h-11`} placeholder="Qual foi o faturamento de agosto?" /></label>
        <label className="text-sm">A resposta deve conter (um texto por linha)
          <textarea rows={3} value={form.conter} onChange={e => setForm({ ...form, conter: e.target.value })} className={`${field} py-2`} placeholder="R$ 1.277.257,84" /></label>
        <label className="text-sm">A resposta não pode conter (um por linha)
          <textarea rows={3} value={form.naoConter} onChange={e => setForm({ ...form, naoConter: e.target.value })} className={`${field} py-2`} /></label>
        <label className="text-sm md:col-span-2">Nota (opcional)
          <input maxLength={300} value={form.nota} onChange={e => setForm({ ...form, nota: e.target.value })} className={`${field} h-10`} /></label>
        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button disabled={save.isPending} className="h-10 px-4 rounded border border-border hover:bg-muted">{editing ? 'Salvar alteração' : 'Adicionar pergunta'}</button>
          {editing && <button type="button" className="underline text-sm" onClick={() => { setEditing(null); setForm(empty); }}>Cancelar edição</button>}
          {save.isError && <span role="alert" className="text-sm text-destructive">{errorMessage(save.error)}</span>}
        </div>
      </form>
      {loading && <div className="skel h-20" />}
      <ul className="divide-y divide-border border border-border rounded">{items.map(p => (
        <li key={p.id} className={`p-3 text-sm space-y-1 ${p.ativa ? '' : 'opacity-60'}`}>
          <p className="font-medium">{p.pergunta}{!p.ativa && ' (desativada)'}</p>
          <p className="text-xs text-muted-foreground">Deve conter: {p.deveConter.join(' · ') || '—'}{p.naoDeveConter.length ? ` · Não pode conter: ${p.naoDeveConter.join(' · ')}` : ''}{p.nota ? ` · ${p.nota}` : ''}</p>
          <p className="flex gap-3 text-xs">
            <button className="underline" onClick={() => { setEditing(p.id); setForm({ pergunta: p.pergunta, conter: p.deveConter.join('\n'), naoConter: p.naoDeveConter.join('\n'), nota: p.nota }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
            <button className="underline" onClick={() => toggle.mutate(p)}>{p.ativa ? 'Desativar' : 'Ativar'}</button>
            <button className="underline text-destructive" onClick={() => window.confirm('Excluir esta pergunta?') && remove.mutate(p)}>Excluir</button>
          </p>
        </li>))}</ul>
    </section>
  );
}
