/* AudioWorklet: downsample any device rate to 24kHz mono PCM, 100ms per packet. */
class LiveMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.samples = new Int16Array(2400);
    this.index = 0;
    this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      this.sum += value; this.count++; this.phase += 24000;
      if (this.phase >= sampleRate) {
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.phase -= sampleRate; this.sum = 0; this.count = 0;
        this.energy += sample * sample;
        this.samples[this.index++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
        if (this.index === this.samples.length) {
          const pcm = this.samples.buffer;
          this.port.postMessage({ pcm, rms: Math.sqrt(this.energy / this.index) }, [pcm]);
          this.samples = new Int16Array(2400); this.index = 0; this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('live-microphone', LiveMicrophone);
