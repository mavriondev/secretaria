import type { CartaoColuna } from '@workspace/api-client-react';

const nf = (max: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max, minimumFractionDigits: 0 });
const isNumericType = (t: string) => ['dinheiro', 'percentual', 'inteiro', 'numero'].includes(t);
export const isNumeric = (c: Pick<CartaoColuna, 'type'>) => isNumericType(c.type);

/** Full value, as the tooltip and the table show it. */
export function fmtFull(raw: string | null | undefined, type: string): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (isNumericType(type)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return '—';
    if (type === 'dinheiro') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
    if (type === 'percentual') return nf(1).format(n) + '%';
    if (type === 'inteiro') return nf(0).format(n);
    return nf(2).format(n);
  }
  if (type === 'data') return fmtDia(raw);
  if (type === 'data_hora') return fmtDiaHora(raw);
  if (type === 'booleano') return raw === 't' || raw === 'true' ? 'Sim' : raw === 'f' || raw === 'false' ? 'Não' : raw;
  return raw;
}
/** Compact value for the big number on a card: "R$ 1,2 mi", "12,3 mil". */
export function fmtCompact(value: number | null, type: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const prefix = type === 'dinheiro' ? 'R$ ' : '';
  const suffix = type === 'percentual' ? '%' : '';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e9) return sign + prefix + nf(1).format(abs / 1e9) + ' bi';
  if (abs >= 1e6) return sign + prefix + nf(1).format(abs / 1e6) + ' mi';
  if (abs >= 1e4) return sign + prefix + nf(1).format(abs / 1e3) + ' mil';
  return sign + prefix + nf(type === 'inteiro' ? 0 : abs >= 100 ? 0 : 2).format(abs) + suffix;
}
export const fmtAxis = (value: number, type: string) => fmtCompact(value, type).replace(/^R\$ /, '');
export function fmtDia(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[3] + '/' + m[2];
  const month = /^(\d{4})-(\d{2})$/.exec(s);
  if (month) return month[2] + '/' + month[1]!.slice(2);
  return s;
}
export function fmtDiaHora(s: string): string {
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') : s);
  if (isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(d).replace(',', ' às');
}
/** "guardado em 14/10 às 09:30" */
export const fmtCarimbo = (iso: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)).replace(',', ' às');
export const truncar = (s: string, max = 18) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
export const FORMA_LABEL: Record<string, string> = { numero: 'Número', serie: 'Linha no tempo', ranking: 'Barras', tabela: 'Tabela' };
export const INTERVALO_LABEL: Record<number, string> = { 60: '1 min', 300: '5 min', 900: '15 min', 3600: '1 h' };
