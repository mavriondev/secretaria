import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';

type Regras = { dataVenda: 'DTNEG' | 'DTFATUR'; tiposMovimento: string[]; statusNota: string[]; valorItem: 'liquido' | 'bruto'; operacoesExcluidas: number[]; excluirBonificacao: boolean; empresas: number[] | null; incluirProvisao: boolean };
type Diagnostico = {
  mes: string; totalComRegrasAtuais: number | null;
  linhas: Array<{ tipmov: string | null; status: string | null; bonificacao: boolean; dataUsada: string; liquido: number; bruto: number; itens: number }>;
  candidatas: Array<{ regras: Pick<Regras, 'dataVenda' | 'tiposMovimento' | 'statusNota' | 'valorItem' | 'excluirBonificacao'>; total: number; diferenca: number }> | null;
};
const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const codes = (v: string) => v.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);

/** What counts as a sale and a receivable for a Sankhya company, and a way to prove it against a month the customer already trusts. */
export function CompanyRules({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'regras', company.id];
  const state = useQuery({ queryKey: key, queryFn: () => api<{ regras: Regras; personalizada: boolean }>('GET', `/plataforma/empresas/${company.id}/regras`) });
  const [draft, setDraft] = useState<Regras | null>(null);
  const r = draft ?? state.data?.regras;
  const [tipos, setTipos] = useState<string | null>(null); const [status, setStatus] = useState<string | null>(null); const [ops, setOps] = useState<string | null>(null);
  const [mes, setMes] = useState(''); const [total, setTotal] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ aviso: string | null }>('PUT', `/plataforma/empresas/${company.id}/regras`, {
      ...r, tiposMovimento: codes(tipos ?? r!.tiposMovimento.join(',')), statusNota: codes(status ?? r!.statusNota.join(',')),
      operacoesExcluidas: (ops ?? r!.operacoesExcluidas.join(',')).split(/[\s,;]+/).filter(Boolean).map(Number),
    }),
    onSuccess: () => { setDraft(null); setTipos(null); setStatus(null); setOps(null); qc.invalidateQueries({ queryKey: key }); },
  });
  const release = useMutation({
    mutationFn: () => api<{ ok: boolean; problemas: string[]; passos: Array<{ passo: string; ok: boolean }> }>('POST', `/plataforma/empresas/${company.id}/liberar-do-espelho`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plataforma'] }),
  });
  const check = useMutation({
    mutationFn: () => api<Diagnostico>('POST', `/plataforma/empresas/${company.id}/regras/diagnostico`, { mes, ...(total.trim() ? { totalEsperado: Number(total.replace(/\./g, '').replace(',', '.')) } : {}) }),
  });
  if (!r) return state.isError ? <p role="alert" className="text-destructive">{errorMessage(state.error)}</p> : <div className="skel h-24" />;
  const set = (patch: Partial<Regras>) => setDraft({ ...r, ...patch });
  const field = 'mt-1 w-full h-10 px-3 rounded border border-input bg-card';
  const use = (c: NonNullable<Diagnostico['candidatas']>[number]) => { setDraft({ ...r, ...c.regras }); setTipos(c.regras.tiposMovimento.join(',')); setStatus(c.regras.statusNota.join(',')); };
  return (
    <section className="border-t border-border pt-4 space-y-3" aria-label="Regras de venda e recebimento">
      <h3 className="font-medium">Regras de venda e recebimento {state.data?.personalizada ? '' : <span className="text-xs text-muted-foreground">(padrão do Sankhya, ainda não confirmado)</span>}</h3>
      <form className="grid sm:grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="block text-sm">Data que coloca a venda no mês
          <select className={field} value={r.dataVenda} onChange={e => set({ dataVenda: e.target.value as Regras['dataVenda'] })}><option value="DTNEG">Negociação (DTNEG)</option><option value="DTFATUR">Faturamento (DTFATUR)</option></select></label>
        <label className="block text-sm">Valor do item
          <select className={field} value={r.valorItem} onChange={e => set({ valorItem: e.target.value as Regras['valorItem'] })}><option value="liquido">Total menos desconto</option><option value="bruto">Total sem descontar</option></select></label>
        <label className="block text-sm">Tipos de movimento que são venda (TIPMOV)
          <input className={field} value={tipos ?? r.tiposMovimento.join(', ')} onChange={e => setTipos(e.target.value)} /></label>
        <label className="block text-sm">Status de nota que contam (STATUSNOTA)
          <input className={field} value={status ?? r.statusNota.join(', ')} onChange={e => setStatus(e.target.value)} /></label>
        <label className="block text-sm sm:col-span-2">Operações (CODTIPOPER) que ficam de fora, separadas por vírgula
          <input className={field} inputMode="numeric" value={ops ?? r.operacoesExcluidas.join(', ')} onChange={e => setOps(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.excluirBonificacao} onChange={e => set({ excluirBonificacao: e.target.checked })} />Deixar de fora bonificações</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.incluirProvisao} onChange={e => set({ incluirProvisao: e.target.checked })} />Incluir títulos provisionados no contas a receber</label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button disabled={save.isPending} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{save.isPending ? 'Aplicando…' : 'Salvar e aplicar'}</button>
          {save.isSuccess && <span role="status" className="text-sm">{save.data.aviso ?? 'Regras aplicadas no banco da empresa.'}</span>}
          {save.isError && <span role="alert" className="text-sm text-destructive">{errorMessage(save.error)}</span>}
        </div>
      </form>
      <div className="space-y-2">
        <button type="button" disabled={release.isPending} onClick={() => release.mutate()} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{release.isPending ? 'Verificando…' : 'Liberar a partir das tabelas copiadas'}</button>
        <p className="text-xs text-muted-foreground">Depois da primeira carga: a IA passa a consultar as tabelas copiadas (sem assunto privilegiado), usando a descrição do dicionário do Sankhya e as regras acima como definições.</p>
        {release.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(release.error)}</p>}
        {release.data && <div role="status" className="text-sm space-y-1"><p className={release.data.ok ? 'font-medium' : 'font-medium text-destructive'}>{release.data.ok ? 'Tudo certo: a empresa foi liberada.' : 'Não foi liberada:'}</p>
          <ul>{release.data.passos.map(p => <li key={p.passo}><span className={p.ok ? 'text-chart-4' : 'text-destructive'}>{p.ok ? <Check className="inline h-3.5 w-3.5" aria-label="ok" /> : <X className="inline h-3.5 w-3.5" aria-label="falhou" />}</span> {p.passo}</li>)}</ul>{release.data.problemas.map(p => <p key={p} className="text-destructive">{p}</p>)}</div>}
      </div>
      <form className="grid sm:grid-cols-[10rem_12rem_auto] gap-3 items-end" onSubmit={e => { e.preventDefault(); check.mutate(); }}>
        <label className="block text-sm">Mês de conferência<input type="month" required className={field} value={mes} onChange={e => setMes(e.target.value)} /></label>
        <label className="block text-sm">Total que o cliente confia (R$)<input inputMode="decimal" className={field} placeholder="opcional" value={total} onChange={e => setTotal(e.target.value)} /></label>
        <button disabled={check.isPending || !mes} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">{check.isPending ? 'Conferindo…' : 'Conferir mês'}</button>
      </form>
      {check.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(check.error)}</p>}
      {check.data && (
        <div className="space-y-3 text-sm" role="status">
          <p>Com as regras atuais o mês dá <strong className="num">{money(check.data.totalComRegrasAtuais)}</strong>.</p>
          {check.data.candidatas && (check.data.candidatas.length === 0
            ? <p className="text-destructive">Nenhuma combinação das regras comuns chega nesse total. Veja a tabela abaixo e pergunte ao cliente o que mais entra ou sai.</p>
            : <div className="space-y-1"><p>Combinações que chegam nesse total (a mais simples primeiro; confirme com o cliente qual faz sentido):</p>
              <ul className="space-y-1">{check.data.candidatas.slice(0, 6).map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 border border-border rounded px-3 py-2">
                  <span>{c.regras.dataVenda === 'DTNEG' ? 'negociação' : 'faturamento'} · movimento {c.regras.tiposMovimento.join('+')} · status {c.regras.statusNota.join('+')} · {c.regras.valorItem === 'liquido' ? 'com desconto' : 'sem descontar'}{c.regras.excluirBonificacao ? ' · sem bonificação' : ''}</span>
                  <button type="button" className="ml-auto underline" onClick={() => use(c)}>Usar nas regras</button></li>))}</ul></div>)}
          <table className="w-full text-xs num"><thead><tr className="text-left text-muted-foreground"><th>Data usada</th><th>Mov.</th><th>Status</th><th>Bonif.</th><th className="text-right">Itens</th><th className="text-right">Com desconto</th><th className="text-right">Sem descontar</th></tr></thead>
            <tbody>{check.data.linhas.map((l, i) => <tr key={i} className="border-t border-border"><td>{l.dataUsada}</td><td>{l.tipmov ?? '—'}</td><td>{l.status ?? '—'}</td><td>{l.bonificacao ? 'sim' : 'não'}</td><td className="text-right">{l.itens}</td><td className="text-right">{money(l.liquido)}</td><td className="text-right">{money(l.bruto)}</td></tr>)}</tbody></table>
        </div>
      )}
    </section>
  );
}
