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
      <p className="text-xs text-muted-foreground">O banco do cliente precisa ter as tabelas ou views descritas na ficha (para uma empresa Sankhya com dados copiados, use "Liberar a partir das tabelas copiadas" mais abaixo), e o usuário informado precisa poder criar papéis e conceder leitura. O endereço é guardado cifrado e nunca é exibido de novo.</p>
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
      <CompanyRecebimento company={company} />
      <CompanyImplantacao company={company} />
      {company.erp === 'sankhya' && <CompanyRules company={company} />}
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
const KIND_LABEL: Record<string, string> = { postgres: 'PostgreSQL (o sistema lê)', recebida: 'Enviado pelo cliente (REST)' };

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

/** Monthly ceiling on what the company's answers may cost, in US dollars. Empty means no ceiling. */
type Recebimento = { ativa: boolean; prefixo: string | null; geradaEm: string | null; recebimentos: Array<{ tabela: string; recebidoEm: string | null }> | null };

/** For customers whose side sends the data: the key the sending job uses, and when each table last arrived. */
function CompanyRecebimento({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'ingestao', company.id];
  const state = useQuery({ queryKey: key, queryFn: () => api<Recebimento>('GET', `/plataforma/empresas/${company.id}/ingestao`) });
  const [intervalo, setIntervalo] = useState('60');
  const [chave, setChave] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['plataforma'] });
  const gerar = useMutation({
    mutationFn: () => api<{ chave: string }>('POST', `/plataforma/empresas/${company.id}/ingestao/chave`, { intervaloMin: Number(intervalo) || undefined }),
    onSuccess: r => { setChave(r.chave); refresh(); },
  });
  const revogar = useMutation({ mutationFn: () => api('POST', `/plataforma/empresas/${company.id}/ingestao/revogar`), onSuccess: () => { setChave(null); refresh(); } });
  const s = state.data;
  const endereco = `${window.location.origin}/api/ingestao`;
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  return (
    <section className="border-t border-border pt-3 space-y-3" aria-label="Receber dados enviados pelo cliente">
      <h3 className="font-medium">Receber dados enviados pelo cliente</h3>
      <p className="text-xs text-muted-foreground">Para quando o cliente não libera acesso ao banco: o analista dele agenda uma rotina que envia os dados por HTTPS para o endereço abaixo, com uma chave que só serve para enviar. Gerar a chave coloca a empresa neste modo. Escolha também os assuntos em "Origem dos dados".</p>
      <p className="text-sm">Endereço de envio: <code className="text-xs break-all">{endereco}</code></p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Envio esperado a cada (min)
          <input type="number" min={5} max={10080} value={intervalo} onChange={e => setIntervalo(e.target.value)} className={`${field} h-10 max-w-32`} /></label>
        <button disabled={gerar.isPending} onClick={() => (!s?.ativa || window.confirm('Gerar outra chave invalida a atual e o envio para até ser configurado de novo. Continuar?')) && gerar.mutate()} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{s?.ativa ? 'Gerar nova chave' : 'Gerar chave de envio'}</button>
        {s?.ativa && <button disabled={revogar.isPending} onClick={() => window.confirm('Revogar a chave? O cliente deixa de poder enviar.') && revogar.mutate()} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">Revogar</button>}
      </div>
      {chave && (
        <div role="status" className="rounded border border-border p-3 space-y-1">
          <p className="text-sm font-medium">Chave de envio (aparece só agora; envie ao analista por um canal seguro):</p>
          <code className="block break-all text-xs select-all">{chave}</code>
        </div>)}
      {(gerar.isError || revogar.isError) && <p role="alert" className="text-destructive">{errorMessage(gerar.error ?? revogar.error)}</p>}
      {s?.ativa && <p className="text-sm text-muted-foreground">Chave ativa {s.prefixo}… gerada em {s.geradaEm ? new Date(s.geradaEm).toLocaleString('pt-BR') : '—'}.</p>}
      {s?.ativa && (s.recebimentos?.length
        ? <ul className="text-xs space-y-0.5" aria-label="Últimos recebimentos">{s.recebimentos.map(r => <li key={r.tabela}>{r.tabela}: {r.recebidoEm ? new Date(r.recebidoEm).toLocaleString('pt-BR') : 'nunca'}</li>)}</ul>
        : <p className="text-xs text-muted-foreground">Nada recebido ainda.</p>)}
    </section>
  );
}

type Proposta = {
  status: 'analisando' | 'erro' | 'pronta'; progresso?: string; erro?: string; esquema?: string; custoUsd?: number; criadaEm?: string; aprovada?: { em: string; tabelas: number } | null;
  ignoradas?: Array<{ nome: string; motivo: string }>;
  tabelas?: Array<{ nome: string; linhas: number | null; descricao: string; incluir: boolean; motivo: string; colunas: number; omitidas: number; incremental: string | null }>;
};
const MOSTRAR_ATE = 300;

/** The implantation agent: reads the structure of the customer's database, proposes the tables to copy, and waits for a person to approve. */
function CompanyImplantacao({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'implantacao', company.id];
  const state = useQuery({ queryKey: key, queryFn: () => api<{ estado: Proposta | null; pacotePropriario: boolean }>('GET', `/plataforma/empresas/${company.id}/implantacao`),
    refetchInterval: q => (q.state.data?.estado?.status === 'analisando' ? 3000 : false) });
  const origem = qc.getQueryData<OrigemState>(['plataforma', 'origem', company.id]);
  const e = state.data?.estado ?? null;
  const [esquema, setEsquema] = useState('public'); const [contexto, setContexto] = useState('');
  const [escolha, setEscolha] = useState<Set<string> | null>(null); const [filtro, setFiltro] = useState('');
  const marcadas = escolha ?? new Set((e?.tabelas ?? []).filter(t => t.incluir).map(t => t.nome));
  const refresh = () => { setEscolha(null); qc.invalidateQueries({ queryKey: ['plataforma'] }); };
  const analisar = useMutation({ mutationFn: () => api('POST', `/plataforma/empresas/${company.id}/implantacao/analisar`, { esquema, contexto }), onSuccess: refresh });
  const aprovar = useMutation({
    mutationFn: async () => { await api('PUT', `/plataforma/empresas/${company.id}/implantacao/tabelas`, { incluir: [...marcadas] }); return api('POST', `/plataforma/empresas/${company.id}/implantacao/aprovar`); },
    onSuccess: refresh,
  });
  const liberar = useMutation({
    mutationFn: () => api<{ ok: boolean; problemas: string[] }>('POST', `/plataforma/empresas/${company.id}/liberar-do-espelho`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plataforma'] }),
  });
  const visiveis = (e?.tabelas ?? []).filter(t => !filtro.trim() || `${t.nome} ${t.descricao}`.toLowerCase().includes(filtro.trim().toLowerCase()));
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  const nome = (n: number | null) => (n === null ? 'tamanho desconhecido' : `${n.toLocaleString('pt-BR')} linhas`);
  return (
    <section className="border-t border-border pt-3 space-y-3" aria-label="Implantação assistida">
      <h3 className="font-medium">Implantação assistida (agente de IA)</h3>
      <p className="text-xs text-muted-foreground">O agente lê somente a estrutura do banco do cliente (nomes de tabelas e colunas, tipos, chaves e quantidade de linhas), nunca o conteúdo. Ele propõe quais tabelas copiar e descreve cada uma. Nada é copiado até você aprovar. Colunas de senha e de conteúdo binário nunca são copiadas.</p>
      {!origem?.conectada && <p className="text-sm text-muted-foreground">Cadastre o endereço de leitura em "Origem dos dados" acima antes de analisar.</p>}
      <form className="grid sm:grid-cols-2 gap-3" onSubmit={ev => { ev.preventDefault(); analisar.mutate(); }}>
        <label className="block text-sm">Esquema do banco do cliente
          <input className={`${field} h-10`} value={esquema} onChange={ev => setEsquema(ev.target.value)} /></label>
        <label className="block text-sm sm:col-span-2">O que a empresa faz e o que o gestor costuma perguntar (ajuda o agente, opcional)
          <textarea rows={2} maxLength={1000} className={`${field} py-2`} value={contexto} onChange={ev => setContexto(ev.target.value)} placeholder="Ex.: distribuidora de alimentos; vendas, estoque, compras e contas a receber" /></label>
        <div><button disabled={analisar.isPending || e?.status === 'analisando' || !origem?.conectada} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{e ? 'Analisar de novo' : 'Analisar o banco do cliente'}</button></div>
      </form>
      {analisar.isError && <p role="alert" className="text-destructive">{errorMessage(analisar.error)}</p>}
      {e?.status === 'analisando' && <p role="status">⏳ Analisando… {e.progresso}</p>}
      {e?.status === 'erro' && <p role="alert" className="text-destructive">A análise falhou: {e.erro}</p>}
      {e?.status === 'pronta' && e.tabelas && (
        <div className="space-y-2">
          <p className="text-sm">O agente analisou {e.tabelas.length + (e.ignoradas?.length ?? 0)} tabelas do esquema "{e.esquema}" e propõe copiar <strong>{e.tabelas.filter(t => t.incluir).length}</strong>. Custo da análise: US$ {e.custoUsd?.toFixed(2)}.</p>
          <input aria-label="Filtrar tabelas" placeholder="Filtrar por nome ou descrição" className={`${field} h-10`} value={filtro} onChange={ev => setFiltro(ev.target.value)} />
          <ul className="max-h-96 overflow-auto border border-border rounded divide-y divide-border">{visiveis.slice(0, MOSTRAR_ATE).map(t => (
            <li key={t.nome} className="p-2 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={marcadas.has(t.nome)} onChange={ev => { const n = new Set(marcadas); if (ev.target.checked) n.add(t.nome); else n.delete(t.nome); setEscolha(n); }} />
                <span><span className="font-medium">{t.nome}</span> <span className="text-xs text-muted-foreground">{nome(t.linhas)} · {t.colunas} colunas · {t.incremental ? `muda em ${t.incremental}` : 'relida inteira a cada carga'}</span>
                  <span className="block text-xs text-muted-foreground">{t.descricao || 'Sem descrição.'} {t.motivo}</span></span></label>
            </li>))}</ul>
          {visiveis.length > MOSTRAR_ATE && <p className="text-xs text-muted-foreground">Mostrando {MOSTRAR_ATE} de {visiveis.length}. Use o filtro para achar as outras.</p>}
          {!!e.ignoradas?.length && <details className="text-xs text-muted-foreground"><summary>{e.ignoradas.length} tabelas que não podem ser copiadas</summary>
            <ul className="mt-1 space-y-0.5">{e.ignoradas.slice(0, 200).map(i => <li key={i.nome}>{i.nome}: {i.motivo}</li>)}</ul></details>}
          <div className="flex flex-wrap gap-2 items-center">
            <button disabled={aprovar.isPending || !marcadas.size} onClick={() => window.confirm(`Aprovar a cópia de ${marcadas.size} tabelas? A próxima carga copia exatamente estas.`) && aprovar.mutate()} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{aprovar.isPending ? 'Salvando…' : `Aprovar ${marcadas.size} tabelas`}</button>
            {e.aprovada && <span className="text-sm">✓ {e.aprovada.tabelas} tabelas aprovadas. Agora use "Carga completa" em Origem dos dados.</span>}
          </div>
          {aprovar.isError && <p role="alert" className="text-destructive">{errorMessage(aprovar.error)}</p>}
          {e.aprovada && company.erp !== 'sankhya' && (
            <div className="space-y-1">
              <button disabled={liberar.isPending} onClick={() => liberar.mutate()} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">{liberar.isPending ? 'Verificando…' : 'Liberar a partir das tabelas copiadas'}</button>
              <span className="text-xs text-muted-foreground block">Use depois que a carga completa terminar.</span>
              {liberar.data && <p className={liberar.data.ok ? '' : 'text-destructive'}>{liberar.data.ok ? 'Empresa liberada.' : liberar.data.problemas.join(' ')}</p>}
              {liberar.isError && <p role="alert" className="text-destructive">{errorMessage(liberar.error)}</p>}
            </div>)}
        </div>
      )}
    </section>
  );
}

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

type Regras = { dataVenda: 'DTNEG' | 'DTFATUR'; tiposMovimento: string[]; statusNota: string[]; valorItem: 'liquido' | 'bruto'; operacoesExcluidas: number[]; excluirBonificacao: boolean; empresas: number[] | null; incluirProvisao: boolean };
type Diagnostico = {
  mes: string; totalComRegrasAtuais: number | null;
  linhas: Array<{ tipmov: string | null; status: string | null; bonificacao: boolean; dataUsada: string; liquido: number; bruto: number; itens: number }>;
  candidatas: Array<{ regras: Pick<Regras, 'dataVenda' | 'tiposMovimento' | 'statusNota' | 'valorItem' | 'excluirBonificacao'>; total: number; diferenca: number }> | null;
};
const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const codes = (v: string) => v.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);

/** What counts as a sale and a receivable for a Sankhya company, and a way to prove it against a month the customer already trusts. */
function CompanyRules({ company }: { company: Empresa }) {
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
          <ul>{release.data.passos.map(p => <li key={p.passo}>{p.ok ? '✓' : '✗'} {p.passo}</li>)}</ul>{release.data.problemas.map(p => <p key={p} className="text-destructive">{p}</p>)}</div>}
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
