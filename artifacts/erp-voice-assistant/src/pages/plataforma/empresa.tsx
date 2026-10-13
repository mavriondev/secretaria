import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage, ERP_LABEL, type Empresa } from '@/lib/auth-client';
import { EMPRESAS_KEY, useEmpresas, useResumo, usd, quando } from '@/lib/plataforma';
import { SecretBox } from '@/components/secret-box';
import { StatusPill } from '@/components/plataforma/status-pill';
import { CompanyUsers } from '@/components/plataforma/usuarios';
import { CompanyData } from '@/components/plataforma/base-de-dados';
import { CompanyOrigin } from '@/components/plataforma/origem';
import { CompanyRecebimento } from '@/components/plataforma/recebimento';
import { CompanyImplantacao } from '@/components/plataforma/implantacao';
import { CompanyRules } from '@/components/plataforma/regras';
import { LimitField } from '@/components/plataforma/limite';

const ABAS = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'usuarios', label: 'Usuários' },
  { id: 'base', label: 'Base de dados' },
  { id: 'origem', label: 'Origem e cargas' },
  { id: 'recebimento', label: 'Recebimento' },
  { id: 'implantacao', label: 'Implantação' },
  { id: 'regras', label: 'Regras' },
  { id: 'config', label: 'Configurações' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

/** One customer company: a summary first, then each tool in its own tab instead of everything stacked in one list row. */
export default function EmpresaPage({ id }: { id: number }) {
  const empresas = useEmpresas();
  const search = useSearch();
  const [, navigate] = useLocation();
  const aba = (new URLSearchParams(search).get('aba') as Aba | null) ?? 'resumo';
  const setAba = (a: Aba) => navigate(`/plataforma/empresas/${id}${a === 'resumo' ? '' : `?aba=${a}`}`, { replace: true });
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const company = empresas.data?.find(c => c.id === id);
  if (empresas.isLoading) return <div className="skel h-40" />;
  if (!company) return <p className="text-sm">Empresa não encontrada. <Link href="/plataforma" className="underline">Voltar</Link></p>;
  const demo = company.id === 1;
  const abas = ABAS.filter(a => !(demo && ['base', 'origem', 'recebimento', 'implantacao', 'regras'].includes(a.id)) && !(a.id === 'regras' && company.erp !== 'sankhya'));
  return (
    <div className="space-y-6">
      <Link href="/plataforma" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />Visão geral</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl">{company.nome}</h1>
          <p className="text-sm text-muted-foreground">{ERP_LABEL[company.erp] ?? company.erp} · {company.usuarios} usuário(s) · cadastrada em {new Date(company.criadaEm).toLocaleDateString('pt-BR')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={company.dadosProntos ? 'ok' : 'muted'}>{company.dadosProntos ? 'Base liberada' : 'Sem base'}</StatusPill>
          {!company.ativa && <StatusPill tone="bad">Desativada</StatusPill>}
        </div>
      </header>
      {secret && <SecretBox title={secret.title} password={secret.password} onClose={() => setSecret(null)} />}

      <nav aria-label="Seções da empresa" className="border-b border-border overflow-x-auto overflow-y-hidden">
        <ul className="flex gap-1 min-w-max">
          {abas.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => setAba(a.id)} aria-current={aba === a.id ? 'page' : undefined} data-testid={`aba-${a.id}`}
                className={`px-3 h-10 text-sm border-b-2 -mb-px transition-colors ${aba === a.id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{a.label}</button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="rounded border border-border bg-card p-4 md:p-6">
        {aba === 'resumo' && <Resumo company={company} onGo={setAba} />}
        {aba === 'usuarios' && <CompanyUsers company={company} onSecret={setSecret} />}
        {aba === 'base' && <CompanyData company={company} />}
        {aba === 'origem' && <CompanyOrigin company={company} />}
        {aba === 'recebimento' && <CompanyRecebimento company={company} />}
        {aba === 'implantacao' && <CompanyImplantacao company={company} />}
        {aba === 'regras' && <CompanyRules company={company} />}
        {aba === 'config' && <Config company={company} />}
      </section>
    </div>
  );
}

function Resumo({ company, onGo }: { company: Empresa; onGo: (a: Aba) => void }) {
  const resumo = useResumo(company.id);
  const r = resumo.data;
  if (resumo.isLoading) return <div className="skel h-24" />;
  if (!r) return <p className="text-sm text-destructive">{errorMessage(resumo.error)}</p>;
  const item = (label: string, value: string, go?: Aba, tone?: 'ok' | 'bad' | 'warn') => (
    <div className="rounded border border-border p-3 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
      {go && <button type="button" className="text-xs underline text-muted-foreground" onClick={() => onGo(go)}>abrir</button>}
    </div>
  );
  const dados = r.dadosProntos ? 'Liberada para a IA' : r.baseConectada ? 'Cadastrada, não liberada' : 'Não conectada';
  const origem = r.origem === 'recebida' ? (r.recebendo ? 'Cliente envia por REST (chave ativa)' : 'Cliente envia por REST (sem chave)') : r.assuntos.length ? `Leitura PostgreSQL · ${r.assuntos.join(', ')}` : 'Não configurada';
  const carga = r.ultimaCarga ? `${r.ultimaCarga.status === 'executando' ? 'em andamento' : r.ultimaCarga.ok ? 'ok' : 'com problema'} · ${quando(r.ultimaCarga.iniciadaEm)}` : 'nenhuma';
  const limite = r.limite.limiteUsd === null ? `${usd(r.limite.usadoUsd)} no mês · sem teto` : `${usd(r.limite.usadoUsd)} de ${usd(r.limite.limiteUsd)} (${r.limite.percentual}%)`;
  return (
    <div className="space-y-4">
      {r.erroDados && <p role="alert" className="text-sm text-destructive">{r.erroDados}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {item('Base de dados', dados, company.id === 1 ? undefined : 'base', r.dadosProntos ? 'ok' : undefined)}
        {company.id !== 1 && item('Origem dos dados', origem, r.origem === 'recebida' ? 'recebimento' : 'origem')}
        {company.id !== 1 && item('Última carga', carga, 'origem', r.ultimaCarga && r.ultimaCarga.ok === false ? 'bad' : undefined)}
        {item('Usuários', `${r.usuarios.ativos} ativos${r.usuarios.pendentes ? ` · ${r.usuarios.pendentes} ainda não entraram` : ''}`, 'usuarios')}
        {item('Uso em 30 dias', `${r.uso30d.respostas} respostas · ${usd(r.uso30d.custoUsd)}${r.uso30d.ultimaResposta ? ` · última ${quando(r.uso30d.ultimaResposta)}` : ''}`)}
        {item('Limite mensal', limite, 'config', r.limite.bloqueado ? 'bad' : r.limite.aviso ? 'warn' : undefined)}
      </div>
    </div>
  );
}

function Config({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(company.nome);
  const rename = useMutation({ mutationFn: () => api<Empresa>('PATCH', `/plataforma/empresas/${company.id}`, { nome: nome.trim() }), onSuccess: () => qc.invalidateQueries({ queryKey: EMPRESAS_KEY }) });
  const toggle = useMutation({ mutationFn: () => api<Empresa>('PATCH', `/plataforma/empresas/${company.id}`, { ativa: !company.ativa }), onSuccess: () => qc.invalidateQueries({ queryKey: EMPRESAS_KEY }) });
  return (
    <div className="space-y-6 text-sm">
      <form className="space-y-2 max-w-md" onSubmit={e => { e.preventDefault(); rename.mutate(); }}>
        <label className="block">Nome da empresa
          <input minLength={2} maxLength={100} value={nome} onChange={e => setNome(e.target.value)} className="mt-1 w-full h-10 px-3 rounded border border-input bg-card" /></label>
        <button disabled={rename.isPending || nome.trim() === company.nome || nome.trim().length < 2} className="h-9 px-3 rounded border border-border hover:bg-muted disabled:opacity-50">Salvar nome</button>
        {rename.isError && <p role="alert" className="text-destructive">{errorMessage(rename.error)}</p>}
      </form>
      <div className="space-y-1">
        <h3 className="font-medium">Limite mensal de custo</h3>
        <p className="text-xs text-muted-foreground">Teto, em dólares, do que as respostas desta empresa podem custar por mês. Em branco, sem teto. Ao atingir, a IA para de responder até o dia 1.</p>
        <LimitField company={company} />
      </div>
      {company.id !== 1 && (
        <div className="space-y-1">
          <h3 className="font-medium">{company.ativa ? 'Desativar empresa' : 'Reativar empresa'}</h3>
          <p className="text-xs text-muted-foreground">{company.ativa ? 'Os usuários dela deixam de entrar; dados e configurações ficam guardados.' : 'Os usuários voltam a poder entrar.'}</p>
          <button type="button" disabled={toggle.isPending} onClick={() => window.confirm(company.ativa ? `Desativar ${company.nome}?` : `Reativar ${company.nome}?`) && toggle.mutate()}
            className={`h-9 px-3 rounded border text-sm ${company.ativa ? 'border-destructive text-destructive hover:bg-destructive/10' : 'border-border hover:bg-muted'} disabled:opacity-50`}>{company.ativa ? 'Desativar' : 'Reativar'}</button>
          {toggle.isError && <p role="alert" className="text-destructive">{errorMessage(toggle.error)}</p>}
        </div>
      )}
    </div>
  );
}
