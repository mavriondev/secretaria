import type { AjusteDeResposta } from '@workspace/api-client-react';

/**
 * Under an answer: the hypothesis the assistant used (period, grouping, name match) and up to three buttons that
 * redo the request with an adjustment; under a clarification question: the options as buttons. Tapping sends a new
 * question through the same path as typing it. The voice never reads these buttons.
 */
export function AjustesDaResposta({ hipotese, ajustes, pergunta, onEscolher, desabilitado }: {
  hipotese: string | null; ajustes: AjusteDeResposta[]; pergunta: boolean; onEscolher: (texto: string) => void; desabilitado: boolean;
}) {
  if (!hipotese && !ajustes.length) return null;
  return (
    <div className="space-y-2" data-testid="ajustes-resposta">
      {hipotese && <p className="text-sm text-muted-foreground" data-testid="text-hipotese">{hipotese}</p>}
      {ajustes.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={pergunta ? 'Opções da pergunta' : 'Ajustar a resposta'}>
          {ajustes.map((ajuste, i) => (
            <li key={ajuste.pergunta}>
              <button type="button" disabled={desabilitado} onClick={() => onEscolher(ajuste.pergunta)} data-testid={`button-ajuste-${i}`}
                title={desabilitado ? 'Fale a opção durante a conversa por voz' : undefined}
                className="min-h-11 rounded-full border border-border bg-card px-3.5 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-50 transition-colors">
                {pergunta ? `${i + 1}) ${ajuste.rotulo}` : ajuste.rotulo}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
