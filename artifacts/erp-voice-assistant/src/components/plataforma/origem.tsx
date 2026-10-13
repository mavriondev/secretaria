import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';

type Carga = { id: number; modo: string; disparo: string; status: string; ok: boolean | null; erro: string | null; iniciadaEm: string; concluidaEm: string | null; relatorio: { tabelas: Array<{ tabela: string; modo: string; lidas: number; ms: number; erro?: string }> } | null };
export type OrigemState = { conectada: boolean; tipo: string; tiposDisponiveis: string[]; assuntos: string[]; intervaloMin: number | null; assuntosDisponiveis: Record<string, string[]> | null; cargas: Carga[] };
const KIND_LABEL: Record<string, string> = { postgres: 'PostgreSQL (o sistema lê)', recebida: 'Enviado pelo cliente (REST)' };

/** Where the company's ERP data comes from and the loads that fill its mirror. */
export function CompanyOrigin({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['plataforma', 'origem', company.id], queryFn: () => api<OrigemState>('GET', `/plataforma/empresas/${company.id}/origem`),
    refetchInterval: q => (q.state.data?.cargas[0]?.status === 'executando' ? 3000 : false) });
  const s = state.data;
  const [url, setUrl] = useState('');
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [interval, setIntervalMin] = useState<string | null>(null);
  const chosen = subjects ?? s?.assuntos ?? [];
  const every = interval ?? (s?.intervaloMin ? String(s.intervaloMin) : '');
  const refresh = () => qc.invalidateQueries({ queryKey: ['plataforma', 'origem', company.id] });
  const save = useMutation({
    mutationFn: () => api('PUT', `/plataforma/empresas/${company.id}/origem`, { ...(url.trim() ? { url: url.trim() } : {}), assuntos: chosen, intervaloMin: every ? Number(every) : null }),
    onSuccess: () => { setUrl(''); setSubjects(null); setIntervalMin(null); refresh(); },
  });
  const load = useMutation({ mutationFn: (modo: 'incremental' | 'completa') => api('POST', `/plataforma/empresas/${company.id}/carga`, { modo }), onSuccess: refresh });
  const running = s?.cargas[0]?.status === 'executando';
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  return (
    <div className="border-t border-border pt-3 space-y-3">
      <h3 className="font-medium">Origem dos dados (ERP do cliente) e cargas</h3>
      <p className="text-xs text-muted-foreground">O sistema lê, somente leitura, as tabelas dos assuntos escolhidos no banco do cliente e mantém uma cópia no banco da empresa. {s?.conectada ? 'Origem cadastrada.' : 'Nenhuma origem cadastrada.'}</p>
      {s && !s.assuntosDisponiveis && <p className="text-sm text-destructive">Ainda não existe pacote de tabelas para o ERP desta empresa ({company.erp}).</p>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="block">Tipo de banco do cliente
          <select disabled className={`${field} h-11`} value={s?.tipo ?? 'postgres'}>{(s?.tiposDisponiveis ?? ['postgres']).map(k => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>
          <span className="text-xs text-muted-foreground">Oracle e SQL Server serão adicionados quando o primeiro cliente nesses bancos for confirmado.</span>
        </label>
        {s?.tipo === 'recebida'
          ? <p className="text-sm text-muted-foreground">Os dados desta empresa são enviados pelo próprio cliente. Veja "Receber dados enviados pelo cliente" abaixo.</p>
          : <label className="block">Endereço de leitura (postgresql://…)
              <input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder={s?.conectada ? 'Deixe em branco para manter o atual' : ''} className={`${field} h-11`} />
            </label>}
        {s?.assuntosDisponiveis && (
          <fieldset className="space-y-1"><legend>Assuntos a copiar</legend>
            {Object.entries(s.assuntosDisponiveis).map(([nome, tabelas]) => (
              <label key={nome} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={chosen.includes(nome)} onChange={e => setSubjects(e.target.checked ? [...chosen, nome] : chosen.filter(x => x !== nome))} />
                <span><span className="font-medium">{nome}</span> <span className="text-xs text-muted-foreground">{tabelas.join(', ')}</span></span></label>))}
          </fieldset>
        )}
        <label className="block">Atualizar a cada (minutos; em branco = só quando eu mandar)
          <input type="number" min={5} max={10080} value={every} onChange={e => setIntervalMin(e.target.value)} className={`${field} h-11 max-w-40`} /></label>
        <div className="flex flex-wrap gap-2 items-center">
          <button disabled={save.isPending} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{save.isPending ? 'Testando e salvando…' : 'Salvar origem'}</button>
          {s?.conectada && s.tipo !== 'recebida' && <>
            <button type="button" disabled={running || load.isPending} onClick={() => load.mutate('incremental')} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">{running ? 'Carregando…' : 'Carregar agora (só o que mudou)'}</button>
            <button type="button" disabled={running || load.isPending} onClick={() => window.confirm('A carga completa refaz cada tabela inteira e pode demorar. Continuar?') && load.mutate('completa')} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">Carga completa</button></>}
        </div>
        {(save.isError || load.isError) && <p role="alert" className="text-destructive">{errorMessage(save.error ?? load.error)}</p>}
      </form>
      {!!s?.cargas.length && (
        <ul className="space-y-2" aria-label="Últimas cargas">{s.cargas.map(c => (
          <li key={c.id} className="text-xs border border-border rounded p-2">
            <p className="num"><span className={c.status === 'executando' ? '' : c.ok ? 'text-chart-4' : 'text-destructive'}>{c.status === 'executando' ? '⏳ em andamento' : c.ok ? '✓ ok' : '✗ com problema'}</span> · {c.modo === 'completa' ? 'completa' : 'incremental'} · {c.disparo} · {new Date(c.iniciadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            {c.erro && <p className="text-destructive">{c.erro}</p>}
            {c.relatorio?.tabelas.map(t => <p key={t.tabela} className={t.erro ? 'text-destructive' : 'text-muted-foreground'}>{t.tabela}: {t.erro ?? `${t.lidas} linhas em ${(t.ms / 1000).toFixed(1)} s`}</p>)}
          </li>))}</ul>
      )}
    </div>
  );
}
