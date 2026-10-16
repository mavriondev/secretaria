import React from 'react';
import type { CartaoDados } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { fmtFull, isNumeric } from '@/lib/cartao-format';

/** Opt-in: sortable headers, sticky header and first column, zebra, horizontal scroll in its own box. */
export type TabelaInterativa = { ordem: { coluna: string; dir: 'asc' | 'desc' } | null; onOrdenar: (coluna: string) => void };

/** Up to ten rows on the card; the whole result lives on its own scrollable screen ("ver tudo"). */
export function CartaoTabela({ dados, todas = false, interativa }: { dados: CartaoDados; todas?: boolean; interativa?: TabelaInterativa }) {
  const columns = (dados.columns ?? []).filter(c => todas || interativa || !/(^|_)id$/.test(c.name) || (dados.columns ?? []).length === 1);
  const rows = dados.rows ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhuma linha.</p>;
  if (interativa) return (
    <div className="min-w-0 max-w-full overflow-auto max-h-[28rem] rounded-lg border border-border/60" tabIndex={0} role="region" aria-label="Tabela de resultados">
      <table className="w-full min-w-[480px] text-sm border-separate border-spacing-0" aria-label={columns.map(c => c.label).join(', ') + ' — ' + rows.length + ' linhas'}>
        <thead><tr>
          {columns.map((c, i) => {
            const ativa = interativa.ordem?.coluna === c.name;
            return <th key={c.name} scope="col" aria-sort={ativa ? (interativa.ordem!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={'sticky top-0 bg-muted text-[11px] uppercase tracking-wider text-muted-foreground font-normal border-b border-border p-0 ' + (i === 0 ? 'left-0 z-30 ' : 'z-20 ')}>
              <button type="button" onClick={() => interativa.onOrdenar(c.name)} className={'w-full min-h-11 px-3 inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground ' + (isNumeric(c) ? 'justify-end' : 'justify-start')}>
                {c.label}{ativa && (interativa.ordem!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
              </button>
            </th>;
          })}
        </tr></thead>
        <tbody>{rows.map((row, r) => (
          <tr key={r}>
            {columns.map((c, i) => {
              const full = fmtFull(row[c.name] ?? null, c.type);
              return <td key={c.name} title={full} className={'px-3 py-2 max-w-[240px] truncate border-t border-border/40 ' + (r % 2 ? 'bg-muted/40 ' : 'bg-card ') + (i === 0 ? 'sticky left-0 z-10 font-medium ' : '') + (isNumeric(c) ? 'text-right num' : 'text-left')}>{full}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
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
