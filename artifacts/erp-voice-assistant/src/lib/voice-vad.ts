/** 100ms PCM frames; only a 300ms pre-roll is retained, never a recording. */

/** How the spoken question is sent: on a short pause (default), on a long pause, or only by the person's tap on "Enviar". */
export type EnvioModo = 'automatico' | 'pausa_longa' | 'eu_envio';
/** Surroundings: higher levels demand more energy to start and ignore frames much quieter than the person's own speech. */
export type AmbienteNivel = 'normal' | 'ruidoso' | 'muito_ruidoso';
export type VadOptions = { envio: EnvioModo; ambiente: AmbienteNivel };
export const VAD_PADRAO: VadOptions = { envio: 'automatico', ambiente: 'normal' };

/** Frames of silence (100 ms each) that end the question in each mode; null means only the explicit tap ends it. */
export const PAUSA_FRAMES: Record<EnvioModo, number | null> = { automatico: 9, pausa_longa: 25, eu_envio: null };
/**
 * Per level: minimum onset energy (RMS of a 100 ms frame, full scale = 1) and the fraction of the person's own speech level
 * below which a frame is treated as a distant voice (does not start, does not extend, is not transcribed).
 * A voice at -12 dB has 25 % of the amplitude; at -9 dB, 35 %; at -6 dB, 50.1 % — so the "very noisy" fraction is 56 % (-5 dB),
 * otherwise a voice exactly 6 dB quieter would sit on the boundary and pass.
 */
export const AMBIENTE: Record<AmbienteNivel, { onset: number; fracao: number }> = {
  normal: { onset: 0.009, fracao: 0 },
  ruidoso: { onset: 0.016, fracao: 0.35 },
  muito_ruidoso: { onset: 0.024, fracao: 0.56 },
};
/** In the long-pause and manual modes the person is warned here (25 s) and the question is sent, not discarded, at the limit. */
export const AVISO_FRAMES = 250;
/** Consecutive quiet frames before they are replaced by silence: shorter dips are the person's own soft syllables. */
const MUDOS_APOS = 3;

export type VadResult = {
  start: boolean; end: boolean; cancel: boolean;
  /** The 25 s warning (once per turn, long-pause and manual modes only). */
  warn: boolean;
  /** `end` happened because the duration limit was reached (long-pause and manual modes). */
  limit: boolean;
  frames: ArrayBuffer[];
  /** What the input indicator shows: this frame's energy, the current onset threshold and whether it counted as speech. */
  level: { rms: number; threshold: number; speech: boolean };
};

export class VoiceVad {
  private preRoll: ArrayBuffer[] = [];
  private preRms: number[] = [];
  private voiced = 0;
  private quiet = 0;
  private frames = 0;
  private noise = 0.003;
  private talking = false;
  private discard = false;
  private warned = false;
  /** Typical energy of the person's own speech in this turn (EMA of accepted speech frames); 0 before the onset. */
  private own = 0;
  /** Memory of `own` across the turns of this conversation, so a distant voice alone does not start a turn. */
  private reference = 0;
  private lowRun = 0;
  private options: VadOptions;
  constructor(private maxFrames = 300, options: Partial<VadOptions> = {}) { this.options = { ...VAD_PADRAO, ...options }; }
  /** Preferences apply from the next frame on, also in the middle of a turn; no reconnection needed. */
  configure(options: Partial<VadOptions>) { this.options = { ...this.options, ...options }; }
  get settings(): VadOptions { return this.options; }
  get open(): boolean { return this.talking; }
  /** Frames of this turn so far (100 ms each). */
  get turnFrames(): number { return this.talking ? this.frames : 0; }

  push(pcm: ArrayBuffer, rms: number, playing = false, speechProbability = 0): VadResult {
    const { onset, fracao } = AMBIENTE[this.options.ambiente];
    const pausa = PAUSA_FRAMES[this.options.envio];
    const threshold = Math.max(playing ? 0.022 : onset, this.noise * (playing ? 4 : 2.5));
    // Distant voices are real speech for the classifier; what tells them apart is energy relative to the person's own voice.
    const base = this.talking ? this.own : this.reference;
    const distant = fracao > 0 && base > 0 && rms < fracao * base;
    const speech = rms > threshold && speechProbability >= (playing ? 0.88 : this.talking ? 0.4 : 0.65) && !distant;
    const result: VadResult = { start: false, end: false, cancel: false, warn: false, limit: false, frames: [], level: { rms, threshold, speech } };
    // Loud transients must not train the floor so high that subsequent real
    // speech is silenced. Classification, not loudness, owns the onset gate.
    if (!this.talking && !playing && speechProbability < 0.2 && rms < 0.08) {
      this.noise = Math.min(0.012, this.noise * 0.98 + rms * 0.02);
    }
    if (this.discard) {
      this.quiet = speech ? 0 : this.quiet + 1;
      if (this.quiet >= 9) { this.discard = false; this.quiet = 0; }
      return result;
    }
    if (!this.talking) {
      this.preRoll.push(pcm); this.preRms.push(rms);
      if (this.preRoll.length > 6) { this.preRoll.shift(); this.preRms.shift(); }
      this.voiced = speech ? this.voiced + 1 : 0;
      if (this.voiced >= (playing ? 3 : 2)) {
        this.talking = true; this.quiet = 0; this.frames = this.preRoll.length; this.warned = false; this.lowRun = 0;
        const onsetFrames = this.preRms.slice(-this.voiced);
        this.own = onsetFrames.reduce((n, v) => n + v, 0) / onsetFrames.length;
        result.start = true; result.frames = this.preRoll;
        this.preRoll = []; this.preRms = [];
      }
      return result;
    }
    this.frames++;
    if (speech) this.own = this.own * 0.85 + rms * 0.15;
    // Quiet stretches (a distant voice, or nothing) are sent as silence after a few frames, so they are never transcribed;
    // the first frames of a dip are kept because the person's own soft syllables look the same for 100-200 ms.
    this.lowRun = distant || rms <= threshold ? this.lowRun + 1 : 0;
    result.frames = [fracao > 0 && distant && this.lowRun >= MUDOS_APOS ? new ArrayBuffer(pcm.byteLength) : pcm];
    this.quiet = speech ? 0 : this.quiet + 1;
    if (this.frames >= this.maxFrames) {
      if (pausa === null || pausa > 9) {
        // Long-pause and manual modes: the question is sent with what was said, not lost.
        result.end = true; result.limit = true; this.finish();
      } else {
        result.cancel = true; result.frames = [];
        this.reset(); this.discard = true;
      }
    } else if (pausa !== null && this.quiet >= pausa) {
      result.end = true; this.finish();
    } else if ((pausa === null || pausa > 9) && !this.warned && this.frames >= AVISO_FRAMES) {
      this.warned = true; result.warn = true;
    }
    return result;
  }
  /** The person's tap on "Enviar": ends the open turn; false when nothing is being said. */
  commit(): boolean { if (!this.talking) return false; this.finish(); return true; }
  /** The person's tap on "Descartar": drops the open turn; false when nothing is being said. */
  drop(): boolean { if (!this.talking) return false; this.reset(); return true; }
  private finish() {
    if (this.own > 0) this.reference = this.reference > 0 ? this.reference * 0.5 + this.own * 0.5 : this.own;
    this.reset();
  }
  reset() {
    this.preRoll = []; this.preRms = []; this.voiced = 0; this.quiet = 0; this.frames = 0;
    this.talking = false; this.discard = false; this.warned = false; this.own = 0; this.lowRun = 0;
  }
}
