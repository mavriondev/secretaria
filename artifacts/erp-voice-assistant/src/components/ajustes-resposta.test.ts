import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AjustesDaResposta } from './ajustes-resposta';

const op = [{ rotulo: 'Alfa', pergunta: 'cliente Alfa' }, { rotulo: 'Beta', pergunta: 'cliente Beta' }];
const fn = () => {};
const html = (p: Partial<Parameters<typeof AjustesDaResposta>[0]>) => renderToStaticMarkup(createElement(AjustesDaResposta, { hipotese: null, ajustes: op, pergunta: true, onEscolher: fn, desabilitado: false, onFalar: fn, onDigitar: fn, onCancelar: fn, ...p }));

test('renders numbered options and the three fixed exits', () => {
  const h = html({});
  assert.match(h, /1\) Alfa/); assert.match(h, /Responder por voz/); assert.match(h, /Digitar/); assert.match(h, /Cancelar/);
});
test('exits exist with zero options', () => {
  const h = html({ ajustes: [] });
  assert.match(h, /Responder por voz/); assert.doesNotMatch(h, /button-ajuste-0/);
});
test('chosen option is marked, others inactive and disabled', () => {
  const h = html({ escolhida: 'cliente Beta' });
  assert.match(h, /data-estado="escolhida"/); assert.match(h, /data-estado="inativa"[^>]*|disabled/);
  assert.equal((h.match(/disabled/g) ?? []).length >= 2, true);
});
test('dismissed choices disappear but the trail stays', () => {
  const h = html({ ocultas: true, trilha: { passos: ['Cliente: Alfa'], emCurso: false, finalizada: false } });
  assert.doesNotMatch(h, /Responder por voz/); assert.match(h, /Cliente: Alfa/);
});
test('adjustments (non-question) show no exits', () => {
  assert.doesNotMatch(html({ pergunta: false }), /Responder por voz/);
});
