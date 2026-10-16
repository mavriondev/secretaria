import type { VozPreferencias } from '@workspace/api-client-react';
import type { CaptureInfo } from '@/hooks/use-live-voice';

export const ENVIO_OPCOES: ReadonlyArray<{ v: VozPreferencias['envio']; l: string; d: string }> = [
  { v: 'automatico', l: 'Automático', d: 'Envia quando você para de falar por um instante (menos de 1 segundo).' },
  { v: 'pausa_longa', l: 'Pausa longa', d: 'Espera 2,5 segundos de silêncio antes de enviar. Dá tempo de pensar no meio da frase.' },
  { v: 'eu_envio', l: 'Eu envio', d: 'Nada é enviado sozinho. Fale e toque em Enviar quando terminar.' },
];
export const AMBIENTE_OPCOES: ReadonlyArray<{ v: VozPreferencias['ambiente']; l: string; d: string }> = [
  { v: 'normal', l: 'Normal', d: 'Sala tranquila. Funciona como hoje.' },
  { v: 'ruidoso', l: 'Ruidoso', d: 'Ignora vozes bem mais baixas que a sua (gente conversando mais longe).' },
  { v: 'muito_ruidoso', l: 'Muito ruidoso', d: 'Exige voz mais firme e ignora vozes um pouco mais baixas que a sua (metade do volume ou menos).' },
];

type Props = { valor: VozPreferencias; onChange: (mudanca: Partial<VozPreferencias>) => void; salvando?: boolean; captura: CaptureInfo | null };

/** The two microphone preferences, saved per person on the server; they apply to the next question without reconnecting. */
export function PreferenciasDeVoz({ valor, onChange, salvando = false, captura }: Props) {
  const sim = (v: boolean | null) => (v === null ? 'não informado' : v ? 'sim' : 'não');
  return (
    <>
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Como enviar a pergunta</h2>
        <div role="radiogroup" aria-label="Como enviar a pergunta" className="space-y-2" aria-busy={salvando}>
          {ENVIO_OPCOES.map(o => (
            <button key={o.v} type="button" role="radio" aria-checked={valor.envio === o.v} onClick={() => onChange({ envio: o.v })} data-testid={`radio-envio-${o.v}`}
              className={`w-full text-left rounded-lg border px-3.5 py-2.5 transition-colors ${valor.envio === o.v ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
              <span className="block text-sm font-medium">{o.l}</span><span className="block text-xs text-muted-foreground">{o.d}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Em “Pausa longa” e “Eu envio”, aviso aos 25 segundos e, aos 30, envio o que você já falou em vez de descartar.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Ambiente</h2>
        <div role="radiogroup" aria-label="Ambiente" className="space-y-2" aria-busy={salvando}>
          {AMBIENTE_OPCOES.map(o => (
            <button key={o.v} type="button" role="radio" aria-checked={valor.ambiente === o.v} onClick={() => onChange({ ambiente: o.v })} data-testid={`radio-ambiente-${o.v}`}
              className={`w-full text-left rounded-lg border px-3.5 py-2.5 transition-colors ${valor.ambiente === o.v ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
              <span className="block text-sm font-medium">{o.l}</span><span className="block text-xs text-muted-foreground">{o.d}</span>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground space-y-1.5" data-testid="ambiente-dica">
          <p>O sistema não sabe <em>quem</em> está falando: ele separa a sua voz das outras pelo volume. Se alguém falar tão alto quanto você, perto do aparelho, nenhum ajuste resolve.</p>
          <p>O que ajuda de verdade: chegar mais perto do microfone, usar fone com microfone e, em lugar barulhento, escolher “Eu envio”.</p>
        </div>
        {captura && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer min-h-9 leading-9">O que este aparelho aplicou ao microfone</summary>
            <ul className="pb-1 space-y-0.5" data-testid="captura-aplicada">
              <li>Cancelamento de eco: {sim(captura.echoCancellation)}</li>
              <li>Supressão de ruído: {sim(captura.noiseSuppression)}</li>
              <li>Ganho automático: {sim(captura.autoGainControl)}</li>
              {captura.compatibility && <li>Modo de captura compatível ativo.</li>}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
