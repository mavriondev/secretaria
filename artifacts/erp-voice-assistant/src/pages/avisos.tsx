import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Bell, BellOff, Check, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getConfiguracaoDeAvisosQueryKey, getListarAvisosQueryKey, useConfiguracaoDeAvisos, useDefinirConfiguracaoDeAvisos, useListarAvisos, useMarcarNotificacoesLidas, useAtualizarAviso, useExcluirAviso, type Notificacao } from '@workspace/api-client-react';
import { PageBar } from '@/components/page-bar';
import { GestorNav } from '@/components/favoritos/gestor-nav';
import { AvisoDialog } from '@/components/avisos/aviso-dialog';
import { fmtHora, useInvalidateNotificacoes, useNotificacoes, usePush } from '@/lib/avisos';
import { apiMessage, useFavoritos } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';

const HORAS = Array.from({ length: 24 }, (_, h) => h);

/** The inbox: every notice (unread first by date), the person's rules, push on this device and quiet hours. */
export default function Avisos() {
  const { itens, naoLidas, isLoading } = useNotificacoes();
  const invalidate = useInvalidateNotificacoes();
  const marcar = useMarcarNotificacoesLidas();
  const regras = useListarAvisos(undefined, { query: { queryKey: getListarAvisosQueryKey() } });
  const atualizar = useAtualizarAviso();
  const excluir = useExcluirAviso();
  const qc = useQueryClient();
  const cfg = useConfiguracaoDeAvisos({ query: { queryKey: getConfiguracaoDeAvisosQueryKey() } });
  const salvarCfg = useDefinirConfiguracaoDeAvisos();
  const push = usePush();
  const { lista } = useFavoritos();
  const [, navigate] = useLocation();
  const [novo, setNovo] = useState(false);
  const fail = (e: unknown) => toast({ title: apiMessage(e), variant: 'destructive' });
  // Opening the inbox reads it: the counter goes to zero once the list is on screen.
  useEffect(() => {
    if (!naoLidas || marcar.isPending) return;
    const t = setTimeout(() => marcar.mutate({ data: { todas: true } }, { onSuccess: invalidate }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naoLidas]);
  const abrir = (n: Notificacao) => {
    if (!n.lidaEm) marcar.mutate({ data: { ids: [n.id] } }, { onSuccess: invalidate });
    if (n.favoritoId && lista.itens.some(f => f.id === n.favoritoId)) navigate(`/favoritos?cartao=${n.favoritoId}`);
  };
  const setCfg = (data: Parameters<typeof salvarCfg.mutate>[0]['data']) => salvarCfg.mutate({ data }, { onSuccess: () => qc.invalidateQueries({ queryKey: getConfiguracaoDeAvisosQueryKey() }), onError: fail });
  const invalidateRegras = () => qc.invalidateQueries({ queryKey: getListarAvisosQueryKey() });

  return (
    <div className="min-h-[100dvh] md:pl-20 pb-20 md:pb-8">
      <GestorNav />
      <div className="max-w-3xl mx-auto px-5">
        <PageBar inicio="/usuario" className="py-2" />
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="display text-3xl leading-tight">Avisos</h1>
            <p className="text-sm text-muted-foreground">O Tato confere seus cartões quando chegam dados novos e avisa quando a condição acontece.</p>
          </div>
          <button type="button" onClick={() => setNovo(true)} className="h-10 px-4 rounded-full border border-primary/60 bg-primary/10 text-sm font-medium text-primary hover:bg-primary/20 inline-flex items-center gap-2" data-testid="avisos-novo"><Bell className="h-4 w-4" aria-hidden />Novo aviso</button>
        </div>

        <section className="space-y-2 mb-8" aria-labelledby="caixa-titulo">
          <div className="flex items-center justify-between">
            <h2 id="caixa-titulo" className="text-xs uppercase tracking-wider text-muted-foreground">Caixa de avisos{naoLidas ? ` · ${naoLidas} não lido${naoLidas > 1 ? 's' : ''}` : ''}</h2>
            {naoLidas > 0 && <button type="button" onClick={() => marcar.mutate({ data: { todas: true } }, { onSuccess: invalidate })} className="text-xs underline text-muted-foreground inline-flex items-center gap-1" data-testid="avisos-ler-todas"><Check className="h-3 w-3" aria-hidden />Marcar todas como lidas</button>}
          </div>
          {isLoading ? <div className="skel h-16" aria-hidden /> : !itens.length ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center" data-testid="avisos-vazio">Nenhum aviso ainda. Crie um aviso em um cartão acompanhado (menu do cartão → “Avisar quando…”) ou diga à assistente: “me avisa quando o faturamento de hoje passar de 200 mil”.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="avisos-caixa">
              {itens.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => abrir(n)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/60" data-testid={'notificacao-' + n.id}>
                    <span className={'mt-1.5 h-2 w-2 rounded-full shrink-0 ' + (n.lidaEm ? 'bg-transparent border border-border' : 'bg-primary')} aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{n.titulo}{n.tipo === 'resumo' ? <span className="ml-2 text-[11px] uppercase tracking-wider text-muted-foreground">agrupado</span> : null}</span>
                      <span className="block text-sm text-muted-foreground">{n.tipo === 'resumo' ? n.mensagem : <><span className="num text-foreground">{n.valor}</span>{n.condicao ? ` · ${n.condicao}` : ''}</>}</span>
                      <span className="block text-xs text-muted-foreground num">{fmtHora(n.criadaEm)}{n.empurrada ? ' · notificado no aparelho' : ''}</span>
                    </span>
                    {n.favoritoId && lista.itens.some(f => f.id === n.favoritoId) && <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 mb-8" aria-labelledby="regras-titulo">
          <h2 id="regras-titulo" className="text-xs uppercase tracking-wider text-muted-foreground">Meus avisos{regras.data ? ` · ${regras.data.itens.length} de ${regras.data.cota}` : ''}</h2>
          {!regras.data?.itens.length ? <p className="text-sm text-muted-foreground" data-testid="regras-vazio">Nenhuma regra criada.</p> : (
            <ul className="space-y-2" data-testid="regras-lista">
              {regras.data.itens.map(a => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm" data-testid={'regra-' + a.id}>
                  <label className="flex items-center gap-3 flex-1 min-w-0">
                    <input type="checkbox" checked={a.ativo} onChange={e => atualizar.mutate({ id: a.id, data: { ativo: e.target.checked } }, { onSuccess: invalidateRegras, onError: fail })} className="h-4 w-4 accent-primary" aria-label={`Aviso ativo: ${a.favoritoTitulo ?? ''} ${a.descricao}`} />
                    <span className="min-w-0"><span className="block font-medium truncate">{a.favoritoTitulo ?? 'Cartão'}</span><span className="block text-muted-foreground">{a.descricao}{a.ultimoErro ? <span className="text-destructive"> · falhou: {a.ultimoErro}</span> : a.ultimaVerificacao ? <span className="num"> · verificado {fmtHora(a.ultimaVerificacao)}</span> : ' · aguardando dados novos'}</span></span>
                  </label>
                  <button type="button" onClick={() => excluir.mutate({ id: a.id }, { onSuccess: invalidateRegras, onError: fail })} className="text-xs underline text-muted-foreground" data-testid={'regra-excluir-' + a.id}>Excluir</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid sm:grid-cols-2 gap-4" aria-label="Preferências">
          <div className="rounded-xl border border-border bg-card p-4 space-y-2" data-testid="push-painel">
            <h2 className="text-sm font-medium inline-flex items-center gap-2">{push.estado === 'ligado' ? <Bell className="h-4 w-4 text-primary" aria-hidden /> : <BellOff className="h-4 w-4 text-muted-foreground" aria-hidden />}Notificação neste aparelho</h2>
            {push.estado === 'carregando' ? <div className="skel h-8" aria-hidden />
              : push.estado === 'indisponivel-servidor' ? <p className="text-sm text-muted-foreground">Este servidor ainda não envia notificações para o celular. Os avisos ficam nesta caixa.</p>
                : push.estado === 'ios-sem-instalar' ? <p className="text-sm text-muted-foreground">No iPhone, a notificação só funciona com o Tato instalado na tela de início (Compartilhar → Adicionar à Tela de Início, iOS 16.4 ou mais novo). Depois de instalar, volte aqui para ligar.</p>
                  : push.estado === 'sem-suporte' ? <p className="text-sm text-muted-foreground">Este navegador não permite notificações para sites. Os avisos ficam nesta caixa.</p>
                    : push.estado === 'negado' ? <p className="text-sm text-muted-foreground">As notificações estão bloqueadas nas configurações deste navegador. Libere-as para o Tato e volte aqui.</p>
                      : (
                        <>
                          <p className="text-sm text-muted-foreground">{push.estado === 'ligado' ? 'Ligada. Você recebe uma notificação com o título do cartão e o valor; os detalhes só aparecem dentro do app.' : 'Desligada. Ao ligar, o navegador pede permissão uma vez.'}</p>
                          <button type="button" disabled={push.ocupado} onClick={() => { void (push.estado === 'ligado' ? push.desligar() : push.ligar()); }} className={'h-10 px-4 rounded-lg text-sm font-medium disabled:opacity-50 ' + (push.estado === 'ligado' ? 'border border-border hover:bg-muted' : 'bg-primary text-primary-foreground')} data-testid="push-alternar">{push.estado === 'ligado' ? 'Desligar neste aparelho' : 'Ligar neste aparelho'}</button>
                        </>
                      )}
            {push.erro && <p className="text-xs text-destructive" role="alert">{push.erro}</p>}
            {push.assinaturas > 0 && <p className="text-xs text-muted-foreground num">{push.assinaturas} aparelho{push.assinaturas > 1 ? 's' : ''} com notificação ligada.</p>}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="silencio-painel">
            <h2 className="text-sm font-medium">Horário de silêncio</h2>
            <p className="text-xs text-muted-foreground">Nesse período a notificação não é enviada ao aparelho; o aviso continua entrando nesta caixa.</p>
            {cfg.data && (
              <>
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={cfg.data.silencioAtivo} onChange={e => setCfg({ silencioAtivo: e.target.checked })} className="h-4 w-4 accent-primary" data-testid="silencio-ativo" />Ativar silêncio
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">das
                    <select value={cfg.data.silencioInicio} disabled={!cfg.data.silencioAtivo} onChange={e => setCfg({ silencioInicio: Number(e.target.value) })} className="h-9 px-2 rounded-md border border-input bg-background num" data-testid="silencio-inicio">{HORAS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}</select>
                  </label>
                  <label className="flex items-center gap-1">às
                    <select value={cfg.data.silencioFim} disabled={!cfg.data.silencioAtivo} onChange={e => setCfg({ silencioFim: Number(e.target.value) })} className="h-9 px-2 rounded-md border border-input bg-background num" data-testid="silencio-fim">{HORAS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}</select>
                  </label>
                </div>
              </>
            )}
            {regras.data && <p className="text-xs text-muted-foreground">Até {regras.data.cota} avisos por pessoa e {regras.data.limiteDiario} notificações por dia; acima disso, o resto chega agrupado.</p>}
          </div>
        </section>
      </div>
      {novo && <AvisoDialog onClose={() => setNovo(false)} />}
    </div>
  );
}
