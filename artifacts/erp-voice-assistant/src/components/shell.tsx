import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ListChecks, HeartPulse, Gauge, Flag, Database, Settings, ScaleIcon, History, Info, Home, BookOpen, Users, Building2, LogOut, Menu, X, LayoutDashboard, Plus, Activity, Wallet } from 'lucide-react';
import { useGetDemoStatus, useHealthCheck } from '@workspace/api-client-react';
import { Wordmark } from '@/components/brand-mark';
import { fmtDateTime } from '@/lib/format';
import { useLogout, useMe } from '@/lib/auth-client';
import { useEmpresas } from '@/lib/plataforma';

const companyNav = [
  { href: '/admin', label: 'Configurações', icon: Settings },
  { href: '/admin/usuarios', label: 'Usuários', icon: Users },
  { href: '/admin/dados', label: 'Dados', icon: Database },
  { href: '/admin/saude', label: 'Saúde dos dados', icon: HeartPulse },
  { href: '/admin/testes', label: 'Perguntas de teste', icon: ListChecks },
  { href: '/admin/uso', label: 'Custo e tempo', icon: Gauge },
  { href: '/admin/avaliacoes', label: 'Respostas ruins', icon: Flag },
  { href: '/admin/conhecimento', label: 'Conhecimento', icon: BookOpen },
  { href: '/admin/conferencia', label: 'Conferência', icon: ScaleIcon },
  { href: '/admin/logs', label: 'Auditoria', icon: History },
  { href: '/', label: 'Início', icon: Home },
];
const ownerSystemNav = [
  { href: '/plataforma', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/plataforma/uso', label: 'Uso e custo', icon: Wallet },
  { href: '/plataforma/sistema', label: 'Diagnóstico', icon: Activity },
];
const linkClass = (active: boolean) => `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors border-l-2 ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-primary font-medium [&>svg]:text-sidebar-primary' : 'border-transparent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60'}`;

/** The owner's menu: the system's own tools, then every customer company as its own entry. */
function OwnerMobileMenu({ loc }: { loc: string }) {
  const empresas = useEmpresas();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc]);
  const item = 'flex items-center gap-2 px-3 py-3 rounded text-sm hover:bg-sidebar-accent/60';
  return (
    <div className="md:hidden ml-auto flex items-center pr-2">
      <button type="button" aria-expanded={open} aria-controls="menu-dono" onClick={() => setOpen(o => !o)} data-testid="button-menu" className="inline-flex items-center gap-2 h-10 px-3 rounded text-sm hover:bg-sidebar-accent/60">
        {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}{open ? 'Fechar' : 'Menu'}
      </button>
      {open && (
        <nav id="menu-dono" aria-label="Menu do dono" className="absolute left-0 right-0 top-full max-h-[80dvh] overflow-y-auto bg-sidebar text-sidebar-foreground border-t border-sidebar-border p-2 shadow-lg">
          <div className="px-3 pt-1 text-[11px] uppercase tracking-wide opacity-70">Sistema</div>
          {ownerSystemNav.map(n => <Link key={n.href} href={n.href} className={item}><n.icon className="h-4 w-4" aria-hidden />{n.label}</Link>)}
          <div className="px-3 pt-3 text-[11px] uppercase tracking-wide opacity-70">Empresas</div>
          {empresas.data?.map(c => <Link key={c.id} href={`/plataforma/empresas/${c.id}`} className={item}><Building2 className="h-4 w-4 shrink-0" aria-hidden /><span className={c.ativa ? '' : 'line-through opacity-60'}>{c.nome}</span></Link>)}
          <Link href="/plataforma/empresas/nova" className={item}><Plus className="h-4 w-4" aria-hidden />Nova empresa</Link>
          <button type="button" onClick={() => logout.mutate()} className={`${item} w-full border-t border-sidebar-border mt-2`} data-testid="button-sair-mobile"><LogOut className="h-4 w-4" aria-hidden />Sair</button>
        </nav>
      )}
    </div>
  );
}

/** Company admin on phones: the same eleven destinations in a drop-down list instead of an overflowing icon row. */
function CompanyMobileMenu({ loc }: { loc: string }) {
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc]);
  const item = (active: boolean) => `flex items-center gap-3 px-3 py-3 rounded text-sm ${active ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'hover:bg-sidebar-accent/60'}`;
  return (
    <div className="md:hidden ml-auto flex items-center pr-2">
      <button type="button" aria-expanded={open} aria-controls="menu-empresa" onClick={() => setOpen(o => !o)} data-testid="button-menu" className="inline-flex items-center gap-2 h-11 px-3 rounded text-sm hover:bg-sidebar-accent/60">
        {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}{open ? 'Fechar' : 'Menu'}
      </button>
      {open && (
        <nav id="menu-empresa" aria-label="Principal" className="absolute left-0 right-0 top-full max-h-[80dvh] overflow-y-auto bg-sidebar text-sidebar-foreground border-t border-b border-sidebar-border p-2 shadow-2xl">
          {companyNav.map(n => <Link key={n.href} href={n.href} data-testid={`link-${n.label.toLowerCase()}`} className={item(loc === n.href)}><n.icon className="h-4 w-4" aria-hidden />{n.label}</Link>)}
          <button type="button" onClick={() => logout.mutate()} className={`${item(false)} w-full border-t border-sidebar-border mt-2`} data-testid="button-sair-mobile"><LogOut className="h-4 w-4" aria-hidden />Sair</button>
        </nav>
      )}
    </div>
  );
}

function OwnerNav({ loc }: { loc: string }) {
  const empresas = useEmpresas();
  const companyActive = (id: number) => loc === `/plataforma/empresas/${id}` || loc.startsWith(`/plataforma/empresas/${id}?`);
  return (
    <><OwnerMobileMenu loc={loc} /><nav aria-label="Principal" className="hidden md:flex md:flex-col gap-1 p-2 md:p-3 flex-1 items-center md:items-stretch ml-auto md:ml-0 md:overflow-y-auto">
      <div className="hidden md:block px-3 pt-1 pb-1 text-[11px] uppercase tracking-wide opacity-60">Sistema</div>
      {ownerSystemNav.map(n => (
        <Link key={n.href} href={n.href} data-testid={`link-${n.label.toLowerCase()}`} className={linkClass(loc === n.href)}>
          <n.icon className="h-4 w-4" /><span className="hidden sm:inline">{n.label}</span>
        </Link>
      ))}
      <div className="hidden md:flex items-center justify-between px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide opacity-60">
        <span>Empresas</span>
        <Link href="/plataforma/empresas/nova" aria-label="Nova empresa" title="Nova empresa" className="opacity-100 hover:bg-sidebar-accent rounded p-0.5"><Plus className="h-3.5 w-3.5" /></Link>
      </div>
      {empresas.data?.map(c => (
        <Link key={c.id} href={`/plataforma/empresas/${c.id}`} data-testid={`link-empresa-${c.id}`} className={linkClass(companyActive(c.id))} title={c.nome}>
          <Building2 className={`h-4 w-4 shrink-0 ${c.ativa ? '' : 'opacity-40'}`} />
          <span className={`hidden sm:inline truncate ${c.ativa ? '' : 'opacity-60 line-through'}`}>{c.nome}</span>
          {!c.dadosProntos && c.ativa && <span className="hidden md:inline ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary/70" title="Base não liberada" />}
        </Link>
      ))}
      <Link href="/plataforma/empresas/nova" className={`md:hidden ${linkClass(loc === '/plataforma/empresas/nova')}`} aria-label="Nova empresa"><Plus className="h-4 w-4" /></Link>
    </nav></>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const me = useMe().data;
  const logout = useLogout();
  const owner = me?.papel === 'dono';
  // The company's data summary exists only once its database is connected; the owner has no company.
  const status = useGetDemoStatus({ query: { enabled: !!me?.dadosProntos && !owner && me?.empresaId === 1 } as never });
  const health = useHealthCheck();
  const ok = health.data?.status === 'ok' || health.data?.status === 'healthy';
  return (
    <div className="min-h-[100dvh] md:flex">
      <aside className="md:w-60 md:min-h-[100dvh] sticky top-0 z-20 md:h-[100dvh] bg-sidebar text-sidebar-foreground flex items-center md:items-stretch md:flex-col border-b md:border-b-0 md:border-r border-sidebar-border">
        <div className="px-5 py-4 md:py-6 md:border-b border-sidebar-border">
          <Wordmark className="text-sidebar-primary" />
          <div className="hidden md:block text-xs opacity-70 mt-1">Secretária de voz para gestão</div>
        </div>
        {owner ? <OwnerNav loc={loc} /> : (
        <><CompanyMobileMenu loc={loc} /><nav aria-label="Principal" className="hidden md:flex md:flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
          {companyNav.map((n) => (
            <Link key={n.href} href={n.href} data-testid={`link-${n.label.toLowerCase()}`} className={linkClass(loc === n.href)}>
              <n.icon className="h-4 w-4" />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav></>
        )}
        <div className="hidden md:block p-4 border-t border-sidebar-border text-[11px] space-y-1 opacity-90" data-testid="status-demo">
          {me && <div className="space-y-0.5 pb-2"><div className="font-medium text-xs">{me.nome}</div><div className="opacity-70">{owner ? 'Dono do produto' : me.empresa}</div>
            <button type="button" onClick={() => logout.mutate()} className="inline-flex items-center gap-1 underline pt-1" data-testid="button-sair"><LogOut className="h-3 w-3" />Sair</button></div>}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health.isLoading ? 'bg-muted-foreground' : ok ? 'bg-chart-4' : 'bg-destructive'}`} />
            {health.isLoading ? 'Verificando servidor' : ok ? 'Servidor ativo' : 'Servidor indisponível'}
          </div>
          {status.data && (
            <div className="num opacity-70">
              {status.data.invoices} notas · {status.data.receivables} títulos · {status.data.products} produtos
              <br />Base: {fmtDateTime(status.data.lastUpdatedAt)}
            </div>
          )}
          {status.isError && <div className="text-sidebar-primary">Status da base indisponível</div>}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {me?.empresaId === 1 && (
          <div className="bg-accent/10 border-b border-accent/40 text-foreground px-4 py-2 text-xs flex items-center gap-2" data-testid="notice-fictitious">
            <Info className="h-4 w-4 shrink-0 text-accent" />
            Dados fictícios de demonstração. Nenhuma conexão com ERP real; os valores não representam uma empresa verdadeira.
          </div>
        )}
        {me && me.papel !== 'dono' && !me.dadosProntos && (
          <div className="bg-accent/10 border-b border-accent/40 text-foreground px-4 py-2 text-xs flex items-center gap-2" data-testid="notice-pending-data">
            <Info className="h-4 w-4 shrink-0 text-accent" />
            A base de dados desta empresa ainda não foi conectada. Você já pode cadastrar usuários e conhecimento; as perguntas começam depois da implantação.
          </div>
        )}
        <main className="p-4 md:p-8 max-w-6xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
