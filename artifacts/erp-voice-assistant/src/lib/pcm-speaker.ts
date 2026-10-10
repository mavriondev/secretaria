/** Network chunk boundaries need not align with 16-bit sample boundaries. */
export class Pcm16Decoder {
  private carry: number | null = null;
  decode(bytes: Uint8Array): Float32Array<ArrayBuffer> {
    let data = bytes;
    if (this.carry !== null) {
      data = new Uint8Array(bytes.length + 1); data[0] = this.carry; data.set(bytes, 1);
    }
    this.carry = data.length % 2 ? data[data.length - 1]! : null;
    const count = Math.floor(data.length / 2);
    const floats = new Float32Array(count);
    const view = new DataView(data.buffer, data.byteOffset, count * 2);
    for (let i = 0; i < count; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
    return floats;
  }
  reset() { this.carry = null; }
}

export class PcmSpeaker {
  private decoder = new Pcm16Decoder();
  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  constructor(private context: AudioContext, private drained: () => void) {}
  get playing() { return this.sources.size > 0; }
  // A bounded acknowledgement can end mid-network packet. Do not carry its
  // last byte into the independently generated financial answer.
  resetDecoder() { this.decoder.reset(); }
  enqueue(bytes: Uint8Array): number {
    const samples = this.decoder.decode(bytes);
    if (!samples.length) return 0;
    if (this.nextStart - this.context.currentTime > 60) throw new Error('A resposta em voz excedeu o limite de reprodução. Consulte o texto na auditoria.');
    const audio = this.context.createBuffer(1, samples.length, 24000);
    audio.copyToChannel(samples, 0);
    const node = this.context.createBufferSource();
    node.buffer = audio; node.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.03, this.nextStart);
    this.nextStart = start + audio.duration;
    this.sources.add(node);
    node.onended = () => {
      node.disconnect(); this.sources.delete(node);
      if (!this.sources.size) { this.nextStart = 0; this.drained(); }
    };
    node.start(start);
    return (start - this.context.currentTime) * 1000;
  }
  stop() {
    for (const node of this.sources) { node.onended = null; try { node.stop(); } catch { /* Already ended. */ } node.disconnect(); }
    this.sources.clear(); this.nextStart = 0; this.decoder.reset();
  }
}
