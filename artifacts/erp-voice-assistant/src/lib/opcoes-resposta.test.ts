import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelar, escolher, limitarOpcoes, novaResposta, opcoesBloqueadas, respostaCurta, respostaLivre, TRILHA_VAZIA, textoDaTrilha } from './opcoes-resposta';

const o = (n: number) => ({ rotulo: `R${n}`, pergunta: `P${n}` });
test('caps at 4 options for a question and 3 for adjustments, dropping duplicates', () => {
  const lista = [o(1), o(2), o(2), o(3), o(4), o(5)];
  assert.equal(limitarOpcoes(lista, true).length, 4);
  assert.equal(limitarOpcoes(lista, false).length, 3);
  assert.deepEqual(limitarOpcoes([], true), []);
});
test('locks only while a request is in flight', () => {
  const base = { askPendente: false, idResposta: 5, idBase: 5 as number | null | undefined };
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'idle' }), false);
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'listening' }), false);
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'speaking' }), false);
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'connecting' }), true);
  assert.equal(opcoesBloqueadas({ ...base, askPendente: true, estadoVoz: 'idle' }), true);
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'processing' }), true);
  assert.equal(opcoesBloqueadas({ ...base, estadoVoz: 'processing', idResposta: 6 }), false);
});
test('trail follows a chain, stays after the final answer, and clears on a fresh request', () => {
  let t = escolher(TRILHA_VAZIA, 'Cliente: Alfa');
  t = novaResposta(t, true);
  assert.deepEqual(t, { passos: ['Cliente: Alfa'], emCurso: false, finalizada: false });
  t = escolher(t, 'Período: mês passado');
  t = novaResposta(t, false);
  assert.equal(textoDaTrilha(t), 'Cliente: Alfa \u2192 Período: mês passado');
  assert.equal(t.finalizada, true);
  assert.deepEqual(respostaLivre(t, { clarificacao: false, curta: true }), TRILHA_VAZIA);
  assert.deepEqual(novaResposta(respostaLivre(t, { clarificacao: false, curta: true }), false), TRILHA_VAZIA);
  assert.deepEqual(novaResposta(TRILHA_VAZIA, false), TRILHA_VAZIA);
  assert.equal(escolher(t, 'Novo').passos.length, 1);
  assert.deepEqual(cancelar(), TRILHA_VAZIA);
});
test('free reply continues the chain only for a short answer to a clarification', () => {
  const t = novaResposta(escolher(TRILHA_VAZIA, 'Cliente: Alfa'), true);
  const cont = respostaLivre(t, { clarificacao: true, curta: respostaCurta('mês passado') });
  assert.equal(cont.emCurso, true); assert.equal(cont.passos.length, 1);
  assert.equal(novaResposta(cont, false).finalizada, true);
  assert.deepEqual(respostaLivre(t, { clarificacao: true, curta: respostaCurta('quanto vendemos de produtos novos no ano passado em todas as filiais') }), TRILHA_VAZIA);
});
