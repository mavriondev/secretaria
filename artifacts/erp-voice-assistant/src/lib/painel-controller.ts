/** Mirror age, never the time of the last successful network request. */
export function idadeDado(iso: string, agora: number): string {
  const date = Date.parse(iso);
  if (!Number.isFinite(date)) return 'sem data';
  const minutes = Math.max(0, Math.floor((agora - date) / 60_000));
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d` : minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}min`;
}
import type { PainelCartaoPublico, PainelPublico } from '@workspace/api-client-react';

/**
 * Polling controller of the TV page. Pure logic with injected clock and fetcher, so it is testable without a browser.
 * Rules: one request at a time; the next one is scheduled only after the previous ended; failure keeps the last data
 * and retries with backoff; any 404 clears everything and stops for good; stop() aborts and clears the timer.
 */
export type TvFase = 'carregando' | 'ok' | 'desativado';
export type TvEstado = { fase: TvFase; painel: PainelPublico | null; ultimoSucessoEm: number | null; falhas: number; ciclo: number };

export const ESTADO_INICIAL: TvEstado = { fase: 'carregando', painel: null, ultimoSucessoEm: null, falhas: 0, ciclo: 0 };
export const CICLO_REINICIO_MS = 6 * 3600_000;
const RETRY_MIN_MS = 15_000;

/**
 * Merges a new answer into the previous one. The new list is authoritative (omitted cards disappear). A card in error
 * keeps the previous data only when it has the same opaque key; a removed card never shows data.
 */
export function mesclar(anterior: PainelPublico | null, novo: PainelPublico): PainelPublico {
  const antes = new Map((anterior?.cartoes ?? []).map(c => [c.chave, c]));
  const cartoes: PainelCartaoPublico[] = novo.cartoes.map(c => {
    if (c.estado === 'removido') return { ...c, dados: null };
    if (c.estado === 'erro') { const a = antes.get(c.chave); return a?.dados ? { ...c, dados: a.dados, atualizadoEm: a.atualizadoEm } : { ...c, dados: null }; }
    return c;
  });
  return { ...novo, cartoes };
}

/** Delay before the next request: the panel interval after success, backoff (15 s, 30 s, ...) capped by it after failure. */
export function proximoAtrasoMs(atualizacaoSegundos: number, falhas: number): number {
  const intervalo = Math.max(60, atualizacaoSegundos) * 1000;
  if (falhas <= 0) return intervalo;
  return Math.min(intervalo, RETRY_MIN_MS * 2 ** (falhas - 1));
}

/** Minutes of delay to show ("desatualizado há X min"), or null while the data is within its normal window. */
export function minutosDesatualizado(agora: number, ultimoSucessoEm: number | null, atualizacaoSegundos: number): number | null {
  if (ultimoSucessoEm === null) return null;
  const idade = agora - ultimoSucessoEm;
  if (idade <= Math.max(60, atualizacaoSegundos) * 1000 * 1.5 + 5_000) return null;
  return Math.max(1, Math.floor(idade / 60_000));
}

export const statusDe = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

export type Deps = {
  buscar: (sinal: AbortSignal) => Promise<PainelPublico>;
  agora: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  aoMudar: (e: TvEstado) => void;
};

export class PainelPoller {
  private estado: TvEstado = ESTADO_INICIAL;
  private timer: unknown = null;
  private ctl: AbortController | null = null;
  private parado = true;
  private emVoo = false;
  private inicio = 0;

  constructor(private d: Deps) {}

  get atual() { return this.estado; }
  get requisicaoEmVoo() { return this.emVoo; }
  get temTimer() { return this.timer !== null; }

  private set(p: Partial<TvEstado>) { this.estado = { ...this.estado, ...p }; this.d.aoMudar(this.estado); }

  start() {
    if (!this.parado) return;
    this.parado = false;
    this.inicio = this.d.agora();
    this.d.aoMudar(this.estado);
    void this.ciclo();
  }

  /** Aborts the request, clears the timer and (optionally) forgets the data: used when the address changes. */
  stop(limpar = false) {
    this.parado = true;
    if (this.timer !== null) { this.d.clearTimer(this.timer); this.timer = null; }
    this.ctl?.abort(); this.ctl = null; this.emVoo = false;
    if (limpar) { this.estado = ESTADO_INICIAL; this.d.aoMudar(this.estado); }
  }

  private agendar(ms: number) {
    if (this.parado) return;
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = this.d.setTimer(() => { this.timer = null; void this.ciclo(); }, ms);
  }

  /** Immediate refresh (for example when the tab comes back); ignored while a request is in flight. */
  atualizarAgora() { if (this.parado || this.emVoo) return; if (this.timer !== null) { this.d.clearTimer(this.timer); this.timer = null; } void this.ciclo(); }

  private async ciclo() {
    if (this.parado || this.emVoo) return;
    // Long-running restart: after hours open, drop timers/controllers and bump the cycle (the page remounts its tree).
    if (this.d.agora() - this.inicio >= CICLO_REINICIO_MS) { this.inicio = this.d.agora(); this.set({ ciclo: this.estado.ciclo + 1 }); }
    const ctl = new AbortController();
    this.ctl = ctl; this.emVoo = true;
    try {
      const novo = await this.d.buscar(ctl.signal);
      if (this.parado || ctl.signal.aborted) return;
      this.emVoo = false;
      this.set({ fase: 'ok', painel: mesclar(this.estado.painel, novo), ultimoSucessoEm: this.d.agora(), falhas: 0 });
      this.agendar(proximoAtrasoMs(novo.atualizacaoSegundos, 0));
    } catch (e) {
      if (this.parado || ctl.signal.aborted) return;
      this.emVoo = false;
      if (statusDe(e) === 404) { this.stop(); this.estado = { ...ESTADO_INICIAL, fase: 'desativado', ciclo: this.estado.ciclo }; this.d.aoMudar(this.estado); return; }
      const falhas = this.estado.falhas + 1;
      this.set({ falhas });
      this.agendar(proximoAtrasoMs(this.estado.painel?.atualizacaoSegundos ?? 300, falhas));
    } finally {
      if (this.ctl === ctl) { this.ctl = null; this.emVoo = false; }
    }
  }
}
