import type { FastifyInstance } from "fastify";
import { z } from "zod";
import WebSocket from "ws";
import type { VoiceConfig, VoiceServerEvent } from "@workspace/api-zod";
import { answerQuestion } from "../lib/assistant";
import { speechModel, streamSpeech } from "../lib/elevenlabs";
import { getSettings, selectedVoice } from "../lib/preferences";
import { runAsTenant, type Tenant } from "../lib/tenant";
import { withThinkingSpeech } from "../lib/thinking-speech";
import { ElevenScribe } from "../lib/eleven-scribe";
import { db, queryLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LiveTurns } from "../lib/live-turns";
import { spokenAnswer } from "../lib/spoken-answer";
import { pacedSpeechSink } from "../lib/voice-delivery";

export const voiceConfig: VoiceConfig = {
  path: "/api/assistant/live", sampleRate: 24000, maxDurationSeconds: 300,
  idleTimeoutSeconds: 60, maxTurnSeconds: 30, transcriptionModel: "scribe_v2_realtime",
};
const clientEvent = z.object({
  type: z.enum(["start", "speech_start", "audio_append", "commit", "cancel", "stop"]),
  turnId: z.string().min(1).max(80).optional(),
  freedomLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  training: z.boolean().optional(),
  audio: z.string().max(32768).optional(),
}).strict();
let connections = 0;

export async function liveVoiceRoutes(app: FastifyInstance) {
  app.get("/assistant/voice/config", async () => voiceConfig);
  app.route({
    method: "GET", url: "/assistant/live",
    handler: async (_request, reply) => reply.code(426).send({ error: "Use uma conexão WebSocket para iniciar a conversa." }),
    wsHandler: (socket, request) => {
    const origin = request.headers.origin;
    // Match the proxy-visible host, not the internal upstream port.
    const host = String(request.headers["x-forwarded-host"] ?? request.headers.host).split(",")[0]?.trim();
    if (origin && new URL(origin).host !== host) {
      socket.close(1008, "Origem não permitida"); return;
    }
    if (++connections > 4) {
      --connections;
      socket.send(JSON.stringify({ type: "error", message: "Limite de conversas simultâneas atingido.", fatal: true }));
      socket.close(1013); return;
    }
    const turns = new LiveTurns();
    let provider: ElevenScribe | null = null;
    let ready = false, closed = false, lastActivity = Date.now(), startRequested = false;
    const pendingCommits: string[] = [];
    const itemTurns = new Map<string, string>();
    const partials = new Map<string, string>();
    let turnDeadline: ReturnType<typeof setTimeout> | undefined;
    let transcriptionDeadline: ReturnType<typeof setTimeout> | undefined;
    const send = (event: VoiceServerEvent) => {
      if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    };
    const upstream = (event: object) => {
      if (provider?.readyState === WebSocket.OPEN) provider.send(JSON.stringify(event));
    };
    const close = (message: string) => {
      if (closed) return;
      send({ type: "closed", message });
      closed = true;
      clearInterval(idle); clearTimeout(lifetime); clearTimeout(setupDeadline);
      clearTimeout(turnDeadline); clearTimeout(transcriptionDeadline);
      turns.clear(); itemTurns.clear(); partials.clear(); pendingCommits.length = 0;
      provider?.close(); provider = null;
      --connections;
      if (socket.readyState === WebSocket.OPEN) socket.close(1000);
    };
    const fail = (message: string, fatal = false, turnId?: string) => {
      send({ type: "error", message, fatal, ...(turnId ? { turnId } : {}) });
      if (fatal) close(message);
    };
    const idle = setInterval(() => {
      if (Date.now() - lastActivity > voiceConfig.idleTimeoutSeconds * 1000 && !turns.current) close("Conversa encerrada por inatividade.");
    }, 1000);
    const lifetime = setTimeout(() => close("Limite de cinco minutos atingido. Inicie uma nova conversa se quiser continuar."), voiceConfig.maxDurationSeconds * 1000);
    const setupDeadline = setTimeout(() => { if (!ready) fail("Não foi possível conectar a voz. Tente iniciar novamente.", true); }, 20000);
    socket.on("close", () => close("Conversa encerrada."));
    socket.on("error", () => close("Conexão interrompida."));

    // Socket callbacks do not inherit the request context, so the company of the session is carried explicitly.
    const tenant: Tenant = { companyId: request.user!.companyId!, userId: request.user!.id, role: request.user!.role };
    const respond = (id: string, transcript: string) => runAsTenant(tenant, () => respondInTenant(id, transcript));
    const respondInTenant = async (id: string, transcript: string) => {
      const turn = turns.current;
      if (!turn || !turns.isCurrent(id)) return;
      send({ type: "transcript", turnId: id, text: transcript });
      send({ type: "processing", turnId: id });
      try {
        const settings = await getSettings();
        const writeAudio = async (type: "filler_chunk" | "audio_chunk", chunk: Uint8Array, firstAudioMs?: number, signal = turn.controller.signal) => {
          signal.throwIfAborted();
          if (!turns.isCurrent(id)) { turn.controller.abort(); return; }
          while (socket.bufferedAmount > 256 * 1024) {
            signal.throwIfAborted();
            if (socket.readyState !== WebSocket.OPEN) throw new Error("Cliente desconectado");
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          send({ type, turnId: id, audio: Buffer.from(chunk).toString("base64"), ...(firstAudioMs == null ? {} : { firstAudioMs }) });
        };
        if (settings.thinkingSpeech) send({ type: "processing", turnId: id, text: "Preparando sua resposta…" });
        const needsAcknowledgement = !turn.training && /fatur|vend|receb|vencid|consult|pesquis|cota[çc]|d[oó]lar|not[ií]cia|compare|per[ií]odo/i.test(transcript);
        let response = await withThinkingSpeech({ ...settings, thinkingSpeech: settings.thinkingSpeech && needsAcknowledgement }, turn.controller.signal,
          (chunk, signal) => writeAudio("filler_chunk", chunk, undefined, signal), () => answerQuestion(
          { question: transcript, freedomLevel: turn.level, includeVoice: false, ...(turn.training === undefined ? {} : { training: turn.training }) }, transcript, turn.startedAt,
          { signal: turn.controller.signal, context: [...turns.context], settings, voiceMode: true },
        ), undefined, 650);
        if (!turns.isCurrent(id)) return;
        send({ type: "filler_done", turnId: id });
        provider?.discardSpeech();
        const parameters = { ...response.parameters, _voiceMode: "direct-stream",
          _voiceModel: speechModel, _voiceProvider: "elevenlabs", _voiceValidation: "not-performed", _voiceStatus: "generating" };
        response = { ...response, parameters };
        await db.update(queryLogsTable).set({ answer: response.answer, parameters }).where(eq(queryLogsTable.id, response.id));
        if (!turns.isCurrent(id)) return;
        turns.remember(id, { logId: response.id, question: transcript, answer: response.answer, functionName: response.functionName, parameters: response.parameters });
        send({ type: "answer", turnId: id, result: response });
        const generationStart = Date.now();
        let firstAudioMs: number | null = null;
        const play = pacedSpeechSink(async (chunk: Uint8Array) => {
          firstAudioMs ??= Date.now() - turn.startedAt;
          await writeAudio("audio_chunk", chunk, firstAudioMs);
        }, turn.controller.signal);
        {
          send({ type: "processing", turnId: id, text: "Preparando a fala…" });
          try {
            await streamSpeech(spokenAnswer(response), turn.controller.signal, play, selectedVoice(settings));
            parameters._voiceStatus = "completed";
          } catch (error) {
            if (turn.controller.signal.aborted || !turns.isCurrent(id)) throw error;
            parameters._voiceStatus = firstAudioMs === null ? "failed" : "interrupted";
            await db.update(queryLogsTable).set({ parameters }).where(eq(queryLogsTable.id, response.id));
            if (!turns.isCurrent(id)) return;
            request.log.warn({ errorName: error instanceof Error ? error.name : "unknown" }, "Speech generation failed; text retained");
            send({ type: "error", fatal: false, turnId: id, message: "A geração de voz foi interrompida. A resposta completa está em texto; você pode continuar a conversa." });
            turns.current = null; lastActivity = Date.now();
            return;
          }
          if (!turns.isCurrent(id)) return;
          await db.update(queryLogsTable).set({ parameters }).where(eq(queryLogsTable.id, response.id));
        }
        if (!turns.isCurrent(id)) return;
        send({ type: "audio_done", turnId: id, firstAudioMs: firstAudioMs ?? 0, generationMs: Date.now() - generationStart });
        request.log.info({ firstAudioMs, generationMs: Date.now() - generationStart }, "Live voice timing (no audio retained)");
        turns.current = null; lastActivity = Date.now();
      } catch (error) {
        if (turn.controller.signal.aborted || closed || !turns.isCurrent(id)) return;
        request.log.warn({ errorName: error instanceof Error ? error.name : "unknown" }, "Live voice turn failed");
        turns.cancel();
        fail("A OpenAI não conseguiu concluir esta resposta. O texto calculado, se já concluído, está na auditoria. Fale novamente ou use texto.", false, id);
      }
    };

    socket.on("message", raw => runAsTenant(tenant, async () => {
      try {
        const event = clientEvent.parse(JSON.parse(raw.toString()));
        if (event.type === "stop") { close("Conversa encerrada."); return; }
        if (event.type === "start") {
          if (startRequested) return;
          startRequested = true;
          const settings = await getSettings();
          if (closed) return;
          provider = new ElevenScribe(e => {
            if (closed) return;
            if (e.type === "session.updated" || e.type === "transcription_session.updated") {
              ready = true; clearTimeout(setupDeadline); send({ type: "ready" });
            } else if (e.type === "input_audio_buffer.committed") {
              const pendingId = pendingCommits.shift();
              if (e.item_id && pendingId) {
                itemTurns.set(e.item_id, pendingId);
              }
              if (pendingId && turns.isCurrent(pendingId)) {
                clearTimeout(transcriptionDeadline);
                transcriptionDeadline = setTimeout(() => {
                  if (turns.isCurrent(pendingId)) {
                    turns.cancel();
                    fail("A transcrição demorou demais. Fale novamente.", false, pendingId);
                  }
                  itemTurns.clear(); partials.clear();
                }, 20000);
              }
            } else if (e.type === "conversation.item.input_audio_transcription.delta" && e.item_id) {
              const id = itemTurns.get(e.item_id);
              if (!id || !turns.isCurrent(id)) return;
              const text = ((partials.get(e.item_id) ?? "") + (e.delta ?? "")).slice(0, 2000);
              partials.set(e.item_id, text);
              send({ type: "transcript_delta", turnId: id, text });
            } else if (e.type === "conversation.item.input_audio_transcription.completed" && e.item_id) {
              const id = itemTurns.get(e.item_id);
              itemTurns.delete(e.item_id); partials.delete(e.item_id);
              if (!id || !turns.isCurrent(id)) return;
              clearTimeout(transcriptionDeadline);
              const text = e.transcript?.trim();
              if (!text || text.length > 2000) {
                turns.cancel(); fail("Não foi possível identificar uma pergunta curta. Fale novamente.", false, id); return;
              }
              void respond(id, text);
            } else if (e.type === "conversation.item.input_audio_transcription.failed") {
              const id = e.item_id ? itemTurns.get(e.item_id) : undefined;
              if (id && turns.isCurrent(id)) { turns.cancel(); fail("Falha na transcrição. Fale novamente.", false, id); }
            } else if (e.type === "error") {
              request.log.warn({ providerCode: e.error?.code }, "ElevenLabs transcription failed");
              fail(e.error?.code === "late_live_transcript"
                ? "A transcrição recebeu uma correção tardia. A resposta foi cancelada por segurança; inicie novamente."
                : "A conexão ElevenLabs falhou. Confira as permissões e o saldo, ou use texto.", true);
            }
          }, () => { if (!closed) fail("A conexão com a ElevenLabs foi encerrada. Inicie novamente.", true); });
          return;
        }
        if (!ready) throw new Error("A voz ainda não está conectada.");
        if (!event.turnId) throw new Error("Turno ausente.");
        if (event.type === "speech_start") {
          const previous = turns.current?.id;
          turns.begin(event.turnId, event.freedomLevel ?? 1, event.training);
          lastActivity = Date.now();
          clearTimeout(turnDeadline); clearTimeout(transcriptionDeadline);
          itemTurns.clear(); partials.clear();
          upstream({ type: "input_audio_buffer.clear" });
          if (previous) send({ type: "cancelled", turnId: previous });
          turnDeadline = setTimeout(() => { turns.cancel(); fail("Pergunta muito longa. Faça uma pergunta de até trinta segundos.", true); }, (voiceConfig.maxTurnSeconds + 2) * 1000);
        } else if (event.type === "audio_append") {
          if (!turns.isCurrent(event.turnId) || turns.current!.committed) return;
          if (!event.audio || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw new Error("Áudio inválido.");
          const bytes = Buffer.from(event.audio, "base64");
          if (bytes.length % 2 || bytes.length > 16000) throw new Error("Formato PCM inválido.");
          turns.current!.bytes += bytes.length;
          if (turns.current!.bytes > voiceConfig.sampleRate * 2 * voiceConfig.maxTurnSeconds) throw new Error("Pergunta muito longa.");
          if (provider!.bufferedAmount > 256 * 1024) throw new Error("A rede não está acompanhando o microfone.");
          upstream({ type: "input_audio_buffer.append", audio: event.audio });
        } else if (event.type === "commit") {
          if (!turns.isCurrent(event.turnId) || turns.current!.committed) return;
          clearTimeout(turnDeadline);
          if (turns.current!.bytes < 4800) throw new Error("Fala muito curta.");
          turns.current!.committed = true;
          // First-audio measurement starts at end of speech, not at the first syllable.
          turns.current!.startedAt = Date.now();
          if (pendingCommits.length >= 4) throw new Error("Muitas perguntas aguardando confirmação.");
          pendingCommits.push(event.turnId);
          transcriptionDeadline = setTimeout(() => fail("A ElevenLabs não confirmou a pergunta. Inicie a conversa novamente.", true), 15000);
          upstream({ type: "input_audio_buffer.commit" });
        } else if (event.type === "cancel" && turns.isCurrent(event.turnId)) {
          turns.cancel(); clearTimeout(turnDeadline);
          upstream({ type: "input_audio_buffer.clear" });
          send({ type: "cancelled", turnId: event.turnId });
        }
      } catch {
        fail("Não foi possível processar o áudio desta sessão. Encerre e inicie novamente.", true);
      }
    }));
    },
  });
}
