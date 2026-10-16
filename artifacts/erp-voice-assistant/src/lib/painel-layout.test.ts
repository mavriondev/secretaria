import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cobreGrade, distribuir, layoutDestaque, layoutGrade, layoutPainel, paginasRotativo, reorganizar, type CartaoLayout, type Forma } from './painel-layout';

const mk = (formas: Forma[]): CartaoLayout[] => formas.map((forma, i) => ({ id: 'c' + i, forma, tamanho: 'auto', pagina: null }));
const rep = (f: Forma, n: number) => Array.from({ length: n }, () => f);

test('distribuir keeps the total, the minimum and is deterministic', () => {
  assert.deepEqual(distribuir([1, 1, 1], 12, 2), [4, 4, 4]);
  assert.deepEqual(distribuir([1, 1, 1, 1, 1, 1], 12, 2), [2, 2, 2, 2, 2, 2]);
  const d = distribuir([1.6, 1, 0.6], 12, 2);
  assert.equal(d.reduce((a, b) => a + b, 0), 12);
  assert.ok(d.every(v => v >= 2));
  assert.deepEqual(distribuir([1, 1, 1], 12, 2), distribuir([1, 1, 1], 12, 2));
});

test('grade covers the screen exactly for 1, 2, 3, 4, 6, 8 and 12 cards of every single shape', () => {
  for (const forma of ['numero', 'serie', 'ranking', 'tabela'] as Forma[])
    for (const n of [1, 2, 3, 4, 6, 8, 12]) assert.ok(cobreGrade(layoutGrade(mk(rep(forma, n)), true)), forma + ' x ' + n);
});

test('grade rows per card count (pure shapes)', () => {
  const rows = (n: number) => new Set(layoutGrade(mk(rep('serie', n)), true).map(c => c.row)).size;
  assert.deepEqual([1, 2, 4, 6, 8, 12].map(rows), [1, 1, 2, 2, 2, 3]);
  const tres = layoutGrade(mk(rep('serie', 3)), true);
  assert.deepEqual(tres.map(c => [c.col, c.colSpan, c.row, c.rowSpan]), [[1, 6, 1, 6], [7, 6, 1, 3], [7, 6, 4, 3]]);
  assert.deepEqual(layoutGrade(mk(rep('numero', 3)), true).map(c => c.colSpan), [4, 4, 4]);
});

test('mixed shapes: KPIs form the top band when order is automatic', () => {
  for (const mix of [['serie', 'numero', 'ranking', 'numero'], ['tabela', 'numero', 'serie', 'ranking', 'numero', 'numero'], [...rep('numero', 8), ...rep('serie', 4)], [...rep('numero', 7), ...rep('tabela', 5)]] as Forma[][]) {
    const cartoes = mk(mix);
    const cel = layoutGrade(cartoes, true);
    assert.ok(cobreGrade(cel), mix.join());
    const forma = new Map(cartoes.map(c => [c.id, c.forma]));
    const kpiRows = cel.filter(c => forma.get(c.id) === 'numero');
    const otherRows = cel.filter(c => forma.get(c.id) !== 'numero');
    assert.ok(Math.max(...kpiRows.map(c => c.row + c.rowSpan)) <= 3);
    assert.ok(Math.min(...otherRows.map(c => c.row)) >= 3);
  }
});

test('manual order keeps the sequence and has no band', () => {
  const cartoes = mk(['serie', 'numero', 'ranking', 'numero']);
  const cel = layoutGrade(cartoes, false);
  assert.ok(cobreGrade(cel));
  assert.deepEqual(cel.map(c => c.id), ['c0', 'c1', 'c2', 'c3']);
});

test('sizes change widths: grande wider than pequeno in the same row', () => {
  const cartoes = mk(rep('ranking', 5)); cartoes[0].tamanho = 'grande'; cartoes[2].tamanho = 'pequeno';
  const cel = layoutGrade(cartoes, false);
  assert.ok(cobreGrade(cel));
  assert.ok(cel[0].colSpan > cel[1].colSpan && cel[1].colSpan > cel[2].colSpan);
});

test('destaque: one big card and the others on the side, covering the grid', () => {
  for (const n of [1, 2, 3, 4, 6, 8, 12]) {
    const cel = layoutDestaque(mk(['numero', ...rep('serie', n - 1)].slice(0, n) as Forma[]), true);
    assert.ok(cobreGrade(cel), 'n=' + n);
  }
  const cel = layoutDestaque(mk(['numero', 'numero', 'serie']), true);
  assert.equal(cel[0].id, 'c2');
  assert.equal(cel[0].colSpan, 8);
  const grande = mk(['serie', 'tabela', 'ranking']); grande[2].tamanho = 'grande';
  assert.equal(layoutDestaque(grande, true)[0].id, 'c2');
});

test('rotativo: affinity pages group numbers, series, rankings, tables', () => {
  const p = paginasRotativo(mk(['serie', 'numero', 'ranking', 'numero', 'tabela', 'serie', 'serie']));
  assert.deepEqual(p.map(g => g.map(c => c.forma)), [['numero', 'numero'], ['serie', 'serie'], ['serie'], ['ranking'], ['tabela']]);
  assert.equal(paginasRotativo(mk(rep('numero', 8))).length, 2);
});

test('rotativo: explicit pages, unassigned cards go to the last page, empty pages vanish', () => {
  const c = mk(rep('serie', 4)); c[0].pagina = 2; c[1].pagina = 5; c[2].pagina = 2;
  const p = paginasRotativo(c);
  assert.deepEqual(p.map(g => g.map(x => x.id)), [['c0', 'c2'], ['c1', 'c3']]);
  const paginas = layoutPainel('rotativo', c, true);
  assert.deepEqual(paginas.map(x => x.numero), [1, 2]);
  assert.ok(paginas.every(x => cobreGrade(x.celulas)));
});

test('reorganizar: numbers first, sizes auto, pages null', () => {
  const c = mk(['serie', 'numero']).map(x => ({ ...x, tamanho: 'grande' as const, pagina: 3 }));
  const r = reorganizar(c);
  assert.deepEqual(r.map(x => x.id), ['c1', 'c0']);
  assert.ok(r.every(x => x.tamanho === 'auto' && x.pagina === null));
});

test('layout is deterministic and empty input gives empty output', () => {
  const c = mk(['serie', 'numero', 'tabela', 'ranking', 'numero']);
  assert.deepEqual(layoutPainel('grade', c, true), layoutPainel('grade', c, true));
  assert.deepEqual(layoutPainel('grade', [], true), [{ numero: 1, celulas: [] }]);
  assert.deepEqual(layoutPainel('rotativo', [], true), []);
});
