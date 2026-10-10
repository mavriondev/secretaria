import * as ort from 'onnxruntime-web/wasm';
import modelUrl from '@ricky0123/vad-web/dist/silero_vad_v5.onnx?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

/** Local Silero inference. No microphone bytes leave the browser for classification.
 * Model/WASM are build assets supplied by pinned dependencies, not recordings.
 */
export async function createSpeechClassifier(signal: AbortSignal) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
  const response = await fetch(modelUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
  if (!response.ok) throw new Error('Não foi possível carregar o reconhecimento de fala. Use texto ou tente novamente.');
  const session = await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ['wasm'] });
  if (signal.aborted) { await session.release(); signal.throwIfAborted(); }
  let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]);
  let context = new Float32Array(64);
  let pending = new Float32Array(0);
  let closed = false;
  return {
    async probability(pcm: ArrayBuffer): Promise<number> {
      if (closed) return 0;
      const samples = new Int16Array(pcm);
      const converted = new Float32Array(Math.floor(samples.length * 2 / 3));
      for (let i = 0; i < converted.length; i++) {
        const position = i * 1.5, left = Math.floor(position), fraction = position - left;
        converted[i] = ((samples[left] ?? 0) * (1 - fraction) + (samples[left + 1] ?? samples[left] ?? 0) * fraction) / 32768;
      }
      const all = new Float32Array(pending.length + converted.length);
      all.set(pending); all.set(converted, pending.length);
      let count = 0, sum = 0, offset = 0;
      while (!closed && offset + 512 <= all.length) {
        const frame = all.subarray(offset, offset + 512);
        const input = new Float32Array(576);
        input.set(context); input.set(frame, 64);
        const tensor = new ort.Tensor('float32', input, [1, 576]);
        let output: ort.InferenceSession.ReturnType;
        try { output = await session.run({ input: tensor, state, sr }); }
        finally { tensor.dispose(); }
        state.dispose();
        state = output.stateN!;
        const probability = Number(output.output!.data[0]);
        output.output!.dispose();
        if (!Number.isFinite(probability)) throw new Error('O detector de fala retornou um resultado inválido.');
        sum += probability; count++;
        context = frame.slice(-64); offset += 512;
      }
      pending = all.slice(offset);
      return count ? sum / count : 0;
    },
    async close() {
      if (closed) return;
      closed = true;
      pending = new Float32Array(0); context.fill(0);
      await session.release();
      state.dispose(); sr.dispose();
    },
  };
}
