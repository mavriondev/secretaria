import { ArrowUp, Trash2 } from 'lucide-react';
import type { InputLevel } from '@/hooks/use-live-voice';

/** Energy (RMS, full scale 1) on a 0-100 scale for display: -60 dB is empty, 0 dB is full. */
export const nivelPercentual = (rms: number): number => {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(100, ((20 * Math.log10(rms)) + 60) / 60 * 100));
};

/** A thin bar: how much the microphone is picking up right now, and the mark it has to pass to count as speech. */
export function NivelDeEntrada({ level }: { level: InputLevel }) {
  const valor = nivelPercentual(level.rms), marca = nivelPercentual(level.threshold);
  return (
    <div className="mx-auto w-48 space-y-1" data-testid="nivel-entrada" aria-label={`Nível do microfone ${Math.round(valor)} de 100`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(valor)}>
      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-[width] duration-100 ${level.speech ? 'bg-primary' : 'bg-muted-foreground/50'}`} style={{ width: `${valor}%` }} />
        {marca > 0 && <span aria-hidden className="absolute top-0 h-full w-px bg-foreground/60" style={{ left: `${marca}%` }} />}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">{level.speech ? 'Captando sua voz' : 'Nível do microfone'}</p>
    </div>
  );
}

/** Manual sending: while the person is speaking, two big buttons; before that, one line saying what to do. */
export function EnvioManual({ aberto, onEnviar, onDescartar }: { aberto: boolean; onEnviar: () => void; onDescartar: () => void }) {
  if (!aberto) return <p className="text-center text-xs text-muted-foreground" data-testid="envio-manual-dica">Fale à vontade. Quando terminar, toque em Enviar.</p>;
  return (
    <div className="flex items-center justify-center gap-3" data-testid="envio-manual">
      <button type="button" onClick={onDescartar} data-testid="button-descartar"
        className="h-14 px-5 rounded-full border border-border bg-card text-sm font-medium text-muted-foreground inline-flex items-center gap-2 hover:text-foreground hover:border-destructive/60">
        <Trash2 className="h-4 w-4" aria-hidden />Descartar
      </button>
      <button type="button" onClick={onEnviar} data-testid="button-enviar-fala"
        className="h-14 min-w-40 px-7 rounded-full bg-primary text-primary-foreground text-base font-semibold inline-flex items-center justify-center gap-2 shadow-lg shadow-primary/25 active:scale-[0.98]">
        <ArrowUp className="h-5 w-5" aria-hidden />Enviar
      </button>
    </div>
  );
}
