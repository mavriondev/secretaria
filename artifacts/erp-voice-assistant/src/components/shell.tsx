import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ListChecks, HeartPulse, Gauge, Flag, Database, Settings, ScaleIcon, History, Info, Home, BookOpen, Users, Building2, LogOut, LayoutDashboard, Plus, Activity, Wallet } from 'lucide-react';
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
const linkClass = (active: boolean) => `flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors border-l-2 ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-primary' : 'border-transparent hover:bg-sidebar-accent/60'}`;

/** The owner's menu: the system's own tools, then every customer company as its own entry. */
function OwnerNav({ loc }: { loc: string }) {
  const empresas = useEmpresas();
  const companyActive = (id: number) => loc === `/plataforma/empresas/${id}` || loc.startsWith(`/plataforma/empresas/${id}?`);
  return (
    <nav aria-label="Principal" className="flex md:flex-col gap-1 p-2 md:p-3 flex-1 items-center md:items-stretch ml-auto md:ml-0 overflow-x-auto md:overflow-x-visible md:overflow-y-auto">
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
    </nav>
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
      <aside className="md:w-60 md:min-h-[100dvh] sticky top-0 z-20 md:h-[100dvh] bg-sidebar text-sidebar-foreground flex md:flex-col">
        <div className="px-5 py-4 md:py-6 md:border-b border-sidebar-border">
          <Wordmark className="text-sidebar-foreground" />
          <div className="hidden md:block text-xs opacity-70 mt-1">Secretária de voz para gestão</div>
        </div>
        {owner ? <OwnerNav loc={loc} /> : (
        <nav aria-label="Principal" className="flex md:flex-col gap-1 p-2 md:p-3 flex-1 items-center md:items-stretch ml-auto md:ml-0">
          {companyNav.map((n) => {
            const active = loc === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                data-testid={`link-${n.label.toLowerCase()}`}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors border-l-2 ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-primary' : 'border-transparent hover:bg-sidebar-accent/60'}`}
              >
                <n.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{n.label}</span>
              </Link>
            );
          })}
        </nav>
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
          <div className="bg-accent/20 border-b border-accent/50 px-4 py-2 text-xs flex items-center gap-2" data-testid="notice-fictitious">
            <Info className="h-4 w-4 shrink-0" />
            Dados fictícios de demonstração. Nenhuma conexão com ERP real; os valores não representam uma empresa verdadeira.
          </div>
        )}
        {me && me.papel !== 'dono' && !me.dadosProntos && (
          <div className="bg-accent/20 border-b border-accent/50 px-4 py-2 text-xs flex items-center gap-2" data-testid="notice-pending-data">
            <Info className="h-4 w-4 shrink-0" />
            A base de dados desta empresa ainda não foi conectada. Você já pode cadastrar usuários e conhecimento; as perguntas começam depois da implantação.
          </div>
        )}
        <main className="p-4 md:p-8 max-w-5xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
