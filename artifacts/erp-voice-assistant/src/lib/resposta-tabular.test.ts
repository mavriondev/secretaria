import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filtrar, formaEfetiva, linhasVisiveis, mostrarBusca, neutralizar, ordenar, paraCsv, paraTsv, proximaOrdem, temBloco, textoSemLista } from './resposta-tabular';
import { RespostaEmTabela } from '@/components/resposta-em-tabela';

const cols = [{ name: 'nome', label: 'Nome', type: 'texto' }, { name: 'v', label: 'Valor', type: 'dinheiro' }, { name: 'd', label: 'Data', type: 'data' }];
const rows = [{ nome: 'Beta', v: '10', d: '2025-02-01' }, { nome: 'Alfa', v: '9', d: '2025-01-15' }, { nome: '=SUM(A1)', v: null, d: null }, { nome: 'Cé', v: '-3', d: '2024-12-31' }];
const tab = (extra = {}) => ({ columns: cols, rows, truncated: false, updatedAt: null, executadoEm: '2025-01-01T00:00:00Z', forma: 'tabela', formas: ['tabela'], dados: { columns: cols, rows }, ...extra }) as never;

test('sort numeric, date, text; nulls last', () => {
  assert.deepEqual(ordenar(rows, cols, { coluna: 'v', dir: 'asc' }).map(r => r.nome), ['Cé', 'Alfa', 'Beta', '=SUM(A1)']);
  assert.deepEqual(ordenar(rows, cols, { coluna: 'v', dir: 'desc' }).map(r => r.nome), ['Beta', 'Alfa', 'Cé', '=SUM(A1)']);
  assert.equal(ordenar(rows, cols, { coluna: 'd', dir: 'asc' })[0]!.nome, 'Cé');
  assert.equal(ordenar(rows, cols, { coluna: 'nome', dir: 'asc' })[0]!.nome, '=SUM(A1)');
  assert.equal(proximaOrdem(null, 'v')!.dir, 'asc'); assert.equal(proximaOrdem({ coluna: 'v', dir: 'desc' }, 'v'), null);
});
test('search ignores accents; shown above 15 rows', () => {
  assert.equal(filtrar(rows, cols, 'ce').length, 1);
  assert.equal(mostrarBusca(15), false); assert.equal(mostrarBusca(16), true);
});
test('expand shows 10 then all', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ nome: String(i) }));
  assert.equal(linhasVisiveis(many, false).length, 10); assert.equal(linhasVisiveis(many, true).length, 30);
});
test('form falls back when preference is incompatible', () => {
  assert.equal(formaEfetiva('serie', tab() as never), 'tabela');
  assert.equal(formaEfetiva('texto', tab() as never), 'texto');
  assert.equal(formaEfetiva('automatico', tab() as never), 'tabela');
  assert.equal(temBloco({ rows: [1], columns: [1] }), false); assert.equal(temBloco({ rows: [1, 2, 3, 4], columns: [1] }), true);
});
test('csv/tsv neutralize formulas, quote, BOM, null empty', () => {
  assert.equal(neutralizar('  =1+1'), "'  =1+1"); assert.equal(neutralizar('-3', true), '-3'); assert.equal(neutralizar('-abc', true), "'-abc");
  const csv = paraCsv([{ nome: 'a"b,c', v: null, d: '@x' }], cols, true);
  assert.ok(csv.startsWith('\uFEFF"Nome"')); assert.match(csv, /"a""b,c","","'@x"/);
  assert.equal(paraTsv([{ nome: 'a\tb', v: '1', d: null }], cols).split('\r\n')[1], 'a b\t1\t');
});
test('graphic text hides list lines only', () => {
  const t = 'Total R$ 10 (dados de 09:30)\n1. A\n2) B\n- C\n| x | y |\nObs: parcial';
  assert.equal(textoSemLista(t), 'Total R$ 10 (dados de 09:30)\nObs: parcial');
});
test('SSR: table, sticky, count, truncated warning, text mode original', () => {
  const h = renderToStaticMarkup(createElement(RespostaEmTabela, { texto: 'Cab\n1. x', tabular: tab({ truncated: true }) }));
  assert.match(h, /sticky/); assert.match(h, /—/); assert.match(h, /4 linhas carregadas/); assert.match(h, /aviso-truncado/); assert.match(h, /Ver como texto/); assert.doesNotMatch(h, /1\. x/);
  const t = renderToStaticMarkup(createElement(RespostaEmTabela, { texto: 'Cab\n1. x', tabular: tab(), preferencia: 'texto' }));
  assert.match(t, /1\. x/);
});

test('graphic text drops unnumbered rows matched by label+cell, keeps other prose', () => {
  const pc = [{ name: 'p', label: 'Produto', type: 'texto' }, { name: 'v', label: 'Valor', type: 'dinheiro' }];
  const prod = { columns: pc, rows: [{ p: 'Feijão carioca 1kg', v: '31353.6' }, { p: 'Arroz 5kg', v: '20000' }] };
  const t1 = 'Os produtos mais vendidos (dados de 09:30):\nFeijão carioca 1kg — linha 6: R$\u00a031.353,60\nArroz 5kg: R$ 20.000,00\nArroz 5kg subiu bastante este mês.';
  assert.equal(textoSemLista(t1, prod), 'Os produtos mais vendidos (dados de 09:30):\nArroz 5kg subiu bastante este mês.');
  const dc = [{ name: 'c', label: 'Cliente / faixa de atraso', type: 'texto' }, { name: 'v', label: 'Valor', type: 'dinheiro' }];
  const dev = { columns: dc, rows: [{ c: 'Comercial Serrana 39', v: '99493.5' }, { c: 'Atraso: 1-30 dias', v: '443738.03' }] };
  const t2 = 'Há R$ 543.231,53 vencidos (dados de 10:00).\nMaiores devedores:\nComercial Serrana 39: R$ 99.493,50\nPor faixa de atraso:\n1-30 dias: R$ 443.738,03\nComercial Serrana 39 pediu prazo.';
  assert.equal(textoSemLista(t2, dev), 'Há R$ 543.231,53 vencidos (dados de 10:00).\nComercial Serrana 39 pediu prazo.');
  assert.equal(textoSemLista('Cab\nMaiores devedores:\nSem nada', dev), 'Cab\nMaiores devedores:\nSem nada');
});
test('interactive table shows every column, including *_id', () => {
  const c = [{ name: 'titulo_id', label: 'Título', type: 'inteiro' }, { name: 'n', label: 'Nome', type: 'texto' }];
  const h = renderToStaticMarkup(createElement(RespostaEmTabela, { texto: 'x', tabular: tab({ columns: c, rows: [{ titulo_id: '7', n: 'a' }], dados: { columns: c, rows: [] } }) }));
  assert.match(h, />Título</);
});
