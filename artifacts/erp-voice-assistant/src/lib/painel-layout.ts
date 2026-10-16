/**
 * Pure, deterministic layout of a TV panel. No randomness, no model: the same cards always give the same grid.
 * The screen is a virtual grid of 12 columns x 6 rows; every card gets a rectangle on it.
 *
 * Decision table (grade, ordemAutomatica = true; k = number cards, o = other cards, n = k + o)
 *   k > 0 and o > 0  KPI band on top (rows 1-2: one band when k <= 6, two half-height bands when k > 6),
 *                    the others below (rows 3-6): o <= 3 one row of height 4, o > 3 two rows of height 2
 *   otherwise        n:1 [1] | 2 [2] | 3 [3] if all numbers, else one big card left + two stacked | 4 [2,2] | 5 [3,2]
 *                    6 [3,3] | 7 [4,3] | 8 [4,4] | 9 [3,3,3] | 10 [4,3,3] | 11 [4,4,3] | 12 [4,4,4]
 * Widths inside a row follow weights: base (number 1, ranking 1, series 1.25, table 1.25) x size (pequeno 0.6,
 * auto/medio 1, grande 1.6), minimum 2 columns, remainder by largest fraction (ties go to the earlier card).
 * ordemAutomatica = false: the given order is kept, no KPI band (pure table above).
 * destaque: one big card (8 columns) + the others in the side (4 columns; 2 + 2 columns when more than 6).
 * rotativo: explicit pages when any card has a page (cards without one go to the last page), otherwise pages
 *           by affinity: numbers (6 per page), series (2), rankings (4), tables (2).
 */
export type Forma = 'numero' | 'serie' | 'ranking' | 'tabela';
export type Tamanho = 'auto' | 'pequeno' | 'medio' | 'grande';
export type Modelo = 'grade' | 'destaque' | 'rotativo';
export type CartaoLayout = { id: string; forma: Forma; tamanho: Tamanho; pagina: number | null };
export type Celula = { id: string; col: number; colSpan: number; row: number; rowSpan: number };
export type Pagina = { numero: number; celulas: Celula[] };

export const GRADE_COLS = 12;
export const GRADE_ROWS = 6;
export const MAX_CARTOES = 12;
export const MAX_PAINEIS = 10;

const BASE: Record<Forma, number> = { numero: 1, ranking: 1, serie: 1.25, tabela: 1.25 };
const FATOR: Record<Tamanho, number> = { pequeno: 0.6, auto: 1, medio: 1, grande: 1.6 };
export const peso = (c: CartaoLayout) => BASE[c.forma] * FATOR[c.tamanho];

/** Splits `total` units by weights, each at least `min`, remainder by largest fraction. */
export function distribuir(pesos: number[], total: number, min: number): number[] {
  const n = pesos.length;
  if (!n) return [];
  const m = n * min > total ? Math.max(1, Math.floor(total / n)) : min;
  const livre = total - n * m;
  const soma = pesos.reduce((a, b) => a + b, 0) || n;
  const exato = pesos.map(p => (p / soma) * livre);
  const base = exato.map(Math.floor);
  let resto = livre - base.reduce((a, b) => a + b, 0);
  const ordem = exato.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; resto > 0; k = (k + 1) % n, resto--) base[ordem[k].i]++;
  return base.map(b => b + m);
}

/** Numbers first (stable), then the rest in the given order. */
export function ordenarAutomatico<T extends { forma: Forma }>(cartoes: T[]): T[] {
  return [...cartoes.filter(c => c.forma === 'numero'), ...cartoes.filter(c => c.forma !== 'numero')];
}

function linha(cartoes: CartaoLayout[], row: number, rowSpan: number, minCols = 2): Celula[] {
  const larguras = distribuir(cartoes.map(peso), GRADE_COLS, minCols);
  let col = 1;
  return cartoes.map((c, i) => { const cel = { id: c.id, col, colSpan: larguras[i], row, rowSpan }; col += larguras[i]; return cel; });
}

function empilhar(lista: CartaoLayout[], col: number, colSpan: number): Celula[] {
  const alturas = distribuir(lista.map(peso), GRADE_ROWS, 1);
  let row = 1;
  return lista.map((c, i) => { const cel = { id: c.id, col, colSpan, row, rowSpan: alturas[i] }; row += alturas[i]; return cel; });
}

/** Cards per row for n cards without a KPI band. */
export function contagemPorLinha(n: number): number[] {
  const tabela: Record<number, number[]> = { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3], 11: [4, 4, 3], 12: [4, 4, 4] };
  if (tabela[n]) return tabela[n];
  const rows = Math.ceil(n / 4);
  const out: number[] = [];
  for (let r = 0; r < rows; r++) out.push(Math.floor(n / rows) + (r < n % rows ? 1 : 0));
  return out;
}

function fatiar(cartoes: CartaoLayout[], contagens: number[], rowInicial: number, altura: number): Celula[] {
  const alturas = distribuir(contagens.map(() => 1), altura, 1);
  const out: Celula[] = [];
  let i = 0, row = rowInicial;
  contagens.forEach((c, r) => { out.push(...linha(cartoes.slice(i, i + c), row, alturas[r])); i += c; row += alturas[r]; });
  return out;
}

export function layoutGrade(entrada: CartaoLayout[], ordemAutomatica: boolean): Celula[] {
  const n = entrada.length;
  if (!n) return [];
  const lista = ordemAutomatica ? ordenarAutomatico(entrada) : entrada;
  const kpis = lista.filter(c => c.forma === 'numero');
  const outros = lista.filter(c => c.forma !== 'numero');
  if (ordemAutomatica && kpis.length && outros.length) {
    const faixa = kpis.length <= 6 ? fatiar(kpis, [kpis.length], 1, 2) : fatiar(kpis, [Math.ceil(kpis.length / 2), Math.floor(kpis.length / 2)], 1, 2);
    const o = outros.length;
    const corpo = o <= 3 ? fatiar(outros, [o], 3, 4) : fatiar(outros, [Math.ceil(o / 2), Math.floor(o / 2)], 3, 4);
    return [...faixa, ...corpo];
  }
  if (n === 3 && kpis.length < 3) {
    const [a, b, c] = lista;
    return [{ id: a.id, col: 1, colSpan: 6, row: 1, rowSpan: 6 }, { id: b.id, col: 7, colSpan: 6, row: 1, rowSpan: 3 }, { id: c.id, col: 7, colSpan: 6, row: 4, rowSpan: 3 }];
  }
  return fatiar(lista, contagemPorLinha(n), 1, GRADE_ROWS);
}

export function layoutDestaque(entrada: CartaoLayout[], ordemAutomatica: boolean): Celula[] {
  const n = entrada.length;
  if (n <= 1) return layoutGrade(entrada, ordemAutomatica);
  const lista = ordemAutomatica ? ordenarAutomatico(entrada) : entrada;
  const destaque = lista.find(c => c.tamanho === 'grande') ?? (ordemAutomatica ? lista.find(c => c.forma !== 'numero') : undefined) ?? lista[0];
  const resto = lista.filter(c => c !== destaque);
  const lateral = resto.length <= 6
    ? empilhar(resto, 9, 4)
    : [...empilhar(resto.slice(0, Math.ceil(resto.length / 2)), 9, 2), ...empilhar(resto.slice(Math.ceil(resto.length / 2)), 11, 2)];
  return [{ id: destaque.id, col: 1, colSpan: 8, row: 1, rowSpan: 6 }, ...lateral];
}

const AFINIDADE: Array<[Forma, number]> = [['numero', 6], ['serie', 2], ['ranking', 4], ['tabela', 2]];

/** Pages of the rotating model: ids per page. */
export function paginasRotativo(entrada: CartaoLayout[]): CartaoLayout[][] {
  if (!entrada.length) return [];
  if (entrada.some(c => c.pagina !== null)) {
    const maior = Math.max(...entrada.map(c => c.pagina ?? 0));
    const mapa = new Map<number, CartaoLayout[]>();
    for (const c of entrada) { const p = c.pagina ?? maior; mapa.set(p, [...(mapa.get(p) ?? []), c]); }
    return [...mapa.keys()].sort((a, b) => a - b).map(p => mapa.get(p)!);
  }
  const paginas: CartaoLayout[][] = [];
  for (const [forma, tam] of AFINIDADE) {
    const grupo = entrada.filter(c => c.forma === forma);
    for (let i = 0; i < grupo.length; i += tam) paginas.push(grupo.slice(i, i + tam));
  }
  return paginas;
}

export function layoutPainel(modelo: Modelo, cartoes: CartaoLayout[], ordemAutomatica: boolean): Pagina[] {
  if (modelo === 'rotativo') return paginasRotativo(cartoes).map((g, i) => ({ numero: i + 1, celulas: layoutGrade(g, ordemAutomatica) }));
  return [{ numero: 1, celulas: modelo === 'destaque' ? layoutDestaque(cartoes, ordemAutomatica) : layoutGrade(cartoes, ordemAutomatica) }];
}

/** "Reorganizar automaticamente": numbers first, sizes auto, pages cleared, automatic order on. */
export function reorganizar<T extends { forma: Forma; tamanho: Tamanho; pagina: number | null }>(cartoes: T[]): T[] {
  return ordenarAutomatico(cartoes).map(c => ({ ...c, tamanho: 'auto' as const, pagina: null }));
}

/** Rows that fit in a card body of `altura` px: top-N, so labels are never clipped, only the tail of the data. */
export const barrasQueCabem = (altura: number) => Math.max(1, Math.floor((altura - 8) / 26));
export const linhasQueCabem = (altura: number) => Math.max(1, Math.floor((altura - 36) / 30));

/** True when the layout covers the grid exactly once (no overlap, no hole). Used by tests. */
export function cobreGrade(celulas: Celula[]): boolean {
  const mapa = new Array(GRADE_COLS * GRADE_ROWS).fill(0);
  for (const c of celulas) for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) {
    if (r > GRADE_ROWS || k > GRADE_COLS) return false;
    mapa[(r - 1) * GRADE_COLS + (k - 1)]++;
  }
  return mapa.every(v => v === 1);
}
