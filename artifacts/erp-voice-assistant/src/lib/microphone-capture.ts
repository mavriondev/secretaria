import processorModule from './microphone-worklet.js?raw';
import { PcmInputPackets, type InputPacket } from './pcm-input-packets';

export type MicrophoneCapture = {
  node: AudioNode;
  compatibility: boolean;
  setHandler: (handler: (packet: InputPacket) => void) => void;
  stop: () => void;
};

export async function createMicrophoneCapture(
  ctx: AudioContext, signal: AbortSignal, onError: () => void,
): Promise<MicrophoneCapture> {
  let registered = false;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    const url = URL.createObjectURL(new Blob([processorModule], { type: 'text/javascript' }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ctx.audioWorklet.addModule(url),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worklet unavailable')), 2500); }),
      ]);
      registered = true;
    } catch { /* A visible compatibility notice is provided by the caller. */ }
    finally { clearTimeout(timer); URL.revokeObjectURL(url); }
  }
  signal.throwIfAborted();
  if (registered) {
    const node = new AudioWorkletNode(ctx, 'live-microphone');
    node.onprocessorerror = onError;
    return {
      node, compatibility: false,
      setHandler: handler => { node.port.onmessage = event => handler(event.data as InputPacket); },
      stop: () => { node.onprocessorerror = null; node.port.onmessage = null; node.port.close(); node.disconnect(); },
    };
  }
  if (typeof ctx.createScriptProcessor !== 'function') throw new Error('Este navegador não disponibiliza captura contínua compatível. Use texto.');
  const node = ctx.createScriptProcessor(2048, 1, 1);
  let handler: ((packet: InputPacket) => void) | null = null;
  const packets = new PcmInputPackets(ctx.sampleRate, packet => handler?.(packet));
  node.onaudioprocess = event => {
    try {
      event.outputBuffer.getChannelData(0).fill(0); // Never play microphone input.
      packets.push(event.inputBuffer.getChannelData(0));
    } catch { onError(); }
  };
  return {
    node, compatibility: true,
    setHandler: value => { handler = value; },
    stop: () => { node.onaudioprocess = null; handler = null; packets.reset(); node.disconnect(); },
  };
}
