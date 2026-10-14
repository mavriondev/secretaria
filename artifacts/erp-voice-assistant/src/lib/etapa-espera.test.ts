import test from 'node:test';
import assert from 'node:assert/strict';
import { ETAPAS_ESPERA, etapaPara } from './etapa-espera';

test('the waiting label follows the stage order and never goes back', () => {
  assert.equal(etapaPara(0), 'Entendendo a pergunta…');
  assert.equal(etapaPara(2499), 'Entendendo a pergunta…');
  assert.equal(etapaPara(2500), 'Consultando…');
  assert.equal(etapaPara(5000), 'Montando a resposta…');
  assert.equal(etapaPara(60_000), 'Quase pronto…');
  const thresholds = ETAPAS_ESPERA.map(e => e.aPartirDeMs);
  assert.deepEqual(thresholds, [...thresholds].sort((a, b) => a - b));
});
