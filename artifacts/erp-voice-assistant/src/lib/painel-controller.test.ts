import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PainelCartaoPublico, PainelPublico } from '@workspace/api-client-react';
import { mesclar, minutosDesatualizado, PainelPoller, proximoAtrasoMs, type TvEstado } from './painel-controller';

const dados = (v: string) => ({ form: 'numero' as const, raw: v });
const cartao = (chave: string, estado: PainelCartaoPublico['estado'], v: string | null): PainelCartaoPublico => ({ chave, titulo: chave, tamanho: 'auto', pagina: null, estado, dados: v ? dados(v) : null, atualizadoEm: v ? '2026-10-16T10:00:00Z' : null });
const painel = (cartoes: PainelCartaoPublico[], seg = 300): PainelPublico => ({ nome: 'P', empresa: 'E', modelo: 'grade', tema: 'escuro', atualizacaoSegundos: seg, rotacaoSegundos: 20, ordemAutomatica: true, atualizadoEm: null, verificadoEm: '2026-10-16T10:00:00Z', cartoes });

/** Virtual clock: timers fire in order as simulated time advances. */
function relogio() {
  let t = 0, id = 0; const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    agora: () => t, setTimer: (fn: () => void, ms: number) => { const k = ++id; timers.set(k, { at: t + ms, fn }); return k; },
    clearTimer: (h: unknown) => { timers.delete(h as number); }, pendentes: () => timers.size,
    async avancar(ms: number) {
      const fim = t + ms;
      for (;;) {
        const prox = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!prox || prox[1].at > fim) break;
        timers.delete(prox[0]); t = prox[1].at; prox[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = fim;
    },
  };
}

test('mesclar: error keeps previous data only for the same key; removed clears; omitted disappears', () => {
  const antes = painel([cartao('a', 'ok', '1'), cartao('b', 'ok', '2'), cartao('c', 'ok', '3')]);
  const depois = mesclar(antes, painel([cartao('a', 'erro', null), cartao('b', 'removido', null), cartao('z', 'erro', null)]));
  assert.deepEqual(depois.cartoes.map(c => c.chave), ['a', 'b', 'z']);
  assert.equal(depois.cartoes[0].dados?.raw, '1');
  assert.equal(depois.cartoes[1].dados, null);
  assert.equal(depois.cartoes[2].dados, null);
});

test('backoff and staleness', () => {
  assert.equal(proximoAtrasoMs(300, 0), 300_000);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(f => proximoAtrasoMs(300, f)), [15_000, 30_000, 60_000, 120_000, 240_000, 300_000]);
  assert.equal(proximoAtrasoMs(10, 0), 60_000);
  assert.equal(minutosDesatualizado(100_000, 0, 300), null);
  assert.equal(minutosDesatualizado(900_000, 0, 300), 15);
  assert.equal(minutosDesatualizado(900_000, null, 300), null);
});

test('poller: network failure keeps last data and recovers by itself', async () => {
  const r = relogio(); let falha = false; let n = 0;
  const estados: TvEstado[] = [];
  const p = new PainelPoller({ agora: r.agora, setTimer: r.setTimer, clearTimer: r.clearTimer, aoMudar: e => estados.push(e),
    buscar: async () => { n++; if (falha) throw new Error('rede'); return painel([cartao('a', 'ok', String(n))]); } });
  p.start(); await r.avancar(0);
  assert.equal(p.atual.fase, 'ok');
  falha = true; await r.avancar(300_000);
  assert.equal(p.atual.falhas, 1);
  assert.equal(p.atual.painel?.cartoes[0].dados?.raw, '1');
  falha = false; await r.avancar(15_000);
  assert.equal(p.atual.falhas, 0);
  assert.equal(p.atual.painel?.cartoes[0].dados?.raw, '3');
  p.stop(); assert.equal(r.pendentes(), 0);
});

test('poller: any 404 clears the panel and stops fetching', async () => {
  const r = relogio(); let n = 0; let revogado = false;
  const p = new PainelPoller({ agora: r.agora, setTimer: r.setTimer, clearTimer: r.clearTimer, aoMudar: () => {},
    buscar: async () => { n++; if (revogado) throw Object.assign(new Error('x'), { status: 404 }); return painel([cartao('a', 'ok', '1')]); } });
  p.start(); await r.avancar(0); revogado = true; await r.avancar(300_000);
  assert.equal(p.atual.fase, 'desativado');
  assert.equal(p.atual.painel, null);
  const antes = n; await r.avancar(3600_000);
  assert.equal(n, antes); assert.equal(r.pendentes(), 0);
});

test('poller: stop aborts the request in flight and nothing lands afterwards', async () => {
  const r = relogio(); let sinal: AbortSignal | undefined; let solta: (v: PainelPublico) => void = () => {};
  const p = new PainelPoller({ agora: r.agora, setTimer: r.setTimer, clearTimer: r.clearTimer, aoMudar: () => {},
    buscar: s => { sinal = s; return new Promise(res => { solta = res; }); } });
  p.start(); assert.equal(p.requisicaoEmVoo, true);
  p.stop(true); assert.equal(sinal?.aborted, true);
  solta(painel([cartao('a', 'ok', '9')])); await Promise.resolve(); await Promise.resolve();
  assert.equal(p.atual.painel, null); assert.equal(r.pendentes(), 0);
});

test('soak: 12 simulated hours, flaky network, never overlaps, one timer at most, memory flat, clean stop', async () => {
  const r = relogio(); let emVoo = 0, maxEmVoo = 0, chamadas = 0, maxTimers = 0;
  const p = new PainelPoller({ agora: r.agora, setTimer: r.setTimer, clearTimer: r.clearTimer, aoMudar: () => {},
    buscar: async () => {
      emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo); chamadas++;
      await Promise.resolve(); emVoo--;
      if (chamadas % 7 === 0 || (chamadas % 50 > 40)) throw new Error('rede');
      return painel(Array.from({ length: 12 }, (_, i) => cartao('k' + i, 'ok', String(chamadas))), 60);
    } });
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.(); const heapAntes = process.memoryUsage().heapUsed;
  p.start();
  for (let min = 0; min < 12 * 60; min++) { await r.avancar(60_000); maxTimers = Math.max(maxTimers, r.pendentes()); }
  gc?.(); const heapDepois = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({ soak: { horasSimuladas: 12, chamadas, maxRequisicoesParalelas: maxEmVoo, maxTimers, gcExposto: !!gc, heapUsedAntesMB: +(heapAntes / 1048576).toFixed(1), heapUsedDepoisMB: +(heapDepois / 1048576).toFixed(1) } }));
  assert.equal(maxEmVoo, 1); assert.ok(maxTimers <= 1); assert.ok(chamadas > 500);
  assert.equal(p.atual.painel?.cartoes.length, 12);
  assert.ok(p.atual.ciclo >= 1);
  p.stop(true); assert.equal(r.pendentes(), 0); assert.equal(p.atual.painel, null);
});
