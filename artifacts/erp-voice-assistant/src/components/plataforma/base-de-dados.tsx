import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';

type Report = { ok: boolean; problemas: string[]; passos: Array<{ passo: string; ok: boolean }> };
type DataState = { conectada: boolean; fichaCadastrada: boolean; dadosProntos: boolean; verificadoEm: string | null; erro: string | null; viewsObrigatorias: string[] };

/** Connects a customer's own database and its ficha. The address is sent once, stored encrypted and never shown again. */
export function CompanyData({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['plataforma', 'dados', company.id], queryFn: () => api<DataState>('GET', `/plataforma/empresas/${company.id}/dados`) });
  const [url, setUrl] = useState('');
  const [fichaText, setFichaText] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const done = (r: Report) => { setReport(r); if (r.ok) setUrl(''); qc.invalidateQueries({ queryKey: ['plataforma'] }); };
  const send = useMutation({
    mutationFn: async () => {
      let ficha: unknown;
      if (fichaText.trim()) { try { ficha = JSON.parse(fichaText); } catch { throw new Error('A ficha não é um JSON válido.'); } }
      return api<Report>('PUT', `/plataforma/empresas/${company.id}/dados`, { ...(url.trim() ? { url: url.trim() } : {}), ...(ficha ? { ficha } : {}) });
    },
    onSuccess: done,
    onError: e => { const r = (e as { body?: Report }).body; if (r?.passos) done(r); },
  });
  const recheck = useMutation({ mutationFn: () => api<Report>('POST', `/plataforma/empresas/${company.id}/dados/verificar`), onSuccess: done });
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  const s = state.data;
  return (
    <div className="pl-2 border-l-2 border-border space-y-3 text-sm">
      <p>{s ? (s.dadosProntos ? 'Base conectada e verificada' : s.conectada ? 'Base cadastrada, mas não liberada' : 'Nenhuma base cadastrada') : '…'}
        {s?.verificadoEm && <span className="text-muted-foreground"> · última verificação {new Date(s.verificadoEm).toLocaleString('pt-BR')}</span>}</p>
      {s?.erro && <p className="text-destructive">{s.erro}</p>}
      <p className="text-xs text-muted-foreground">O banco do cliente precisa ter as tabelas ou views descritas na ficha (para uma empresa Sankhya com dados copiados, use "Liberar a partir das tabelas copiadas" mais abaixo), e o usuário informado precisa poder criar papéis e conceder leitura. O endereço é guardado cifrado e nunca é exibido de novo.</p>
      <p className="text-xs rounded border border-border bg-muted/40 p-2">Este é o banco destino (espelho) da empresa: recebe a cópia da origem e guarda as views que a IA consulta. Não é o banco do ERP do cliente. Os passos completos estão na aba Guia de implantação.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); setReport(null); send.mutate(); }}>
        <label className="block">Endereço de conexão (postgresql://…)
          <input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder={s?.conectada ? 'Deixe em branco para manter o atual' : ''} className={`${field} h-11`} />
        </label>
        <label className="block">Ficha de implantação (JSON){s?.fichaCadastrada ? ' — deixe em branco para manter a atual' : ''}
          <textarea rows={6} value={fichaText} onChange={e => setFichaText(e.target.value)} className={`${field} py-2 font-mono text-xs`} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button disabled={send.isPending} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{send.isPending ? 'Verificando…' : 'Verificar e liberar'}</button>
          {s?.conectada && <button type="button" disabled={recheck.isPending} onClick={() => { setReport(null); recheck.mutate(); }} className="h-10 px-4 rounded border border-border hover:bg-muted">Verificar de novo</button>}
        </div>
      </form>
      {(send.isError || recheck.isError) && <p role="alert" className="text-destructive">{errorMessage(send.error ?? recheck.error)}</p>}
      {report && (
        <div role="status" className="space-y-1">
          <p className={report.ok ? 'font-medium' : 'font-medium text-destructive'}>{report.ok ? 'Tudo certo: a empresa foi liberada.' : 'Não foi liberada:'}</p>
          <ul>{report.passos.map(p => <li key={p.passo}><span className={p.ok ? 'text-chart-4' : 'text-destructive'}>{p.ok ? <Check className="inline h-3.5 w-3.5" aria-label="ok" /> : <X className="inline h-3.5 w-3.5" aria-label="falhou" />}</span> {p.passo}</li>)}</ul>
          {report.problemas.map(p => <p key={p} className="text-destructive">{p}</p>)}
        </div>
      )}
    </div>
  );
}
