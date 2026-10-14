import type { CartaoDados } from '@workspace/api-client-react';
import { fmtFull, isNumeric } from '@/lib/cartao-format';

/** Up to ten rows on the card; the whole result lives on its own scrollable screen ("ver tudo"). */
export function CartaoTabela({ dados, todas = false }: { dados: CartaoDados; todas?: boolean }) {
  const columns = (dados.columns ?? []).filter(c => todas || !/(^|_)id$/.test(c.name) || (dados.columns ?? []).length === 1);
  const rows = dados.rows ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhuma linha.</p>;
  return (
    <div className={'min-w-0 overflow-x-auto ' + (todas ? '' : 'max-h-72 overflow-y-auto')}>
      <table className="w-full text-sm" aria-label={columns.map(c => c.label).join(', ') + ' — ' + (dados.total ?? rows.length) + ' linhas'}>
        <thead className="text-[11px] uppercase tracking-wider text-muted-foreground"><tr>
          {columns.map(c => <th key={c.name} scope="col" className={'py-1.5 pr-3 font-normal whitespace-nowrap ' + (isNumeric(c) ? 'text-right' : 'text-left')}>{c.label}</th>)}
        </tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i} className="border-t border-border/60">
            {columns.map(c => {
              const full = fmtFull(row[c.name] ?? null, c.type);
              return <td key={c.name} title={full} className={'py-1.5 pr-3 max-w-[180px] truncate ' + (isNumeric(c) ? 'text-right num' : 'text-left')}>{full}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
