import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Bell, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListarAvisosQueryKey, useAtualizarAviso, useCriarAviso, useExcluirAviso, useListarAvisos, type AvisoCondicao } from '@workspace/api-client-react';
import { CONDICAO_AJUDA, CONDICAO_LABEL, usePush } from '@/lib/avisos';
import { apiMessage, useFavoritos } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';
import { useFecharComVoltar } from '@/lib/navegacao';

export type PedidoDeAviso = { favoritoId: number | null; condicao: AvisoCondicao | null; limiar: number | null; tipoLimiar: 'valor' | 'percentual'; assunto: string | null };
type Props = { favoritoId?: number | null; pedido?: PedidoDeAviso | null; onClose: () => void };

const REAVISAR = [{ v: 60, l: '1 hora' }, { v: 360, l: '6 horas' }, { v: 1440, l: '24 horas' }, { v: 4320, l: '3 dias' }];
const numero = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** "Avisar quando…": the person's rules on one live card, plus a form for a new one. Opened from the card menu or by voice. */
export function AvisoDialog({ favoritoId: initialId, pedido, onClose }: Props) {
  useFecharComVoltar(true, onClose);
  const qc = useQueryClient();
  const { lista } = useFavoritos();
  const vivos = lista.itens.filter(f => f.tipo === 'vivo');
  const [favoritoId, setFavoritoId] = useState<number | null>(initialId ?? pedido?.favoritoId ?? (vivos.length === 1 ? vivos[0]!.id : null));
  const card = lista.itens.find(f => f.id === favoritoId) ?? null;
  const avisos = useListarAvisos({ favoritoId: favoritoId ?? undefined }, { query: { queryKey: getListarAvisosQueryKey({ favoritoId: favoritoId ?? undefined }), enabled: favoritoId !== null } });
  const criar = useCriarAviso();
  const atualizar = useAtualizarAviso();
  const excluir = useExcluirAviso();
  const push = usePush();
  const condicoes = avisos.data?.condicoes ?? (card?.forma === 'numero' ? ['acima', 'abaixo', 'variacao', 'mudou'] : ['mudou']) as AvisoCondicao[];
  const [condicao, setCondicao] = useState<AvisoCondicao>(pedido?.condicao ?? 'acima');
  const [limiar, setLimiar] = useState(pedido?.limiar != null ? String(pedido.limiar).replace('.', ',') : '');
  const [tipoLimiar, setTipoLimiar] = useState<'valor' | 'percentual'>(pedido?.tipoLimiar ?? 'percentual');
  const [reavisar, setReavisar] = useState(1440);
  const [querPush, setQuerPush] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (!condicoes.includes(condicao)) setCondicao(condicoes[0] ?? 'mudou'); }, [condicoes, condicao]);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: getListarAvisosQueryKey({ favoritoId: favoritoId ?? undefined }) }); void qc.invalidateQueries({ queryKey: getListarAvisosQueryKey() }); };
  const precisaLimiar = condicao !== 'mudou';
  const valorLimiar = numero(limiar);

  const confirmar = async () => {
    if (!favoritoId) { setErro('Escolha o cartão.'); return; }
    if (precisaLimiar && valorLimiar === null) { setErro('Informe o valor de referência.'); return; }
    setErro(null);
    try {
      await criar.mutateAsync({ data: { favoritoId, condicao, ...(precisaLimiar ? { limiar: valorLimiar } : {}), ...(condicao === 'variacao' ? { tipoLimiar } : {}), reavisarAposMin: reavisar } });
      invalidate();
      let descricao = 'Você verá o aviso na caixa de avisos (sino).';
      if (querPush && push.estado === 'desligado') { const ok = await push.ligar(); descricao = ok ? 'Você receberá também uma notificação neste aparelho.' : 'O aviso ficará na caixa de avisos; a notificação neste aparelho não pôde ser ativada.'; }
      toast({ title: 'Aviso criado.', description: descricao });
      setLimiar('');
    } catch (e) { setErro(apiMessage(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="aviso-titulo" data-testid="aviso-dialogo">
      <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-background border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="aviso-titulo" className="display text-xl inline-flex items-center gap-2"><Bell className="h-5 w-5 text-primary" aria-hidden />Avisar quando…</h2>
          <button onClick={onClose} aria-label="Fechar" className="h-9 w-9 -mr-2 -mt-1 flex items-center justify-center"><X className="h-5 w-5" /></button>
        </div>

        {!vivos.length ? (
          <p className="text-sm text-muted-foreground" data-testid="aviso-sem-vivos">Avisos acompanham cartões ao vivo. Fixe uma consulta como favorito acompanhado e depois peça o aviso.</p>
        ) : (
          <>
            {initialId == null && (!pedido?.favoritoId || favoritoId === null) && (
              <label className="block text-sm">Cartão{pedido?.assunto && !pedido.favoritoId ? <span className="text-xs text-muted-foreground"> (não encontrei “{pedido.assunto}”; escolha abaixo)</span> : null}
                <select value={favoritoId ?? ''} onChange={e => setFavoritoId(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="aviso-cartao">
                  <option value="">Escolha…</option>
                  {vivos.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}
                </select>
              </label>
            )}
            {card && <p className="text-sm text-muted-foreground">Cartão: <span className="text-foreground font-medium">{card.titulo}</span>{card.tipo !== 'vivo' ? ' (fixo: não muda, sem avisos)' : ''}</p>}

            {!!avisos.data?.itens.length && (
              <ul className="space-y-2" aria-label="Avisos deste cartão" data-testid="aviso-lista">
                {avisos.data.itens.map(a => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm" data-testid={'aviso-item-' + a.id}>
                    <label className="flex items-center gap-2 flex-1 min-w-0">
                      <input type="checkbox" checked={a.ativo} onChange={e => atualizar.mutate({ id: a.id, data: { ativo: e.target.checked } }, { onSuccess: invalidate, onError: e2 => setErro(apiMessage(e2)) })} className="h-4 w-4 accent-primary" aria-label={`Aviso ativo: ${a.descricao}`} />
                      <span className="truncate">{a.descricao}{a.ultimoErro ? <span className="block text-xs text-destructive truncate">Última verificação falhou: {a.ultimoErro}</span> : a.ultimaVerificacao ? <span className="block text-xs text-muted-foreground">verificado · {a.estadoAtual ? 'condição vale agora' : 'condição não vale agora'}</span> : <span className="block text-xs text-muted-foreground">aguardando dados novos</span>}</span>
                    </label>
                    <button type="button" onClick={() => excluir.mutate({ id: a.id }, { onSuccess: invalidate, onError: e2 => setErro(apiMessage(e2)) })} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground" aria-label="Excluir aviso"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}

            {card?.tipo === 'vivo' && (
              <fieldset className="space-y-3" data-testid="aviso-novo">
                <legend className="text-xs uppercase tracking-wider text-muted-foreground">Novo aviso</legend>
                <div role="radiogroup" aria-label="Condição" className="grid grid-cols-2 gap-1.5">
                  {condicoes.map(c => (
                    <button key={c} type="button" role="radio" aria-checked={condicao === c} onClick={() => setCondicao(c)} data-testid={'aviso-condicao-' + c}
                      className={'h-10 rounded-lg border text-sm px-2 ' + (condicao === c ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>{CONDICAO_LABEL[c]}</button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{CONDICAO_AJUDA[condicao]}</p>
                {precisaLimiar && (
                  <div className="flex gap-2">
                    <label className="block text-sm flex-1">Valor de referência
                      <input inputMode="decimal" value={limiar} onChange={e => setLimiar(e.target.value)} placeholder={condicao === 'variacao' && tipoLimiar === 'percentual' ? 'ex.: 20' : 'ex.: 200000'} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card num" data-testid="aviso-limiar" />
                    </label>
                    {condicao === 'variacao' && (
                      <label className="block text-sm">Em
                        <select value={tipoLimiar} onChange={e => setTipoLimiar(e.target.value as 'valor' | 'percentual')} className="mt-1 h-10 px-2 rounded-md border border-input bg-card" data-testid="aviso-tipo-limiar">
                          <option value="percentual">%</option><option value="valor">valor</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
                {(condicao === 'acima' || condicao === 'abaixo') && (
                  <label className="block text-sm">Se continuar assim, lembrar de novo após
                    <select value={reavisar} onChange={e => setReavisar(Number(e.target.value))} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="aviso-reavisar">
                      {REAVISAR.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </label>
                )}
                {push.estado === 'ligado' ? <p className="text-xs text-muted-foreground">Notificações neste aparelho estão ligadas.</p>
                  : push.estado === 'desligado' ? (
                    <label className="flex items-start gap-3 text-sm">
                      <input type="checkbox" checked={querPush} onChange={e => setQuerPush(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" data-testid="aviso-push" />
                      <span>Avisar também no celular<span className="block text-xs text-muted-foreground">O navegador vai pedir permissão para notificações. Elas trazem só o título do cartão e o valor.</span></span>
                    </label>
                  ) : push.estado === 'ios-sem-instalar' ? <p className="text-xs text-muted-foreground">No iPhone, a notificação só funciona com o Tato instalado na tela de início (Compartilhar → Adicionar à Tela de Início). Até lá, o aviso fica na caixa de avisos.</p>
                    : push.estado === 'negado' ? <p className="text-xs text-muted-foreground">As notificações estão bloqueadas neste navegador; o aviso fica na caixa de avisos.</p>
                      : push.estado === 'indisponivel-servidor' ? <p className="text-xs text-muted-foreground">O aviso aparece na caixa de avisos (sino) ao abrir o app.</p> : null}
                {push.erro && <p className="text-xs text-destructive">{push.erro}</p>}
                <p className="text-xs text-muted-foreground">Horário de silêncio e outras opções ficam em <Link href="/avisos" className="underline" onClick={onClose}>Avisos</Link>.</p>
              </fieldset>
            )}
          </>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2 pt-1">
          {card?.tipo === 'vivo' && <button onClick={() => { void confirmar(); }} disabled={criar.isPending} className="h-11 flex-1 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="aviso-confirmar">{criar.isPending ? 'Aguarde…' : 'Criar aviso'}</button>}
          <button onClick={onClose} className="h-11 px-4 rounded-lg border border-border text-sm">Fechar</button>
        </div>
      </div>
    </div>
  );
}
