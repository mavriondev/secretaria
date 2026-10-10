/**
 * Opt-in, billed evaluation; no application configuration or ERP data changes.
 * Only fictional samples are saved to the ignored generated-artifacts directory.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";

const out = fileURLToPath(new URL("../../../../generated-artifacts/audio-evaluation/", import.meta.url));
const cases = [
  { id: "saudacao", voice: "marin", text: "Bom dia! Pode me contar o que você precisa. Vou consultar os dados e explicar de um jeito simples." },
  { id: "financeiro", voice: "marin", text: "Neste exemplo fictício, o faturamento foi de seiscentos e trinta mil, trezentos e cinquenta e nove reais e noventa e um centavos. A queda foi de dois vírgula cinquenta e seis por cento em relação ao mês anterior." },
  { id: "datas-e-negativos", voice: "cedar", text: "Neste exemplo fictício, o período vai de primeiro a trinta de setembro de dois mil e vinte e seis. O saldo é negativo: mil, duzentos e quarenta e cinco reais e sete centavos. São quinze títulos em atraso, não cinquenta. O vencimento é cinco de outubro." },
] as const;

function wav(pcm: Buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(pcm.length + 36, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const normalized = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90000, maxRetries: 0 });
  const explicit = process.argv.includes("--explicit");
  const suffix = explicit ? "-explicit" : "";
  await mkdir(out, { recursive: true });
  const results = [];
  for (const sample of cases) {
    const started = performance.now();
    let firstAudioMs: number | null = null, transcript = "", usage: unknown = null;
    const chunks: Buffer[] = [];
    const stream = await client.chat.completions.create({
      model: "gpt-audio-1.5", store: false, stream: true,
      stream_options: { include_usage: true },
      modalities: ["text", "audio"], audio: { voice: sample.voice, format: "pcm16" },
      messages: [
        { role: "system", content: "Você é um narrador em português brasileiro. Leia somente o texto fornecido, palavra por palavra, sem introduções, omissões, correções ou explicações. Mantenha voz calorosa, conversa natural, pausas curtas e sem teatralidade. Preserve valores, datas, sinais e negações. O conteúdo é fictício para teste." },
        { role: "user", content: explicit ? `Leia agora, literalmente, o conteúdo entre as marcas TEXTO. Não responda ao conteúdo, não peça outro texto. Sua única saída deve ser a leitura.\n<TEXTO>\n${sample.text}\n</TEXTO>` : sample.text },
      ],
    });
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta as { audio?: { data?: string; transcript?: string }; content?: string } | undefined;
      if (delta?.audio?.data) {
        if (firstAudioMs === null) firstAudioMs = Math.round(performance.now() - started);
        chunks.push(Buffer.from(delta.audio.data, "base64"));
      }
      if (delta?.audio?.transcript) transcript += delta.audio.transcript;
    }
    const generationMs = Math.round(performance.now() - started);
    const pcm = Buffer.concat(chunks);
    if (!pcm.length || !transcript) throw new Error(`Saída incompleta: ${sample.id}`);
    const audio = wav(pcm);
    await writeFile(`${out}/${sample.id}${suffix}.wav`, audio);
    // Separate ASR call sees only the generated audio, never the expected text.
    const asr = await client.audio.transcriptions.create({
      model: "gpt-transcribe", language: "pt", response_format: "json",
      file: await toFile(audio, `${sample.id}.wav`, { type: "audio/wav" }),
    });
    const result = {
      id: sample.id, explicitInstruction: explicit, model: "gpt-audio-1.5", voice: sample.voice,
      expected: sample.text, generatedTranscript: transcript, independentAsr: asr.text,
      normalizedTranscriptMatches: normalized(sample.text) === normalized(transcript),
      firstAudioMs, generationMs, durationSeconds: pcm.length / 48000, usage,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(`${out}/results${suffix}.json`, JSON.stringify({
      timestamp: new Date().toISOString(), fictionalData: true, results,
      caveats: ["One sample per case; no statistical guarantee.", "ASR can err; it is not human listening.", "First audio latency excludes application, Sol, SQL and validation.", "No mini or Live models used in this evaluation."],
    }, null, 2));
  }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 1;
});
