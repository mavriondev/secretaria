import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Loader2, Check, X } from 'lucide-react';
import { api, ERP_LABEL } from '@/lib/auth-client';
import { useEmpresas, usd, quando, type UsoGeral } from '@/lib/plataforma';
import { StatusPill } from '@/components/plataforma/status-pill';

type Sistema = {
  retencao: { dias: number; horario: string; ultimaTentativa: string | null; ultimaLimpeza: string | null; status: string; contagens: Record<string, number>; erro: string | null };
  versao: { installation: string; identified: boolean; revision: string | null; buildId: string | null; builtAt: string | null; startedAt: string };
  voz: { status: string; verificadaEm: string };
  agendador: 'ligado' | 'desligado';
  empresas: { total: number; ativas: number; comBase: number; recebendo: number };
  usuarios: { total: number; ativos: number };
  ultimasCargas: Array<{ empresaId: number; empresa: string; status: string; ok: boolean | null; iniciadaEm: string }>;
};

export const useSistema = () => useQuery({ queryKey: ['plataforma', 'sistema'], queryFn: () => api<Sistema>('GET', '/plataforma/sistema'), refetchInterval: 60_000 });
export const useUsoGeral = (dias = 30) => useQuery({ queryKey: ['plataforma', 'uso', dias], queryFn: () => api<UsoGeral>('GET', `/plataforma/uso?dias=${dias}`) });

/** The owner's front page: every customer at a glance, and whether the product itself is healthy. */
export default function VisaoGeral() {
  const empresas = useEmpresas();
  const sistema = useSistema();
  const uso = useUsoGeral(30);
  const s = sistema.data;
  const usoDe = (id: number) => uso.data?.empresas.find(e => e.empresaId === id);
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Empresas clientes e saúde do produto.</p>
        </div>
        <Link href="/plataforma/empresas/nova" className="inline-flex items-center gap-2 h-10 px-4 rounded bg-primary text-primary-foreground text-sm" data-testid="link-nova-empresa"><Plus className="h-4 w-4" />Nova empresa</Link>
      </header>

      <section aria-label="Resumo" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Empresas ativas" value={s ? `${s.empresas.ativas}/${s.empresas.total}` : '…'} hint={s ? `${s.empresas.comBase} com base liberada · ${s.empresas.recebendo} recebendo dados` : ''} />
        <Card label="Respostas (30 dias)" value={uso.data ? uso.data.total.respostas.toLocaleString('pt-BR') : '…'} hint={uso.data ? `custo ${usd(uso.data.total.custoUsd)}` : ''} />
        <Card label="Voz (ElevenLabs)" value={s ? (s.voz.status === 'reachable' ? 'Respondendo' : 'Com problema') : '…'} hint={s ? `verificada ${quando(s.voz.verificadaEm)}` : ''} tone={s ? (s.voz.status === 'reachable' ? 'ok' : 'bad') : undefined} />
        <Card label="Instalação" value={s ? (s.versao.installation === 'vps' ? 'VPS (oficial)' : s.versao.installation === 'replit' ? 'Replit (desenvolvimento)' : 'Não identificada') : '…'} hint={s?.versao.revision ? `commit ${s.versao.revision.slice(0, 12)}` : s ? 'versão não identificada' : ''} />
      </section>

      <section aria-labelledby="empresas" className="space-y-3">
        <h2 id="empresas" className="display text-xl">Empresas</h2>
        {empresas.isLoading && <div className="skel h-24" />}
        {empresas.isError && <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => empresas.refetch()}>Tentar novamente</button></p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {empresas.data?.map(c => {
            const u = usoDe(c.id);
            return (
              <li key={c.id} data-testid={`empresa-${c.id}`}>
                <Link href={`/plataforma/empresas/${c.id}`} className="block rounded border border-border bg-card p-4 hover:border-primary/60 transition-colors space-y-2">
                  <div className="flex items-start gap-3">
                    <Building2 className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.nome}</div>
                      <div className="text-xs text-muted-foreground">{ERP_LABEL[c.erp] ?? c.erp} · {c.usuarios} usuário(s) · desde {new Date(c.criadaEm).toLocaleDateString('pt-BR')}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill tone={c.dadosProntos ? 'ok' : 'muted'}>{c.dadosProntos ? 'Base liberada' : 'Sem base'}</StatusPill>
                    {!c.ativa && <StatusPill tone="bad">Desativada</StatusPill>}
                    {(u?.limite.bloqueado || u?.dia.bloqueado) && <StatusPill tone="bad">{u.dia.bloqueado && !u.limite.bloqueado ? 'Limite de hoje atingido' : 'Limite atingido'}</StatusPill>}
                    {(u?.limite.aviso || u?.dia.aviso) && !u.limite.bloqueado && !u.dia.bloqueado && <StatusPill tone="warn">Perto do limite</StatusPill>}
                  </div>
                  <div className="text-xs text-muted-foreground num">
                    {u ? <>{u.respostas} respostas em 30 dias · {usd(u.custoUsd)}{u.limite.limiteUsd !== null ? ` de ${usd(u.limite.limiteUsd)}/mês` : ''}</> : '…'}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {!!s?.ultimasCargas.length && (
        <section aria-labelledby="cargas" className="space-y-2">
          <h2 id="cargas" className="display text-xl">Últimas cargas</h2>
          <ul className="divide-y divide-border border border-border rounded text-sm">
            {s.ultimasCargas.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                <span className={c.status === 'executando' ? '' : c.ok ? 'text-chart-4' : 'text-destructive'}>{c.status === 'executando' ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-label="em andamento" /> : c.ok ? <Check className="inline h-3.5 w-3.5" aria-label="ok" /> : <X className="inline h-3.5 w-3.5" aria-label="falhou" />}</span>
                <Link href={`/plataforma/empresas/${c.empresaId}?aba=origem`} className="underline-offset-2 hover:underline">{c.empresa}</Link>
                <span className="text-xs text-muted-foreground ml-auto num">{quando(c.iniciadaEm)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`display text-2xl mt-1 ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
