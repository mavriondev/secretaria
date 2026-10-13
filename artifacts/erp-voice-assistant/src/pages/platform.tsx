import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, ERP_LABEL, PAPEL_LABEL, type Empresa, type Usuario } from '@/lib/auth-client';
import { SecretBox } from '@/components/secret-box';

const ERPS = ['sankhya', 'totvs', 'protheus', 'outro'] as const;
const KEY = ['plataforma', 'empresas'] as const;

/** Product owner: customer companies. Creating one also creates its first administrator and shows the temporary password once. */
export default function Platform() {
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: KEY, queryFn: () => api<Empresa[]>('GET', '/plataforma/empresas') });
  const [form, setForm] = useState({ nome: '', erp: 'sankhya', adminNome: '', adminEmail: '' });
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [dataOpen, setDataOpen] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ empresa: Empresa; administrador: Usuario; senhaTemporaria: string }>('POST', '/plataforma/empresas', {
      nome: form.nome, erp: form.erp, administrador: { nome: form.adminNome, email: form.adminEmail },
    }),
    onSuccess: r => {
      setSecret({ title: `Administrador de ${r.empresa.nome}: ${r.administrador.email}`, password: r.senhaTemporaria });
      setForm({ nome: '', erp: 'sankhya', adminNome: '', adminEmail: '' });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const toggle = useMutation({
    mutationFn: (c: Empresa) => api<Empresa>('PATCH', `/plataforma/empresas/${c.id}`, { ativa: !c.ativa }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const field = 'mt-1 w-full h-11 px-3 rounded border border-input bg-card';
  return (
    <div className="space-y-10">
      <h1 className="display text-3xl">Empresas clientes</h1>
      {secret && <SecretBox title={secret.title} password={secret.password} onClose={() => setSecret(null)} />}

      <section aria-labelledby="nova" className="space-y-4">
        <h2 id="nova" className="display text-xl">Cadastrar empresa</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <label className="text-sm">Nome da empresa
            <input required minLength={2} maxLength={100} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className={field} data-testid="input-empresa" />
          </label>
          <label className="text-sm">ERP que ela usa
            <select value={form.erp} onChange={e => setForm({ ...form, erp: e.target.value })} className={field}>
              {ERPS.map(erp => <option key={erp} value={erp}>{ERP_LABEL[erp]}</option>)}
            </select>
          </label>
          <label className="text-sm">Administrador (nome)
            <input required minLength={2} maxLength={80} value={form.adminNome} onChange={e => setForm({ ...form, adminNome: e.target.value })} className={field} />
          </label>
          <label className="text-sm">Administrador (e-mail)
            <input required type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className={field} />
          </label>
          <div className="sm:col-span-2 flex items-center gap-4">
            <button disabled={create.isPending} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-criar-empresa">
              {create.isPending ? 'Criando…' : 'Criar empresa e administrador'}
            </button>
            {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
          </div>
        </form>
        <p className="text-xs text-muted-foreground">A empresa nasce sem base de dados conectada: a IA só responde para ela depois da implantação (exportação do ERP e ficha de dados).</p>
      </section>

      <section aria-labelledby="lista" className="space-y-3">
        <h2 id="lista" className="display text-xl">Empresas cadastradas</h2>
        {companies.isLoading && <div className="skel h-24" />}
        {companies.isError && <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => companies.refetch()}>Tentar novamente</button></p>}
        <ul className="divide-y divide-border border border-border rounded">
          {companies.data?.map(c => (
            <li key={c.id} className="p-3 space-y-2" data-testid={`empresa-${c.id}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">{c.nome}</span>
                <span className="text-xs text-muted-foreground">{ERP_LABEL[c.erp] ?? c.erp} · {c.usuarios} usuário(s)</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${c.dadosProntos ? 'border-chart-4' : 'border-border text-muted-foreground'}`}>{c.dadosProntos ? 'Base conectada' : 'Base não conectada'}</span>
                {!c.ativa && <span className="text-xs px-2 py-0.5 rounded border border-destructive text-destructive">Desativada</span>}
                <span className="ml-auto flex gap-2">
                  <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Fechar' : 'Usuários'}</button>
                  <LimitField company={c} />
                  {c.id !== 1 && <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" onClick={() => setDataOpen(dataOpen === c.id ? null : c.id)}>Base de dados</button>}
                  {c.id !== 1 && <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>{c.ativa ? 'Desativar' : 'Reativar'}</button>}
                </span>
              </div>
              {dataOpen === c.id && <CompanyData company={c} />}
              {open === c.id && <CompanyUsers company={c} onSecret={setSecret} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CompanyUsers({ company, onSecret }: { company: Empresa; onSecret: (s: { title: string; password: string }) => void }) {
  const users = useQuery({ queryKey: ['plataforma', 'usuarios', company.id], queryFn: () => api<Usuario[]>('GET', `/plataforma/empresas/${company.id}/usuarios`) });
  const reset = useMutation({
    mutationFn: (u: Usuario) => api<{ senhaTemporaria: string }>('POST', `/plataforma/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (r, u) => onSecret({ title: `Nova senha temporária de ${u.email}`, password: r.senhaTemporaria }),
  });
  if (users.isLoading) return <div className="skel h-12" />;
  return (
    <ul className="text-sm space-y-1 pl-2 border-l-2 border-border">
      {users.data?.map(u => (
        <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
          <span>{u.nome}</span><span className="text-muted-foreground">{u.email}</span>
          <span className="text-xs">{PAPEL_LABEL[u.papel]}{!u.ativo ? ' · inativo' : ''}{u.trocarSenha ? ' · ainda não entrou' : ''}</span>
          <button className="ml-auto h-8 px-3 rounded border border-border hover:bg-muted" disabled={reset.isPending} onClick={() => reset.mutate(u)}>Redefinir senha</button>
        </li>
      ))}
      {reset.isError && <li role="alert" className="text-destructive">{errorMessage(reset.error)}</li>}
    </ul>
  );
}

type Report = { ok: boolean; problemas: string[]; passos: Array<{ passo: string; ok: boolean }> };
type DataState = { conectada: boolean; fichaCadastrada: boolean; dadosProntos: boolean; verificadoEm: string | null; erro: string | null; viewsObrigatorias: string[] };

/** Connects a customer's own database and its ficha. The address is sent once, stored encrypted and never shown again. */
function CompanyData({ company }: { company: Empresa }) {
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
      <p className="text-xs text-muted-foreground">O banco do cliente precisa ter as views {s?.viewsObrigatorias.join(' e ')} além das descritas na ficha, e o usuário informado precisa poder criar papéis e conceder leitura. O endereço é guardado cifrado e nunca é exibido de novo.</p>
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
      <CompanyOrigin company={company} />
      {report && (
        <div role="status" className="space-y-1">
          <p className={report.ok ? 'font-medium' : 'font-medium text-destructive'}>{report.ok ? 'Tudo certo: a empresa foi liberada.' : 'Não foi liberada:'}</p>
          <ul>{report.passos.map(p => <li key={p.passo}>{p.ok ? '✓' : '✗'} {p.passo}</li>)}</ul>
          {report.problemas.map(p => <p key={p} className="text-destructive">{p}</p>)}
        </div>
      )}
    </div>
  );
}

type Carga = { id: number; modo: string; disparo: string; status: string; ok: boolean | null; erro: string | null; iniciadaEm: string; concluidaEm: string | null; relatorio: { tabelas: Array<{ tabela: string; modo: string; lidas: number; ms: number; erro?: string }> } | null };
type OrigemState = { conectada: boolean; tipo: string; tiposDisponiveis: string[]; assuntos: string[]; intervaloMin: number | null; assuntosDisponiveis: Record<string, string[]> | null; cargas: Carga[] };
const KIND_LABEL: Record<string, string> = { postgres: 'PostgreSQL' };

/** Where the company's ERP data comes from and the loads that fill its mirror. */
function CompanyOrigin({ company }: { company: Empresa }) {
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
        <label className="block">Endereço de leitura (postgresql://…)
          <input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder={s?.conectada ? 'Deixe em branco para manter o atual' : ''} className={`${field} h-11`} />
        </label>
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
          {s?.conectada && <>
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

/** Monthly ceiling on what the company's answers may cost, in US dollars. Empty means no ceiling. */
function LimitField({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(company.limiteMensalUsd === null || company.limiteMensalUsd === undefined ? '' : String(company.limiteMensalUsd));
  const save = useMutation({
    mutationFn: () => api<Empresa>('PATCH', `/plataforma/empresas/${company.id}`, { limiteMensalUsd: value.trim() === '' ? null : Number(value.replace(',', '.')) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const invalid = value.trim() !== '' && !(Number(value.replace(',', '.')) >= 0);
  return (
    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (!invalid) save.mutate(); }}>
      <label className="text-xs text-muted-foreground" htmlFor={`lim-${company.id}`}>Limite/mês US$</label>
      <input id={`lim-${company.id}`} inputMode="decimal" placeholder="sem limite" value={value} onChange={e => setValue(e.target.value)} className="h-8 w-24 px-2 rounded border border-input bg-card text-sm num" aria-invalid={invalid} />
      <button className="h-8 px-2 rounded border border-border text-sm hover:bg-muted" disabled={save.isPending || invalid}>{save.isPending ? '…' : 'Salvar'}</button>
      {save.isError && <span className="text-xs text-destructive">{errorMessage(save.error)}</span>}
    </form>
  );
}
