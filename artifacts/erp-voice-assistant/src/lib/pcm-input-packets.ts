export type InputPacket = { pcm: ArrayBuffer; rms: number };

/** Bounded 100ms / 24kHz PCM packets for the compatibility capture path. */
export class PcmInputPackets {
  private phase = 0;
  private sum = 0;
  private count = 0;
  private index = 0;
  private energy = 0;
  private samples = new Int16Array(2400);
  constructor(private rate: number, private emit: (packet: InputPacket) => void) {}
  push(input: Float32Array) {
    for (const value of input) {
      this.sum += value; this.count++; this.phase += 24000;
      if (this.phase < this.rate) continue;
      const sample = Math.max(-1, Math.min(1, this.sum / this.count));
      this.phase -= this.rate; this.sum = 0; this.count = 0;
      this.energy += sample * sample;
      this.samples[this.index++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      if (this.index === 2400) {
        const packet = { pcm: this.samples.buffer, rms: Math.sqrt(this.energy / 2400) };
        this.samples = new Int16Array(2400); this.index = 0; this.energy = 0;
        this.emit(packet);
      }
    }
  }
  reset() { this.phase = this.sum = this.count = this.index = this.energy = 0; this.samples = new Int16Array(2400); }
}
