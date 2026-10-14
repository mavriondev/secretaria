import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChevronDown, ChevronUp, Copy, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/auth-client';
import { appUrl } from '@/lib/app-path';
import { NOTIFICACOES_DONO_KEY, quando, SAUDE_KEY, useNotificacoesDono, useSaude, type Gravidade, type ItemSaude, type Saude } from '@/lib/plataforma';
import { fmtHora, usePush } from '@/lib/avisos';
import { StatusPill } from '@/components/plataforma/status-pill';
import { toast } from '@/hooks/use-toast';

const COR: Record<Gravidade, string> = { ok: 'bg-chart-4', atencao: 'bg-primary', critico: 'bg-destructive', desconhecido: 'bg-muted-foreground/50' };
const ROTULO: Record<Gravidade, string> = { ok: 'Tudo certo', atencao: 'Atenção', critico: 'Crítico', desconhecido: 'Não medido aqui' };
const TOM: Record<Gravidade, 'ok' | 'warn' | 'bad' | 'muted'> = { ok: 'ok', atencao: 'warn', critico: 'bad', desconhecido: 'muted' };
const ORDEM: Record<Gravidade, number> = { critico: 0, atencao: 1, ok: 2, desconhecido: 3 };

function Luz({ gravidade, className = '' }: { gravidade: Gravidade; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${COR[gravidade]} ${className}`} aria-label={ROTULO[gravidade]} />;
}

function Item({ item }: { item: ItemSaude }) {
  const problema = item.gravidade === 'atencao' || item.gravidade === 'critico';
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid={`saude-item-${item.chave}`}>
      <div className="flex items-start gap-3">
        <Luz gravidade={item.gravidade} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-medium ${item.gravidade === 'desconhecido' ? 'text-muted-foreground' : ''}`}>{item.titulo}</span>
            {item.empresaId && <Link href={`/plataforma/empresas/${item.empresaId}`} className="text-xs text-muted-foreground hover:underline">{item.empresa ?? `Empresa ${item.empresaId}`}</Link>}
            {problema && item.desde && <span className="text-xs text-muted-foreground num">desde {quando(item.desde)}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{item.mensagem}</p>
          {item.gravidade !== 'ok' && item.acao && <p className="text-sm mt-1.5 rounded-md border border-border bg-background/60 px-3 py-2"><span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">O que fazer</span>{item.acao}</p>}
        </div>
      </div>
    </li>
  );
}

function PainelPush() {
  const push = usePush('dono');
  return (
    <div className="rounded border border-border bg-card p-4 space-y-2" data-testid="push-painel-dono">
      <h3 className="text-sm font-medium inline-flex items-center gap-2">{push.estado === 'ligado' ? <Bell className="h-4 w-4 text-primary" aria-hidden /> : <BellOff className="h-4 w-4 text-muted-foreground" aria-hidden />}Notificação neste aparelho</h3>
      {push.estado === 'carregando' ? <div className="skel h-8" aria-hidden />
        : push.estado === 'indisponivel-servidor' ? <p className="text-sm text-muted-foreground">Este servidor ainda não envia notificações para o celular. Os alertas ficam nesta caixa.</p>
          : push.estado === 'ios-sem-instalar' ? <p className="text-sm text-muted-foreground">No iPhone, a notificação só funciona com o Tato instalado na tela de início (Compartilhar → Adicionar à Tela de Início).</p>
            : push.estado === 'sem-suporte' ? <p className="text-sm text-muted-foreground">Este navegador não permite notificações para sites. Os alertas ficam nesta caixa.</p>
              : push.estado === 'negado' ? <p className="text-sm text-muted-foreground">As notificações estão bloqueadas nas configurações deste navegador.</p>
                : (
                  <>
                    <p className="text-sm text-muted-foreground">{push.estado === 'ligado' ? 'Ligada. Alertas críticos chegam a qualquer hora; os demais respeitam o horário de silêncio.' : 'Desligada. Ao ligar, o navegador pede permissão uma vez.'}</p>
                    <button type="button" disabled={push.ocupado} onClick={() => { void (push.estado === 'ligado' ? push.desligar() : push.ligar()); }} data-testid="push-dono-alternar"
                      className={'h-10 px-4 rounded-lg text-sm font-medium disabled:opacity-50 ' + (push.estado === 'ligado' ? 'border border-border hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90')}>
                      {push.estado === 'ligado' ? 'Desligar neste aparelho' : 'Ligar neste aparelho'}
                    </button>
                  </>
                )}
      {push.erro && <p className="text-xs text-destructive" role="alert">{push.erro}</p>}
      {push.assinaturas > 0 && <p className="text-xs text-muted-foreground num">{push.assinaturas} aparelho{push.assinaturas > 1 ? 's' : ''} com notificação ligada.</p>}
    </div>
  );
}

function CaixaDeAvisos() {
  const qc = useQueryClient();
  const { data, isLoading } = useNotificacoesDono();
  const itens = data?.itens ?? [], naoLidas = data?.naoLidas ?? 0;
  const marcar = useMutation({ mutationFn: (body: { ids?: number[]; todas?: boolean }) => api<{ marcadas: number }>('POST', '/plataforma/notificacoes/lidas', body), onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICACOES_DONO_KEY }) });
  const [todas, setTodas] = useState(false);
  // Opening the inbox reads it: the counter goes to zero once the list is on screen.
  useEffect(() => {
    if (!naoLidas || marcar.isPending) return;
    const t = setTimeout(() => marcar.mutate({ todas: true }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naoLidas]);
  const visiveis = todas ? itens : itens.slice(0, 8);
  return (
    <section id="avisos" className="rounded border border-border bg-card p-4 md:p-6 space-y-3" aria-labelledby="caixa-dono-titulo">
      <div className="flex items-center justify-between gap-3">
        <h2 id="caixa-dono-titulo" className="display text-lg">Avisos recebidos{naoLidas ? <span className="ml-2 text-sm text-primary num">{naoLidas} não lido{naoLidas > 1 ? 's' : ''}</span> : null}</h2>
      </div>
      {isLoading ? <div className="skel h-16" aria-hidden /> : !itens.length ? (
        <p className="text-sm text-muted-foreground" data-testid="avisos-dono-vazio">Nenhum aviso ainda. Quando uma verificação encontrar um problema, ele aparece aqui e no sino.</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="avisos-dono-caixa">
          {visiveis.map(n => (
            <li key={n.id} className="py-3 flex items-start gap-3" data-testid={`notificacao-dono-${n.id}`}>
              <span className={'mt-1.5 h-2 w-2 rounded-full shrink-0 ' + (n.lidaEm ? 'bg-transparent border border-border' : 'bg-primary')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{n.titulo}</span>{n.valor && <StatusPill tone={n.valor === 'crítico' ? 'bad' : n.valor === 'atenção' ? 'warn' : n.valor === 'ok' ? 'ok' : 'muted'}>{n.valor}</StatusPill>}</div>
                <p className="text-sm text-muted-foreground">{n.mensagem}</p>
                <p className="text-xs text-muted-foreground num">{fmtHora(n.criadaEm)}{n.empurrada ? ' · notificado no aparelho' : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {itens.length > 8 && <button type="button" onClick={() => setTodas(t => !t)} className="text-sm underline text-muted-foreground inline-flex items-center gap-1">{todas ? <><ChevronUp className="h-3.5 w-3.5" />Mostrar menos</> : <><ChevronDown className="h-3.5 w-3.5" />Mostrar todos ({itens.length})</>}</button>}
    </section>
  );
}

/** The owner's traffic light: what the periodic checks found, what to do about it, and the inbox where the alerts arrive. */
export default function SaudeDoSistema() {
  const qc = useQueryClient();
  const saude = useSaude();
  const verificar = useMutation({
    mutationFn: () => api<Saude>('POST', '/plataforma/saude/verificar'),
    onSuccess: data => { qc.setQueryData(SAUDE_KEY, data); void qc.invalidateQueries({ queryKey: NOTIFICACOES_DONO_KEY }); },
    onError: () => toast({ title: 'Não foi possível verificar agora.', variant: 'destructive' }),
  });
  const s = saude.data;
  // First visit on a fresh installation: run the checks once so the board is never empty.
  useEffect(() => { if (s && !s.verificadoEm && !verificar.isPending && !verificar.isError) verificar.mutate(); }, [s, verificar]);
  const healthz = appUrl('/api/healthz');
  const enderecoMonitor = typeof window === 'undefined' ? healthz : new URL(healthz, window.location.origin).toString();
  const copiar = () => { void navigator.clipboard?.writeText(enderecoMonitor).then(() => toast({ title: 'Endereço copiado.' })); };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Saúde do sistema</h1>
          <p className="text-sm text-muted-foreground">Verificações a cada {s?.intervaloMin ?? 5} minutos: serviço, dados das empresas, backup, disco, certificado, custo e segurança. Nenhuma IA envolvida.</p>
        </div>
        <button type="button" onClick={() => verificar.mutate()} disabled={verificar.isPending} data-testid="saude-verificar" className="h-10 px-4 rounded-full border border-border bg-card text-sm font-medium hover:bg-muted inline-flex items-center gap-2 disabled:opacity-60">
          {verificar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}Verificar agora
        </button>
      </header>

      {saude.isLoading && <div className="skel h-24" />}
      {saude.isError && <p className="text-sm text-destructive">Não foi possível ler o estado do sistema.</p>}
      {s && (
        <>
          <section className="rounded border border-border bg-card p-4 md:p-6 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="saude-geral" data-gravidade={s.geral}>
            <div className="flex items-center gap-3">
              <span className={`h-4 w-4 rounded-full ${COR[s.geral]} ${s.geral === 'critico' ? 'animate-pulse' : ''}`} aria-hidden />
              <span className="display text-xl">{s.verificadoEm ? ROTULO[s.geral] : 'Ainda não verificado'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {s.resumo.critico > 0 && <StatusPill tone="bad">{s.resumo.critico} crítico{s.resumo.critico > 1 ? 's' : ''}</StatusPill>}
              {s.resumo.atencao > 0 && <StatusPill tone="warn">{s.resumo.atencao} em atenção</StatusPill>}
              <StatusPill tone="ok">{s.resumo.ok} ok</StatusPill>
              {s.resumo.desconhecido > 0 && <StatusPill tone="muted">{s.resumo.desconhecido} não medido{s.resumo.desconhecido > 1 ? 's' : ''} aqui</StatusPill>}
            </div>
            <div className="ml-auto text-xs text-muted-foreground num">
              Última verificação {quando(s.verificadoEm)}
              {s.agendador === 'desligado' && <span className="block text-primary">Verificação automática desligada (SAUDE_AGENDADOR=off)</span>}
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            {s.grupos.map(g => {
              const pior = [...g.itens].sort((a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade])[0]?.gravidade ?? 'desconhecido';
              return (
                <section key={g.id} className="rounded border border-border bg-card p-4 md:p-5" data-testid={`saude-grupo-${g.id}`}>
                  <h2 className="display text-lg mb-3 flex items-center gap-2"><Luz gravidade={pior} />{g.titulo}</h2>
                  <ul className="divide-y divide-border">{[...g.itens].sort((a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade]).map(i => <Item key={i.chave} item={i} />)}</ul>
                </section>
              );
            })}
          </div>
        </>
      )}

      <div className="grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
        <CaixaDeAvisos />
        <div className="space-y-4">
          <PainelPush />
          <section className="rounded border border-border bg-card p-4 space-y-2" data-testid="monitor-externo">
            <h3 className="text-sm font-medium">Monitor externo</h3>
            <p className="text-sm text-muted-foreground">Se a VPS inteira cair, este painel cai junto. Um monitor gratuito de fora avisa por e-mail quando este endereço parar de responder:</p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all flex-1 rounded bg-background px-2 py-1.5 border border-border" data-testid="monitor-endereco">{enderecoMonitor}</code>
              <button type="button" onClick={copiar} aria-label="Copiar endereço" className="h-8 w-8 rounded border border-border hover:bg-muted inline-flex items-center justify-center"><Copy className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
            <p className="text-xs text-muted-foreground">Passo a passo em <code>docs/vps/MONITOR-EXTERNO.md</code> no repositório. Resposta esperada: <code>{'{"status":"ok"}'}</code>, a cada 5 minutos.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
