/** 100ms PCM frames; only a 300ms pre-roll is retained, never a recording. */
export class VoiceVad {
  private preRoll: ArrayBuffer[] = [];
  private voiced = 0;
  private quiet = 0;
  private frames = 0;
  private noise = 0.003;
  private talking = false;
  private discard = false;
  constructor(private maxFrames = 300) {}
  push(pcm: ArrayBuffer, rms: number, playing = false, speechProbability = 0) {
    const result = { start: false, end: false, cancel: false, frames: [] as ArrayBuffer[] };
    const threshold = Math.max(playing ? 0.022 : 0.009, this.noise * (playing ? 4 : 2.5));
    const speech = rms > threshold && speechProbability >= (playing ? 0.88 : this.talking ? 0.4 : 0.65);
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
      this.preRoll.push(pcm);
      if (this.preRoll.length > 6) this.preRoll.shift();
      this.voiced = speech ? this.voiced + 1 : 0;
      if (this.voiced >= (playing ? 3 : 2)) {
        this.talking = true; this.quiet = 0; this.frames = this.preRoll.length;
        result.start = true; result.frames = this.preRoll;
        this.preRoll = [];
      }
    } else {
      result.frames = [pcm]; this.frames++;
      this.quiet = speech ? 0 : this.quiet + 1;
      if (this.frames >= this.maxFrames) {
        result.cancel = true; result.frames = [];
        this.reset(); this.discard = true;
      } else if (this.quiet >= 9) {
        result.end = true; this.reset();
      }
    }
    return result;
  }
  reset() {
    this.preRoll = []; this.voiced = 0; this.quiet = 0; this.frames = 0;
    this.talking = false; this.discard = false;
  }
}
