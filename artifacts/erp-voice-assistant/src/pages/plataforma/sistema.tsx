import { VOICE_CHECK_LIMIT } from '@/lib/voice-preflight';
import { Loader2, Check, X } from 'lucide-react';
import { Link } from 'wouter';
import { useHealthCheck } from '@workspace/api-client-react';
import { quando } from '@/lib/plataforma';
import { useSistema } from '@/pages/plataforma/visao-geral';
import { StatusPill } from '@/components/plataforma/status-pill';
import { DevicesPanel } from '@/components/devices-panel';
import { LimitesPlataforma } from '@/components/plataforma/limites-plataforma';

const VOZ: Record<string, { texto: string; tone: 'ok' | 'bad' | 'warn' }> = {
  reachable: { texto: 'Respondendo', tone: 'ok' },
  configuration: { texto: 'Chave não configurada (ELEVENLABS_API_KEY)', tone: 'bad' },
  authorization: { texto: 'Chave recusada', tone: 'bad' },
  permissions: { texto: 'Chave sem as permissões necessárias', tone: 'bad' },
  quota: { texto: 'Cota ou limite da conta atingido', tone: 'warn' },
  unavailable: { texto: 'Provedor indisponível', tone: 'bad' },
};

/** The owner's diagnostics: which installation is running, whether the server and voice answer, and what is scheduled. */
export default function Sistema() {
  const sistema = useSistema();
  const health = useHealthCheck();
  const s = sistema.data;
  const ok = health.data?.status === 'ok' || health.data?.status === 'healthy';
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid sm:grid-cols-[14rem_1fr] gap-1 sm:gap-4 py-2 border-t border-border first:border-t-0 text-sm"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>
  );
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Diagnóstico do sistema</h1>
        <p className="text-sm text-muted-foreground">O que está rodando e se os serviços de que o Tato depende estão respondendo.</p>
      </header>
      {sistema.isLoading && <div className="skel h-40" />}
      {sistema.isError && <p className="text-sm text-destructive">Não foi possível ler o diagnóstico.</p>}
      {s && (
        <>
          <section className="rounded border border-border bg-card p-4 md:p-6">
            <h2 className="display text-lg mb-2">Instalação</h2>
            <dl>
              {row('Ambiente', s.versao.installation === 'vps' ? <StatusPill tone="ok">VPS — instalação oficial</StatusPill> : s.versao.installation === 'replit' ? <StatusPill tone="warn">Replit — desenvolvimento e teste</StatusPill> : <StatusPill tone="muted">Não identificado</StatusPill>)}
              {row('Versão em execução', s.versao.identified ? <span className="num">{s.versao.buildId}{s.versao.revision ? <> · commit <code className="text-xs">{s.versao.revision}</code></> : null}</span> : 'Não identificada (build sem manifesto)')}
              {row('Compilada em', quando(s.versao.builtAt))}
              {row('API iniciada em', quando(s.versao.startedAt))}
              {row('Servidor', <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${health.isLoading ? 'bg-muted-foreground' : ok ? 'bg-chart-4' : 'bg-destructive'}`} />{health.isLoading ? 'verificando' : ok ? 'ativo' : 'indisponível'}</span>)}
            </dl>
          </section>
          <section className="rounded border border-border bg-card p-4 md:p-6">
            <h2 className="display text-lg mb-2">Serviços</h2>
            <dl>
              {row('Voz (ElevenLabs)', <span className="inline-flex flex-wrap items-center gap-2"><StatusPill tone={VOZ[s.voz.status]?.tone ?? 'bad'}>{VOZ[s.voz.status]?.texto ?? s.voz.status}</StatusPill><span className="text-xs text-muted-foreground">verificada {quando(s.voz.verificadaEm)}</span></span>)}
              {row('Alcance da verificação de voz', <span className="text-xs text-muted-foreground">{VOICE_CHECK_LIMIT}</span>)}
              {row('Agendador de cargas', s.agendador === 'ligado' ? <StatusPill tone="ok">ligado</StatusPill> : <span className="inline-flex items-center gap-2"><StatusPill tone="muted">desligado</StatusPill><span className="text-xs text-muted-foreground">CARGA_AGENDADOR=off — cargas só manuais ou por envio REST</span></span>)}
              {row('Empresas', `${s.empresas.ativas} ativas de ${s.empresas.total} · ${s.empresas.comBase} com base liberada · ${s.empresas.recebendo} recebendo por REST`)}
              {row('Usuários', `${s.usuarios.ativos} ativos de ${s.usuarios.total}`)}
            </dl>
          </section>
          <section className="rounded border border-border bg-card p-4 md:p-6">
            <h2 className="display text-lg mb-2">Últimas cargas</h2>
            {s.ultimasCargas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma carga registrada.</p> : (
              <ul className="divide-y divide-border text-sm">
                {s.ultimasCargas.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 py-2">
                    <span className={c.status === 'executando' ? '' : c.ok ? 'text-chart-4' : 'text-destructive'}>{c.status === 'executando' ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-label="em andamento" /> : c.ok ? <Check className="inline h-3.5 w-3.5" aria-label="ok" /> : <X className="inline h-3.5 w-3.5" aria-label="falhou" />}</span>
                    <Link href={`/plataforma/empresas/${c.empresaId}?aba=origem`} className="hover:underline">{c.empresa}</Link>
                    <span className="text-xs text-muted-foreground ml-auto num">{quando(c.iniciadaEm)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <LimitesPlataforma />
      <DevicesPanel />
    </div>
  );
}
