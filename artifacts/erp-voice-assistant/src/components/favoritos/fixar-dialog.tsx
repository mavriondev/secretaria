import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateFavorito, usePrepararFavorito, useSubstituirConsultaFavorito, getListFavoritosQueryKey, type FavoritoRascunho, type Favorito } from '@workspace/api-client-react';
import { CorpoCartao } from '@/components/favoritos/cartao-favorito';
import { FORMA_LABEL, INTERVALO_LABEL } from '@/lib/cartao-format';
import { apiMessage, useFavoritos } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';

type Props = {
  /** Answer to pin (new favourite) … */
  queryLogId?: number;
  /** … or a favourite being redone: the draft came from a fresh answer and replaces its query after confirmation. */
  substituir?: { favorito: Favorito; rascunho: FavoritoRascunho };
  onClose: () => void;
};

/** Confirmation: suggested title, live or fixed, interval, "show on the home screen", and the current value before anything is saved. */
export function FixarDialog({ queryLogId, substituir, onClose }: Props) {
  const qc = useQueryClient();
  const { lista } = useFavoritos();
  const preparar = usePrepararFavorito();
  const criar = useCreateFavorito();
  const trocar = useSubstituirConsultaFavorito();
  const [tipo, setTipo] = useState<'vivo' | 'fixo'>(substituir?.favorito.tipo ?? 'vivo');
  const [rascunho, setRascunho] = useState<FavoritoRascunho | null>(substituir?.rascunho ?? null);
  const [titulo, setTitulo] = useState(substituir?.favorito.titulo ?? '');
  const [intervalo, setIntervalo] = useState<number>(300);
  const [naTela, setNaTela] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const minimo = rascunho?.intervaloMinimoSeg ?? lista.intervaloMinimoSeg;
  const noHome = lista.itens.filter(f => f.naTelaInicial).length;

  // The draft is prepared once per kind: "vivo" may need the date rewrite (one model call); "fixo" never does.
  useEffect(() => {
    if (substituir || !queryLogId) return;
    setErro(null);
    preparar.mutate({ data: { queryLogId, tipo } }, {
      onSuccess: d => { setRascunho(d); setTitulo(t => t || d.tituloSugerido); if (d.intervaloMinimoSeg > intervalo) setIntervalo(d.intervaloMinimoSeg); },
      onError: e => setErro(apiMessage(e)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryLogId, tipo]);
  useEffect(() => { if (rascunho && tipo === 'vivo' && !rascunho.podeVivo) setTipo('fixo'); }, [rascunho, tipo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirmar = () => {
    if (!rascunho) return;
    setErro(null);
    const done = (msg: string) => { qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() }); toast({ title: msg }); onClose(); };
    if (substituir) {
      trocar.mutate({ id: substituir.favorito.id, data: { rascunhoId: rascunho.rascunhoId } }, { onSuccess: () => done('Consulta do favorito substituída.'), onError: e => setErro(apiMessage(e)) });
      return;
    }
    criar.mutate({ data: { rascunhoId: rascunho.rascunhoId, titulo: titulo.trim() || rascunho.tituloSugerido, tipo, intervaloSeg: tipo === 'vivo' ? intervalo : null, naTelaInicial: naTela } },
      { onSuccess: () => done(tipo === 'vivo' ? 'Favorito ao vivo criado.' : 'Valor guardado nos favoritos.'), onError: e => setErro(apiMessage(e)) });
  };
  const pending = preparar.isPending || criar.isPending || trocar.isPending;
  const preview = rascunho ? { estado: 'ok' as const, resultado: rascunho.resultado } : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="fixar-titulo" data-testid="favorito-dialogo">
      <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-background border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="fixar-titulo" className="display text-xl">{substituir ? 'Substituir a consulta' : 'Fixar como favorito'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="h-9 w-9 -mr-2 -mt-1 flex items-center justify-center"><X className="h-5 w-5" /></button>
        </div>
        {rascunho && <p className="text-sm text-muted-foreground">“{rascunho.pergunta}”</p>}

        <div className="rounded-xl border border-border bg-card p-4 min-h-24" aria-live="polite" data-testid="favorito-previa">
          {preview ? <CorpoCartao execucao={preview} /> : erro ? null : <div className="skel h-16" aria-hidden />}
          {preview && <p className="text-[11px] text-muted-foreground mt-2">{FORMA_LABEL[rascunho!.resultado.forma]} · valor de agora</p>}
        </div>

        {!substituir && (
          <>
            <label className="block text-sm">Título
              <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={80} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="favorito-titulo" />
            </label>
            <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2">
              {(['vivo', 'fixo'] as const).map(t => {
                const blocked = t === 'vivo' && rascunho !== null && !rascunho.podeVivo;
                return (
                  <button key={t} role="radio" aria-checked={tipo === t} disabled={blocked || pending} onClick={() => setTipo(t)} data-testid={'favorito-tipo-' + t}
                    className={'text-left rounded-lg border px-3 py-2.5 disabled:opacity-50 ' + (tipo === t ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>
                    <span className="block text-sm font-medium">{t === 'vivo' ? 'Ao vivo' : 'Fixo'}</span>
                    <span className="block text-xs text-muted-foreground">{t === 'vivo' ? 'Atualiza sozinho enquanto o app está aberto.' : 'Guarda o valor de agora, sem mudar.'}</span>
                  </button>
                );
              })}
            </div>
            {rascunho && rascunho.reescrita === 'rejeitada' && <p className="text-xs text-muted-foreground" data-testid="favorito-aviso-vivo">Não dá para acompanhar ao vivo: {rascunho.motivo}. Guardei a opção de fixo.</p>}
            {rascunho && rascunho.reescrita === 'ok' && tipo === 'vivo' && <p className="text-xs text-muted-foreground">As datas da consulta foram ajustadas para acompanhar o calendário; conferi que o valor de hoje é o mesmo.</p>}
            {tipo === 'vivo' && (
              <label className="block text-sm">Atualizar a cada
                <select value={intervalo} onChange={e => setIntervalo(Number(e.target.value))} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="favorito-intervalo">
                  {lista.intervalos.map(s => <option key={s} value={s} disabled={s < minimo}>{INTERVALO_LABEL[s] ?? s + ' s'}{s < minimo ? ' (dados chegam a cada ' + Math.round(minimo / 60) + ' min)' : ''}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={naTela} disabled={noHome >= lista.limiteTelaInicial} onChange={e => setNaTela(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="favorito-tela-inicial" />
              Mostrar na tela inicial{noHome >= lista.limiteTelaInicial ? <span className="text-xs text-muted-foreground">(já há {lista.limiteTelaInicial})</span> : null}
            </label>
          </>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={confirmar} disabled={!rascunho || pending} className="h-11 flex-1 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="favorito-confirmar">
            {pending ? 'Aguarde…' : substituir ? 'Substituir' : tipo === 'vivo' ? 'Fixar ao vivo' : 'Guardar valor'}
          </button>
          <button onClick={onClose} className="h-11 px-4 rounded-lg border border-border text-sm">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
