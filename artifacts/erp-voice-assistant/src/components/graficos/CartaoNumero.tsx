import type { CartaoDados } from '@workspace/api-client-react';
import { fmtCompact, fmtFull } from '@/lib/cartao-format';

/** One big number. Compact on the card, the full value in the title (tooltip) and for assistive technology. */
export function CartaoNumero({ dados, variacao, compacto = false }: { dados: CartaoDados; variacao?: number | null; compacto?: boolean }) {
  const column = dados.column;
  const type = column?.type ?? 'texto';
  const value = dados.value ?? null;
  const numeric = ['dinheiro', 'percentual', 'inteiro', 'numero'].includes(type);
  const full = fmtFull(dados.raw ?? null, type);
  const shown = numeric ? fmtCompact(value, type) : (dados.raw ?? '—');
  const delta = variacao !== undefined && variacao !== null && variacao !== 0 ? variacao : null;
  return (
    <div className="min-w-0 flex flex-col justify-end gap-1" role="img" aria-label={(column?.label ?? 'Valor') + ': ' + full}>
      <p title={full} className={'display num leading-none truncate ' + (compacto ? 'text-2xl' : 'text-[2.4rem]')} data-testid="favorito-numero">{shown}</p>
      <div className="flex items-baseline gap-2 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{column?.label}</p>
        {delta !== null && (
          <p className={'text-xs num shrink-0 ' + (delta > 0 ? 'text-accent' : 'text-destructive')} aria-label={(delta > 0 ? 'subiu ' : 'caiu ') + fmtFull(String(Math.abs(delta)), type) + ' desde a última atualização'}>
            {delta > 0 ? '▲' : '▼'} {fmtCompact(Math.abs(delta), type)}
          </p>
        )}
      </div>
    </div>
  );
}
