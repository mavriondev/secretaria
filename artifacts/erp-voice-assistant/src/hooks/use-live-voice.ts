import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceConfig, getVoiceAvailability, type AssistantResponse, type VoiceClientEvent, type VoiceServerEvent } from '@workspace/api-client-react';
import { appUrl } from '@/lib/app-path';
import { VoiceVad } from '@/lib/voice-vad';
import { createMicrophoneCapture, type MicrophoneCapture } from '../lib/microphone-capture';
import { PcmSpeaker } from '@/lib/pcm-speaker';
import { beforeVoiceCapture, VoicePreflightWarning } from '../lib/voice-preflight';

type State = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';
type Options = { level: 0 | 1 | 2; onAnswer: (answer: AssistantResponse) => void; /** Training state the user set with the button; the server keeps it between turns. */ training?: boolean | null };
const encode = (pcm: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(pcm)));
const decode = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));

export function useLiveVoice(options: Options) {
  const [state, setState] = useState<State>('idle');
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [readWarning, setReadWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const opts = useRef(options); opts.current = options;
  const mounted = useRef(true);
  const epoch = useRef(0);
  const alive = useRef(false);
  const stage = useRef<State>('idle');
  const ws = useRef<WebSocket | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const media = useRef<MediaStream | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const capture = useRef<MicrophoneCapture | null>(null);
  const speaker = useRef<PcmSpeaker | null>(null);
  const vad = useRef<VoiceVad | null>(null);
  const classifier = useRef<Awaited<ReturnType<typeof import('../lib/speech-classifier').createSpeechClassifier>> | null>(null);
  const inference = useRef<Promise<void>>(Promise.resolve());
  const configRequest = useRef<AbortController | null>(null);
  const currentTurn = useRef<string | null>(null);
  const startedAt = useRef(0);
  const generationDone = useRef(false);
  const heardFirst = useRef(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setStage = useCallback((value: State) => { stage.current = value; if (mounted.current) setState(value); }, []);
  const send = useCallback((message: VoiceClientEvent) => {
    if (ws.current?.readyState !== WebSocket.OPEN) throw new Error('A conexão de voz foi interrompida. Inicie novamente.');
    if (ws.current.bufferedAmount > 128 * 1024) throw new Error('A conexão está lenta demais para voz ao vivo. Use texto ou inicie novamente.');
    ws.current.send(JSON.stringify(message));
  }, []);
  const release = useCallback(() => {
    epoch.current++; alive.current = false;
    if (startupTimer.current) clearTimeout(startupTimer.current);
    configRequest.current?.abort(); configRequest.current = null;
    const socket = ws.current; ws.current = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
      socket.close();
    }
    capture.current?.stop(); capture.current = null;
    source.current?.disconnect(); source.current = null;
    media.current?.getTracks().forEach(t => t.stop()); media.current = null;
    speaker.current?.stop(); speaker.current = null;
    const ctx = audioContext.current; audioContext.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    vad.current?.reset(); vad.current = null;
    const detector = classifier.current; classifier.current = null;
    if (detector) void inference.current.finally(() => detector.close()).catch(() => {});
    currentTurn.current = null; generationDone.current = false;
    if (mounted.current) { setActive(false); setTranscript(''); setFirstAudioMs(null); }
  }, []);
  const stop = useCallback(() => {
    release(); setStage('idle');
    setReadWarning(false);
    if (mounted.current) { setError(null); setNotice('Conversa encerrada. O texto permanece na auditoria; o áudio e o contexto da sessão foram descartados.'); }
  }, [release, setStage]);
  const fail = useCallback((message: string) => {
    release(); setStage('error');
    if (mounted.current) { setError(message); setNotice(null); }
  }, [release, setStage]);
  const interrupt = useCallback(() => {
    speaker.current?.stop(); generationDone.current = false;
    const id = currentTurn.current; currentTurn.current = null;
    if (id && ws.current?.readyState === WebSocket.OPEN) send({ type: 'cancel', turnId: id });
    vad.current?.reset();
    setStage('listening'); setNotice('Fala interrompida. Pode fazer outra pergunta.');
  }, [send, setStage]);

  const start = useCallback(async (allowUnconfirmed = false) => {
    if (alive.current) return;
    const session = ++epoch.current;
    alive.current = true; setActive(true); setStage('connecting');
    setError(null); setNotice(null); setTranscript(''); setFirstAudioMs(null);
    setReadWarning(false);
    const valid = () => mounted.current && alive.current && epoch.current === session;
    startupTimer.current = setTimeout(() => {
      if (valid() && stage.current === 'connecting') fail('Não foi possível iniciar o áudio a tempo. Verifique a permissão do microfone e a conexão, e toque em iniciar novamente.');
    }, 30000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error('Este navegador não suporta a conversa contínua. Use texto ou um navegador atualizado.');
      }
      // Resume inside the initial user gesture, not after asynchronous provider work.
      const ctx = new AudioContext(); audioContext.current = ctx;
      if (ctx.sampleRate < 24000) throw new Error('O dispositivo não suporta a taxa de áudio necessária. Use texto ou outro dispositivo.');
      await ctx.resume();
      if (!valid()) return;
      configRequest.current = new AbortController();
      const micPromise = beforeVoiceCapture(
        () => getVoiceAvailability({ signal: configRequest.current!.signal }),
        () => {
          if (!valid()) throw new Error('Sessão encerrada.');
          return navigator.mediaDevices.getUserMedia({ audio: {
            echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
          } });
        },
        allowUnconfirmed,
      ).then(mic => {
        if (!valid()) { mic.getTracks().forEach(t => t.stop()); throw new Error('Sessão encerrada.'); }
        media.current = mic;
        return mic;
      });
      const [config, mic] = await Promise.all([getVoiceConfig({ signal: configRequest.current.signal }), micPromise]);
      if (!valid()) return;
      mic.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (valid()) fail('O microfone foi desconectado. Conecte-o e inicie novamente.');
      }));
      ctx.onstatechange = () => {
        if (valid() && stage.current !== 'connecting' && ctx.state === 'suspended') {
          fail('O navegador suspendeu o áudio. Toque em iniciar novamente para liberar microfone e som.');
        }
      };
      if (ctx.state !== 'running') throw new Error('O navegador bloqueou o áudio. Toque em iniciar novamente.');
      const microphone = await createMicrophoneCapture(ctx, configRequest.current!.signal, () => {
        if (valid()) fail('O processamento do microfone falhou. Encerre e inicie novamente ou use texto.');
      });
      if (!valid()) { microphone.stop(); return; }
      capture.current = microphone;
      const { createSpeechClassifier } = await import('../lib/speech-classifier');
      if (!valid()) return;
      const detector = await createSpeechClassifier(configRequest.current!.signal);
      if (!valid()) { await detector.close(); return; }
      classifier.current = detector;
      if (microphone.compatibility) setNotice('Modo de captura compatível ativo. A conversa continua ao vivo, sem gravações.');
      vad.current = new VoiceVad(config.maxTurnSeconds * 10);
      speaker.current = new PcmSpeaker(ctx, () => {
        if (valid() && generationDone.current && stage.current === 'speaking') setStage('listening');
      });
      const node = microphone.node;
      source.current = ctx.createMediaStreamSource(mic);
      source.current.connect(node);
      // Processor outputs silence; connection keeps it running without mic feedback.
      node.connect(ctx.destination);
      const url = new URL(appUrl(config.path), window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => {
        if (valid()) {
          try { send({ type: 'start' }); }
          catch (e) { fail(e instanceof Error ? e.message : 'Falha ao iniciar a conexão de voz.'); }
        }
      };
      let connected = false;
      socket.onmessage = event => {
        if (!valid()) return;
        try {
          const message = JSON.parse(event.data) as VoiceServerEvent;
          if (message.type === 'ready') {
            connected = true;
            if (startupTimer.current) clearTimeout(startupTimer.current);
            setNotice('Voz ativa: respostas em streaming, sem revisão prévia do áudio.');
            setStage('listening'); return;
          }
          if (message.type === 'closed') {
            const reason = message.message;
            release(); setStage('idle'); setNotice(reason ?? 'Conversa encerrada.'); return;
          }
          if (message.type === 'error') {
            if (message.fatal) { fail(message.message ?? 'Falha na conexão de voz.'); return; }
            if (message.turnId && message.turnId !== currentTurn.current) return;
            speaker.current?.stop(); currentTurn.current = null;
            setNotice(null);
            setError(message.message ?? 'Falha na resposta. Fale novamente.'); setStage('listening'); return;
          }
          if (message.turnId !== currentTurn.current) return;
          if (message.type === 'transcript_delta' || message.type === 'transcript') setTranscript(message.text ?? '');
           if (message.type === 'processing') {
             setStage('processing');
             if (message.text) setNotice(message.text);
           }
           if (message.type === 'filler_chunk' && message.audio) {
             if (ctx.state !== 'running') throw new Error('A reprodução de áudio foi bloqueada. Inicie a conversa novamente.');
             speaker.current!.enqueue(decode(message.audio));
             setStage('processing');
           }
           if (message.type === 'filler_done') speaker.current?.stop();
           if (message.type === 'answer') setNotice(null);
          if (message.type === 'answer' && message.result) opts.current.onAnswer(message.result);
          if (message.type === 'audio_chunk' && message.audio) {
            setNotice(null);
            if (ctx.state !== 'running') throw new Error('A reprodução de áudio foi bloqueada. Encerre e inicie a conversa para liberar o som.');
            const delay = speaker.current!.enqueue(decode(message.audio));
            if (!heardFirst.current) {
              heardFirst.current = true;
              setFirstAudioMs(Math.round(performance.now() - startedAt.current + delay));
            }
            setStage('speaking');
          }
          if (message.type === 'audio_done') {
            setNotice(null);
            generationDone.current = true;
            if (!speaker.current?.playing) setStage('listening');
          }
          if (message.type === 'cancelled') { speaker.current?.stop(); currentTurn.current = null; setStage('listening'); }
        } catch (e) { fail(e instanceof Error ? e.message : 'Falha na reprodução de áudio.'); }
      };
      socket.onerror = () => { if (valid()) fail('Não foi possível conectar a voz. Verifique a rede e tente novamente.'); };
      socket.onclose = () => { if (valid()) fail('A conexão de voz foi perdida. Inicie novamente; o histórico textual foi preservado.'); };
      let queued = 0;
      inference.current = Promise.resolve();
      microphone.setHandler(packet => {
        if (!valid() || !connected || ctx.state !== 'running') return;
        if (++queued > 8) { fail('O aparelho não está conseguindo analisar a fala em tempo real. Encerre outros aplicativos ou use texto.'); return; }
        inference.current = inference.current.then(async () => {
        try {
          if (!valid()) return;
          const probability = await detector.probability(packet.pcm);
          if (!valid()) return;
          const detection = vad.current!.push(packet.pcm, packet.rms, speaker.current?.playing, probability);
          if (detection.start) {
            speaker.current?.stop();
            generationDone.current = false; heardFirst.current = false;
            currentTurn.current = crypto.randomUUID();
            setError(null); setNotice(null); setTranscript(''); setFirstAudioMs(null); setStage('listening');
            send({ type: 'speech_start', turnId: currentTurn.current, freedomLevel: opts.current.level, ...(opts.current.training == null ? {} : { training: opts.current.training }) });
          }
          const id = currentTurn.current;
          if (!id) return;
          if (detection.cancel) {
            send({ type: 'cancel', turnId: id }); currentTurn.current = null;
            setError('Faça uma pergunta de até trinta segundos. O áudio longo foi descartado.'); setStage('listening'); return;
          }
          for (const frame of detection.frames) send({ type: 'audio_append', turnId: id, audio: encode(frame) });
          if (detection.end) {
            startedAt.current = performance.now();
            send({ type: 'commit', turnId: id }); setStage('processing');
          }
        } catch (e) { if (valid()) fail(e instanceof Error ? e.message : 'Falha no microfone.'); }
        finally { queued--; }
        });
      });
    } catch (e) {
      if (!valid()) return;
      const message = e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'O microfone ou áudio foi bloqueado. Libere a permissão do navegador e toque em iniciar novamente.'
        : e instanceof Error ? e.message : 'Não foi possível iniciar a conversa.';
      fail(message);
      if (e instanceof VoicePreflightWarning && mounted.current) setReadWarning(true);
    }
  }, [fail, release, send, setStage]);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden && alive.current) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', hidden); release(); };
  }, [release, stop]);
  return { state, active, transcript, error, readWarning, notice, firstAudioMs, start, stop, interrupt };
}
