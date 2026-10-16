/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Keyboard, Mic, X } from 'lucide-react';
import type { AjusteDeResposta } from '@workspace/api-client-react';
import { limitarOpcoes, textoDaTrilha, type Trilha } from '@/lib/opcoes-resposta';

const BASE = 'min-h-11 rounded-full border px-4 py-2 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const ATIVA = 'border-primary/60 bg-primary/10 text-foreground hover:bg-primary/20 hover:border-primary disabled:opacity-50';
const ESCOLHIDA = 'border-accent bg-accent/15 text-foreground font-medium disabled:opacity-100';
const INATIVA = 'border-border bg-card text-muted-foreground disabled:opacity-40';
const SAIDA = 'min-h-11 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * Under an answer: the hypothesis the assistant used and up to three adjustment buttons, or, under a clarification
 * question, up to four real options plus fixed exits (answer by voice, type, cancel) that exist even with zero options.
 * Tapping sends the option text through the same path as saying or typing it. The voice never reads these buttons.
 */
export function AjustesDaResposta({ hipotese, ajustes, pergunta, onEscolher, desabilitado, escolhida = null, trilha, ocultas = false, onFalar, onDigitar, onCancelar }: {
  hipotese: string | null; ajustes: AjusteDeResposta[]; pergunta: boolean; onEscolher: (opcao: AjusteDeResposta) => void;
  /** Locked while a request is in flight. */
  desabilitado: boolean;
  /** Question text of the option already chosen in this answer: it turns teal, the others go inactive. */
  escolhida?: string | null;
  trilha?: Trilha;
  /** The choices were dismissed (cancel, free reply, unrelated request). */
  ocultas?: boolean;
  onFalar?: () => void; onDigitar?: () => void; onCancelar?: () => void;
}) {
  const opcoes = limitarOpcoes(ajustes, pergunta);
  const caminho = trilha?.passos.length ? textoDaTrilha(trilha) : '';
  const saidas = pergunta && !ocultas && !!(onFalar || onDigitar || onCancelar);
  if (!hipotese && !opcoes.length && !saidas && !caminho) return null;
  return (
    <div className="space-y-3" data-testid="ajustes-resposta">
      {hipotese && <p className="text-sm text-muted-foreground" data-testid="text-hipotese">{hipotese}</p>}
      {caminho && <p className="text-xs text-accent font-medium" data-testid="text-caminho">{caminho}</p>}
      {!ocultas && opcoes.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={pergunta ? 'Opções da pergunta' : 'Ajustar a resposta'}>
          {opcoes.map((ajuste, i) => {
            const escolheu = escolhida === ajuste.pergunta;
            const outra = escolhida != null && !escolheu;
            return (
              <li key={ajuste.pergunta}>
                <button type="button" disabled={desabilitado || escolhida != null} aria-pressed={escolhida != null ? escolheu : undefined}
                  onClick={() => onEscolher(ajuste)} data-testid={`button-ajuste-${i}`} data-estado={escolheu ? 'escolhida' : outra ? 'inativa' : 'ativa'}
                  className={`${BASE} ${escolheu ? ESCOLHIDA : outra ? INATIVA : ATIVA}`}>
                  {pergunta ? `${i + 1}) ${ajuste.rotulo}` : ajuste.rotulo}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {saidas && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3" role="group" aria-label="Outras formas de responder" data-testid="saidas-resposta">
          {onFalar && <button type="button" onClick={onFalar} className={SAIDA} data-testid="button-responder-voz"><Mic className="h-4 w-4" aria-hidden />Responder por voz</button>}
          {onDigitar && <button type="button" onClick={onDigitar} className={SAIDA} data-testid="button-responder-digitar"><Keyboard className="h-4 w-4" aria-hidden />Digitar</button>}
          {onCancelar && <button type="button" onClick={onCancelar} className={SAIDA} data-testid="button-cancelar-opcoes"><X className="h-4 w-4" aria-hidden />Cancelar</button>}
        </div>
      )}
    </div>
  );
}
