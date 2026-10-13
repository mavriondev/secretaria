/** Opt-in, single paid round. PCM stays in memory and is cleared on exit. */
import { ElevenLabsError, streamSpeech, transcriptionModel, speechModel } from "../lib/elevenlabs";
import { ElevenScribe } from "../lib/eleven-scribe";

async function main() {
  if (!process.argv.includes("--confirm-paid")) throw new Error("Use --confirm-paid para autorizar uma única rodada curta com consumo ElevenLabs.");
  if (!process.env.ELEVENLABS_API_KEY?.trim()) throw new ElevenLabsError("configuration");
  const controller = new AbortController();
  const chunks: Buffer[] = [];
  let scribe: ElevenScribe | undefined;
  let pcm: Buffer | undefined;
  const deadline = setTimeout(() => controller.abort(), 30000);
  try {
    await streamSpeech("Teste de voz do Tato.", controller.signal, async chunk => { chunks.push(Buffer.from(chunk)); });
    pcm = Buffer.concat(chunks);
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error("A rodada de voz excedeu trinta segundos."));
      controller.signal.addEventListener("abort", abort, { once: true });
      scribe = new ElevenScribe(event => {
        if (event.type === "transcription_session.updated") {
          scribe!.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
          for (let i = 0; i < pcm!.length; i += 24000) {
            scribe!.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm!.subarray(i, i + 24000).toString("base64") }));
          }
          scribe!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        } else if (event.type === "conversation.item.input_audio_transcription.completed") {
          controller.signal.removeEventListener("abort", abort);
          if (!event.transcript?.trim()) reject(new Error("Scribe retornou uma transcrição vazia."));
          else resolve();
        } else if (event.type === "error") {
          reject(new Error("Scribe não confirmou a transcrição. Confira a permissão Speech to Text e o saldo."));
        }
      }, () => reject(new Error("Scribe encerrou a conexão antes da transcrição.")));
      if (controller.signal.aborted) abort();
    });
    process.stdout.write(`OK: streaming ${speechModel}, transcrição ${transcriptionModel}, PCM 24000. Sem arquivo de áudio.\n`);
  } finally {
    clearTimeout(deadline); controller.abort(); scribe?.close();
    pcm?.fill(0); for (const chunk of chunks) chunk.fill(0);
  }
}
main().catch(error => {
  // Only explicit application messages, never SDK/network error details.
  process.stderr.write(`${error instanceof ElevenLabsError ? error.message : "Verificação não concluída. Confira a chave, permissões, saldo e conectividade; não repita automaticamente."}\n`);
  process.exitCode = 1;
});
