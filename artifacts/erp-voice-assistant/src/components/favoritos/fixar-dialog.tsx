import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateFavorito, usePrepararFavorito, useSubstituirConsultaFavorito, getListFavoritosQueryKey, type FavoritoForma, type FavoritoRascunho, type Favorito } from '@workspace/api-client-react';
import { CorpoCartao } from '@/components/favoritos/cartao-favorito';
import { FORMA_LABEL } from '@/lib/cartao-format';
import { apiMessage, useFavoritos } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';
import { useFecharComVoltar } from '@/lib/navegacao';

type Props = {
  /** Answer to pin (new favourite) … */
  queryLogId?: number;
  /** … or a favourite being redone: the draft came from a fresh answer and replaces its query after confirmation. */
  substituir?: { favorito: Favorito; rascunho: FavoritoRascunho };
  onClose: () => void;
};

const FORMAS: FavoritoForma[] = ['numero', 'serie', 'ranking', 'tabela'];
/** Why a form is not offered for this result, in plain words. */
const MOTIVO_FORMA: Record<FavoritoForma, string> = { numero: 'precisa de um valor só', serie: 'precisa de datas', ranking: 'precisa de nomes e valores', tabela: 'precisa de linhas' };

/** Confirmation: the card exactly as it will look (in the chosen form), title, follow or keep, companion card, "show on the home screen". */
export function FixarDialog({ queryLogId, substituir, onClose }: Props) {
  useFecharComVoltar(true, onClose);
  const qc = useQueryClient();
  const { lista } = useFavoritos();
  const preparar = usePrepararFavorito();
  const criar = useCreateFavorito();
  const trocar = useSubstituirConsultaFavorito();
  const [tipo, setTipo] = useState<'vivo' | 'fixo'>(substituir?.favorito.tipo ?? 'vivo');
  const [rascunho, setRascunho] = useState<FavoritoRascunho | null>(substituir?.rascunho ?? null);
  const [titulo, setTitulo] = useState(substituir?.favorito.titulo ?? '');
  const [forma, setForma] = useState<FavoritoForma | null>(null);
  const [porDia, setPorDia] = useState<FavoritoRascunho | null>(null);
  const [querPorDia, setQuerPorDia] = useState(false);
  const [naTela, setNaTela] = useState(false);
  // Administrators may publish the card to the whole company (off by default); managers keep personal cards only.
  const [compartilhar, setCompartilhar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const noHome = lista.itens.filter(f => f.meu && f.naTelaInicial).length;
  const compartilhados = lista.itens.filter(f => f.escopo === 'empresa').length;
  const semCotaCompartilhada = compartilhados >= lista.cotaCompartilhados;

  // The draft is prepared once per kind: "vivo" may need the date rewrite (one model call); "fixo" never does.
  useEffect(() => {
    if (substituir || !queryLogId) return;
    setErro(null);
    preparar.mutate({ data: { queryLogId, tipo } }, {
      onSuccess: d => { setRascunho(d); setTitulo(t => t || d.tituloSugerido); setForma(f => f && d.resultado.formas.includes(f) ? f : d.resultado.forma); },
      onError: e => setErro(apiMessage(e)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryLogId, tipo]);
  // The companion card (revenue by day) is computed only when asked for; no model involved.
  useEffect(() => {
    if (!querPorDia || porDia || !queryLogId) return;
    preparar.mutate({ data: { queryLogId, tipo, variante: 'por_dia' } }, { onSuccess: setPorDia, onError: e => { setErro(apiMessage(e)); setQuerPorDia(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querPorDia, queryLogId]);
  useEffect(() => { if (rascunho && tipo === 'vivo' && !rascunho.podeVivo) setTipo('fixo'); }, [rascunho, tipo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirmar = async () => {
    if (!rascunho) return;
    setErro(null);
    const done = (msg: string) => { qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() }); toast({ title: msg }); onClose(); };
    if (substituir) {
      trocar.mutate({ id: substituir.favorito.id, data: { rascunhoId: rascunho.rascunhoId } }, { onSuccess: () => done('Consulta do favorito substituída.'), onError: e => setErro(apiMessage(e)) });
      return;
    }
    try {
      const nome = titulo.trim() || rascunho.tituloSugerido;
      const partilha = compartilhar && lista.podeCompartilhar ? { compartilhar: true } : {};
      await criar.mutateAsync({ data: { rascunhoId: rascunho.rascunhoId, titulo: nome, tipo, forma: forma ?? undefined, naTelaInicial: naTela, ...partilha } });
      if (querPorDia && porDia) await criar.mutateAsync({ data: { rascunhoId: porDia.rascunhoId, titulo: porDia.tituloSugerido, tipo, naTelaInicial: false, ...partilha } });
      const base = querPorDia && porDia ? 'Dois favoritos criados: o valor e a evolução por dia.' : tipo === 'vivo' ? 'Favorito criado. Ele atualiza sozinho quando chegarem dados novos.' : 'Valor guardado nos favoritos.';
      done(compartilhar && lista.podeCompartilhar ? `${base} Compartilhado com a empresa.` : base);
    } catch (e) { setErro(apiMessage(e)); qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() }); }
  };
  const pending = preparar.isPending || criar.isPending || trocar.isPending;
  const formaAtual = forma && rascunho?.previas[forma] ? forma : rascunho?.resultado.forma ?? null;
  const dados = rascunho && formaAtual ? rascunho.previas[formaAtual] ?? rascunho.resultado.dados : null;
  const preview = rascunho && dados ? { estado: 'ok' as const, resultado: { ...rascunho.resultado, forma: formaAtual!, dados } } : null;
  const ofertaPorDia = rascunho?.variantes.find(v => v.chave === 'por_dia');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="fixar-titulo" data-testid="favorito-dialogo">
      <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-background border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="fixar-titulo" className="display text-xl">{substituir ? 'Substituir a consulta' : 'Fixar como favorito'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="h-9 w-9 -mr-2 -mt-1 flex items-center justify-center"><X className="h-5 w-5" /></button>
        </div>
        {rascunho && <p className="text-sm text-muted-foreground">“{rascunho.pergunta}”</p>}

        {/* The card as it will be saved: same component the Favoritos page draws. */}
        <div className="rounded-xl border border-border bg-card p-4 min-h-24" aria-live="polite" data-testid="favorito-previa">
          {preview ? (
            <>
              <p className="font-medium text-base truncate mb-2">{titulo.trim() || rascunho?.tituloSugerido}</p>
              <CorpoCartao execucao={preview} />
            </>
          ) : erro ? null : <div className="skel h-16" aria-hidden />}
        </div>
        {rascunho && !substituir && (
          <div role="radiogroup" aria-label="Forma do cartão" className="flex flex-wrap gap-1.5" data-testid="favorito-formas">
            {FORMAS.map(f => {
              const ok = f in rascunho.previas;
              return (
                <button key={f} type="button" role="radio" aria-checked={formaAtual === f} disabled={!ok || pending} onClick={() => setForma(f)} data-testid={'favorito-forma-' + f}
                  title={ok ? undefined : MOTIVO_FORMA[f]}
                  className={'rounded-full border px-3 py-1.5 text-xs disabled:opacity-40 ' + (formaAtual === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>
                  {FORMA_LABEL[f]}{ok ? '' : <span className="text-muted-foreground"> · {MOTIVO_FORMA[f]}</span>}
                </button>
              );
            })}
          </div>
        )}

        {!substituir && (
          <>
            <label className="block text-sm">Título
              <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={80} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="favorito-titulo" />
            </label>
            <div role="radiogroup" aria-label="Como guardar" className="grid grid-cols-2 gap-2">
              {(['vivo', 'fixo'] as const).map(t => {
                const blocked = t === 'vivo' && rascunho !== null && !rascunho.podeVivo;
                return (
                  <button key={t} role="radio" aria-checked={tipo === t} disabled={blocked || pending} onClick={() => setTipo(t)} data-testid={'favorito-tipo-' + t}
                    className={'text-left rounded-lg border px-3 py-2.5 disabled:opacity-50 ' + (tipo === t ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>
                    <span className="block text-sm font-medium">{t === 'vivo' ? 'Acompanhar' : 'Guardar este valor como está agora'}</span>
                    <span className="block text-xs text-muted-foreground">{t === 'vivo' ? 'Atualiza sozinho quando chegarem dados novos.' : 'Não muda mais.'}</span>
                  </button>
                );
              })}
            </div>
            {rascunho && !rascunho.podeVivo && <p className="text-xs text-muted-foreground" data-testid="favorito-aviso-vivo">Não dá para acompanhar: {rascunho.motivo}. Fica guardado como está agora.</p>}
            {rascunho && rascunho.reescrita === 'ok' && tipo === 'vivo' && <p className="text-xs text-muted-foreground">As datas da consulta foram ajustadas para acompanhar o calendário; conferi que o valor de hoje é o mesmo.</p>}
            {ofertaPorDia && (
              <div className="space-y-2">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={querPorDia} onChange={e => { setQuerPorDia(e.target.checked); setErro(null); }} className="h-4 w-4 accent-primary" data-testid="favorito-por-dia" />
                  {ofertaPorDia.rotulo}<span className="text-xs text-muted-foreground">(segundo cartão, em linha)</span>
                </label>
                {querPorDia && (
                  <div className="rounded-xl border border-border bg-card p-4 min-h-20" data-testid="favorito-previa-por-dia">
                    {porDia ? <><p className="font-medium text-base truncate mb-2">{porDia.tituloSugerido}</p><CorpoCartao execucao={{ estado: 'ok', resultado: porDia.resultado }} /></> : <div className="skel h-16" aria-hidden />}
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={naTela} disabled={noHome >= lista.limiteTelaInicial} onChange={e => setNaTela(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="favorito-tela-inicial" />
              Mostrar na tela inicial{noHome >= lista.limiteTelaInicial ? <span className="text-xs text-muted-foreground">(já há {lista.limiteTelaInicial})</span> : null}
            </label>
            {lista.podeCompartilhar && (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={compartilhar} disabled={semCotaCompartilhada} onChange={e => setCompartilhar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" data-testid="favorito-compartilhar" />
                <span>Compartilhar com a empresa<span className="block text-xs text-muted-foreground">{semCotaCompartilhada ? `A empresa já tem ${lista.cotaCompartilhados} compartilhados.` : 'Todos da empresa veem e usam este cartão, cada um com as próprias permissões.'}</span></span>
              </label>
            )}
          </>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => { void confirmar(); }} disabled={!rascunho || pending || (querPorDia && !porDia)} className="h-11 flex-1 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="favorito-confirmar">
            {pending ? 'Aguarde…' : substituir ? 'Substituir' : tipo === 'vivo' ? 'Acompanhar' : 'Guardar'}
          </button>
          <button onClick={onClose} className="h-11 px-4 rounded-lg border border-border text-sm">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
