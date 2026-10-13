import { Loader2, Mic, TriangleAlert } from 'lucide-react';

export type OrbState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';
const LABEL: Record<OrbState, string> = {
  idle: 'Toque para falar', connecting: 'Conectando…', listening: 'Estou ouvindo', processing: 'Consultando os dados…', speaking: 'Respondendo', error: 'Não consegui ouvir. Toque para tentar de novo',
};
const HINT: Partial<Record<OrbState, string>> = { listening: 'Toque para encerrar', processing: 'Toque para encerrar', speaking: 'Toque para encerrar' };

/** The one control of the voice conversation. Its look says what is happening; the label under it says the same in words. */
export function VoiceOrb({ state, active, onToggle }: { state: OrbState; active: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" onClick={onToggle} className="orb" data-state={state} data-testid="button-record" aria-pressed={active}
        aria-label={active ? 'Encerrar conversa por voz' : 'Iniciar conversa por voz'}>
        {state === 'listening' || state === 'speaking' ? (
          <span className="bars" data-calm={state === 'speaking'} aria-hidden><i /><i /><i /><i /><i /></span>
        ) : state === 'processing' || state === 'connecting' ? <Loader2 className="h-8 w-8 opacity-0" aria-hidden />
          : state === 'error' ? <TriangleAlert className="h-8 w-8" aria-hidden /> : <Mic className="h-9 w-9" aria-hidden />}
      </button>
      <div className="text-center min-h-10" aria-live="polite">
        <p className="text-sm font-medium" data-testid="status-live">{LABEL[state]}</p>
        <p className="text-xs text-muted-foreground">{HINT[state] ?? ' '}</p>
      </div>
    </div>
  );
}
