import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolvePublicUrl } from './public-url';

test('shared links use the public domain, never the old IP or development prefix', () => {
  assert.equal(resolvePublicUrl('/redefinir', 'https://www.oitato.com.br/', '/tato', 'https://187.77.232.164'),
    'https://www.oitato.com.br/redefinir');
  assert.equal(resolvePublicUrl('/api/ingestao', 'https://www.oitato.com.br', '/preview', 'https://dev.example'),
    'https://www.oitato.com.br/api/ingestao');
});
test('development retains its own origin and base path', () => {
  assert.equal(resolvePublicUrl('/redefinir', undefined, '/preview', 'https://dev.example'),
    'https://dev.example/preview/redefinir');
  assert.equal(resolvePublicUrl('/redefinir', undefined, '', 'https://dev.example'),
    'https://dev.example/redefinir');
});
test('invalid public configurations fail explicitly', () => {
  for (const value of ['http://example.com', 'https://user:password@example.com', 'https://example.com?q=1']) {
    assert.throws(() => resolvePublicUrl('/redefinir', value, '', 'https://dev.example'));
  }
});
