import type { CartaoColuna, RespostaTabular } from '@workspace/api-client-react';
import { fmtFull, isNumeric } from '@/lib/cartao-format';

export type TabularResposta = RespostaTabular;
export type Linha = Record<string, string | null>;
export type PreferenciaForma = 'automatico' | 'tabela' | 'ranking' | 'serie' | 'texto';
export type Ordem = { coluna: string; dir: 'asc' | 'desc' } | null;
export const INICIAIS = 10;
export const LIMITE_BUSCA = 15;

/** The tabular block shows for lists (4+ rows) or wide results (2+ columns). */
export function temBloco(t: { rows?: unknown[]; columns?: unknown[] } | null | undefined): boolean {
  if (!t) return false;
  return (t.rows?.length ?? 0) >= 4 || (t.columns?.length ?? 0) > 1;
}

/** Forms offered to the person: only those the data supports, text always. */
export function formasDisponiveis(t: Pick<TabularResposta, 'formas' | 'previas'>): PreferenciaForma[] {
  const f = new Set<string>(t.formas ?? []);
  const out: PreferenciaForma[] = [];
  if (f.has('tabela')) out.push('tabela');
  if (f.has('ranking') && t.previas?.ranking) out.push('ranking');
  if (f.has('serie') && t.previas?.serie) out.push('serie');
  out.push('texto');
  return out;
}

/** Saved preference when compatible; otherwise the best compatible shape (table for large or wide lists). */
export function formaEfetiva(pref: PreferenciaForma | undefined | null, t: Pick<TabularResposta, 'formas' | 'previas' | 'rows' | 'columns' | 'forma'>): PreferenciaForma {
  const ok = formasDisponiveis(t);
  if (pref && pref !== 'automatico' && ok.includes(pref)) return pref;
  const grande = t.rows.length > 12 || t.columns.length > 2;
  if (grande && ok.includes('tabela')) return 'tabela';
  const dele = t.forma as string;
  if (ok.includes(dele as PreferenciaForma) && dele !== 'texto') return dele as PreferenciaForma;
  return ok.find(f => f !== 'texto') ?? 'texto';
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isData = (c: CartaoColuna) => c.type === 'data' || c.type === 'data_hora';

export function ordenar(rows: Linha[], colunas: CartaoColuna[], ordem: Ordem): Linha[] {
  if (!ordem) return rows;
  const col = colunas.find(c => c.name === ordem.coluna); if (!col) return rows;
  const f = ordem.dir === 'asc' ? 1 : -1;
  const chave = (r: Linha): number | string | null => {
    const v = r[col.name]; if (v === null || v === undefined || v === '') return null;
    if (isNumeric(col)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    if (isData(col)) { const t = Date.parse(v.replace(' ', 'T')); return Number.isFinite(t) ? t : v; }
    return v;
  };
  return rows.map((r, i) => ({ r, i, k: chave(r) })).sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1; // empty always last
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return c * f || a.i - b.i;
  }).map(x => x.r);
}

export function proximaOrdem(atual: Ordem, coluna: string): Ordem {
  if (!atual || atual.coluna !== coluna) return { coluna, dir: 'asc' };
  return atual.dir === 'asc' ? { coluna, dir: 'desc' } : null;
}

export function filtrar(rows: Linha[], colunas: CartaoColuna[], busca: string): Linha[] {
  const q = norm(busca.trim()); if (!q) return rows;
  return rows.filter(r => colunas.some(c => norm(fmtFull(r[c.name] ?? null, c.type)).includes(q) || norm(r[c.name] ?? '').includes(q)));
}

export const mostrarBusca = (total: number) => total > LIMITE_BUSCA;
export const linhasVisiveis = (rows: Linha[], expandido: boolean) => (expandido ? rows : rows.slice(0, INICIAIS));
export const podeExpandir = (total: number) => total > INICIAIS;

/** Stops spreadsheets from running a cell as a formula: a leading = + - @ (even after whitespace) gets an apostrophe. Plain negative numbers stay numbers. */
export function neutralizar(v: string, numerico = false): string {
  if (numerico && Number.isFinite(Number(v)) && v.trim() !== '') return v;
  return /^[\s\u00a0]*[=+\-@]/.test(v) ? "'" + v : v;
}
const celula = (r: Linha, c: CartaoColuna) => { const v = r[c.name]; return v === null || v === undefined ? '' : neutralizar(v, isNumeric(c)); };

export function paraTsv(rows: Linha[], colunas: CartaoColuna[]): string {
  const limpa = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  return [colunas.map(c => limpa(neutralizar(c.label))).join('\t'), ...rows.map(r => colunas.map(c => limpa(celula(r, c))).join('\t'))].join('\r\n');
}
const aspas = (s: string) => '"' + s.replace(/"/g, '""') + '"';
export function paraCsv(rows: Linha[], colunas: CartaoColuna[], bom = false): string {
  const t = [colunas.map(c => aspas(neutralizar(c.label))).join(','), ...rows.map(r => colunas.map(c => aspas(celula(r, c))).join(','))].join('\r\n');
  return (bom ? '\uFEFF' : '') + t;
}

const plano = (x: string) => norm(x).replace(/\s+/g, ' ').trim();
const semAtraso = (x: string) => x.replace(/^\s*atraso:\s*/i, '');

/** Hides only the repeated list lines. Numbered/bulleted/pipe lines always go; with `tabular`, an unnumbered line also goes when it holds a row's real label AND one of that row's real formatted cells. The first line, and anything else, stays. */
export function textoSemLista(texto: string, tabular?: Pick<TabularResposta, 'columns' | 'rows'> | null): string {
  const linhas = texto.split('\n');
  const lista = (l: string) => /^\s*(\d{1,3}\s*[.)\-–:]|[-*•·–])\s+\S/.test(l) || /^\s*\|.*\|\s*$/.test(l) || /^\s*[-:| ]{3,}\s*$/.test(l) && l.includes('|');
  const linhasDados = (tabular?.rows ?? []).map(r => {
    const rotulos: string[] = []; const celulas: string[] = [];
    for (const c of tabular!.columns) {
      const raw = r[c.name]; if (raw === null || raw === undefined || raw === '') continue;
      if (isNumeric(c) || isData(c)) { const f = fmtFull(raw, c.type); if (f !== '—') celulas.push(plano(f)); }
      else { const v = plano(semAtraso(raw)); if (v.length >= 2) rotulos.push(v); }
    }
    return { rotulos, celulas };
  }).filter(d => d.rotulos.length && d.celulas.length);
  const dado = (l: string) => { const p = plano(semAtraso(l.replace(/^\s*[-*•]\s*/, ''))); return linhasDados.some(d => d.rotulos.some(x => p.includes(x)) && d.celulas.some(x => p.includes(x))); };
  const fora = linhas.map((l, i) => i > 0 && (lista(l) || dado(l)));
  if (linhasDados.length) linhas.forEach((l, i) => {
    if (i === 0 || fora[i] || !/^[^|]{2,60}:\s*$/.test(l)) return;
    let j = i + 1; while (j < linhas.length && !linhas[j]!.trim()) j++;
    if (j < linhas.length && fora[j]) fora[i] = true;
  });
  return linhas.filter((_, i) => !fora[i]).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const textoGrafico = textoSemLista;
