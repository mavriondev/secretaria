import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceConfig, getVoiceAvailability, type AssistantResponse, type VoiceClientEvent, type VoiceServerEvent } from '@workspace/api-client-react';
import { appUrl } from '@/lib/app-path';
import { VoiceVad, type VadOptions } from '@/lib/voice-vad';
import { createMicrophoneCapture, type MicrophoneCapture } from '../lib/microphone-capture';
import { PcmSpeaker } from '@/lib/pcm-speaker';
import { beforeVoiceCapture, VoicePreflightWarning } from '../lib/voice-preflight';
import { MicrophoneHold, microphonePermission, microphoneReadyEnabled, type MicrophonePermission } from '../lib/microphone-hold';
import { RetainedResource } from '../lib/retained-resource';
import { VoiceStartupTiming } from '../lib/voice-startup-timing';

type State = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';
type Options = {
  level: 0 | 1 | 2; onAnswer: (answer: AssistantResponse) => void;
  /** Training state the user set with the button; the server keeps it between turns. */
  training?: boolean | null;
  /** How the question is sent and how noisy the surroundings are; read at every frame, so a change applies to the next question without reconnecting. */
  preferencias?: Partial<VadOptions>;
};
/** What the browser reports it applied to the microphone (booleans only; no audio, no identifiers). */
export type CaptureInfo = { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null; compatibility: boolean };
export type InputLevel = { rms: number; threshold: number; speech: boolean };
const silentLevel: InputLevel = { rms: 0, threshold: 0, speech: false };
const encode = (pcm: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(pcm)));
const decode = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));

export function useLiveVoice(options: Options) {
  const [state, setState] = useState<State>('idle');
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Technical cause behind a humanised error, for diagnostics only; the person never needs it to act. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [readWarning, setReadWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  /** What the browser says about the microphone permission; 'unknown' when it does not say (Safari). */
  const [micPermission, setMicPermission] = useState<MicrophonePermission>('unknown');
  /** A question is being said (turn open): in the manual mode this is when "Enviar" and "Descartar" make sense. */
  const [turnOpen, setTurnOpen] = useState(false);
  const [inputLevel, setInputLevel] = useState<InputLevel>(silentLevel);
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null);
  const permission = useRef<MicrophonePermission>('unknown'); permission.current = micPermission;
  const opts = useRef(options); opts.current = options;
  const mounted = useRef(true);
  const epoch = useRef(0);
  const alive = useRef(false);
  const stage = useRef<State>('idle');
  const ws = useRef<WebSocket | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const media = useRef<MediaStream | null>(null);
  // The stream outlives one conversation (parked, tracks disabled) so the browser is asked once per screen session.
  const hold = useRef<MicrophoneHold | null>(null);
  const trackWatch = useRef<(() => void) | null>(null);
  const holder = () => (hold.current ??= new MicrophoneHold(navigator.mediaDevices, { keep: microphoneReadyEnabled }));
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const capture = useRef<MicrophoneCapture | null>(null);
  const speaker = useRef<PcmSpeaker | null>(null);
  const vad = useRef<VoiceVad | null>(null);
  const classifier = useRef<Awaited<ReturnType<typeof import('../lib/speech-classifier').createSpeechClassifier>> | null>(null);
  const inference = useRef<Promise<void>>(Promise.resolve());
  const startupTrace = useRef<VoiceStartupTiming | null>(null);
  const resource = useRef<RetainedResource<NonNullable<typeof classifier.current>> | null>(null);
  const detectorResource = () => (resource.current ??= new RetainedResource(
    async signal => {
      const trace = startupTrace.current ?? new VoiceStartupTiming();
      const { createSpeechClassifier } = await trace.measure('classifier_import', () => import('../lib/speech-classifier'));
      return createSpeechClassifier(signal, (phase, operation) => trace.measure(phase, operation));
    },
    detector => detector.reset(),
    detector => detector.close(),
  ));
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
  /** Ends a conversation. The microphone is parked for the next one, or really released (`drop`) when the screen goes away or the track died. */
  const release = useCallback((microphone: 'park' | 'drop' = 'park') => {
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
    trackWatch.current?.(); trackWatch.current = null; media.current = null;
    if (microphone === 'drop') hold.current?.dispose(); else hold.current?.park();
    speaker.current?.stop(); speaker.current = null;
    const ctx = audioContext.current; audioContext.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    vad.current?.reset(); vad.current = null;
    classifier.current = null;
    if (microphone === 'drop') void resource.current?.dispose(inference.current).catch(() => {});
    else resource.current?.park(inference.current);
    startupTrace.current = null;
    currentTurn.current = null; generationDone.current = false;
    if (mounted.current) { setActive(false); setTranscript(''); setFirstAudioMs(null); setTurnOpen(false); setInputLevel(silentLevel); }
  }, []);
  const stop = useCallback(() => {
    release(); setStage('idle');
    setReadWarning(false);
    if (mounted.current) { setError(null); setNotice('Conversa encerrada. O texto permanece na auditoria; o áudio e o contexto da sessão foram descartados.'); }
  }, [release, setStage]);
  const fail = useCallback((message: string, detail?: string, microphone: 'park' | 'drop' = 'park') => {
    release(microphone); setStage('error');
    if (detail) console.error('[voz]', detail);
    if (mounted.current) { setError(message); setErrorDetail(detail ?? null); setNotice(null); }
  }, [release, setStage]);
  const interrupt = useCallback(() => {
    speaker.current?.stop(); generationDone.current = false;
    const id = currentTurn.current; currentTurn.current = null;
    if (id && ws.current?.readyState === WebSocket.OPEN) send({ type: 'cancel', turnId: id });
    vad.current?.reset(); setTurnOpen(false);
    setStage('listening'); setNotice('Fala interrompida. Pode fazer outra pergunta.');
  }, [send, setStage]);
  /** The person's tap on "Enviar" (manual mode, also valid in the others): sends what was said so far, exactly like the end of speech does. */
  const sendNow = useCallback(() => {
    const id = currentTurn.current;
    if (!id || !vad.current?.commit()) return;
    try {
      startedAt.current = performance.now();
      send({ type: 'commit', turnId: id }); setStage('processing'); setTurnOpen(false); setNotice(null);
    } catch (e) { fail(e instanceof Error ? e.message : 'Falha ao enviar a pergunta.'); }
  }, [fail, send, setStage]);
  /** The person's tap on "Descartar": drops what was said; the conversation stays open for a new question. */
  const discardTurn = useCallback(() => {
    const id = currentTurn.current;
    if (!id || !vad.current?.drop()) return;
    currentTurn.current = null;
    try { send({ type: 'cancel', turnId: id }); } catch { /* the server drops the turn when the connection is gone anyway */ }
    setTurnOpen(false); setTranscript(''); setStage('listening'); setNotice('Descartado. Pode falar de novo.');
  }, [send, setStage]);

  const start = useCallback(async (allowUnconfirmed = false) => {
    if (alive.current) return;
    const session = ++epoch.current;
    alive.current = true; setActive(true); setStage('connecting'); setPreparing(true);
    const trace = new VoiceStartupTiming(); startupTrace.current = trace;
    setError(null); setErrorDetail(null); setNotice(null); setTranscript(''); setFirstAudioMs(null);
    setReadWarning(false);
    const valid = () => mounted.current && alive.current && epoch.current === session;
    startupTimer.current = setTimeout(() => {
      // No "check the permission" when the browser already told us it is granted.
      if (valid() && stage.current === 'connecting') fail(permission.current === 'granted' ? 'Não foi possível iniciar o áudio a tempo. Verifique a conexão e toque em iniciar novamente.' : 'Não foi possível iniciar o áudio a tempo. Verifique a permissão do microfone e a conexão, e toque em iniciar novamente.');
    }, 30000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error('Este navegador não suporta a conversa contínua. Use texto ou um navegador atualizado.');
      }
      // Resume inside the initial user gesture, not after asynchronous provider work.
      const ctx = new AudioContext(); audioContext.current = ctx;
      if (ctx.sampleRate < 24000) throw new Error('O dispositivo não suporta a taxa de áudio necessária. Use texto ou outro dispositivo.');
      await trace.measure('audio_resume', () => ctx.resume());
      if (!valid()) return;
      configRequest.current = new AbortController();
      const micPromise = beforeVoiceCapture(
        () => trace.measure('availability', () => getVoiceAvailability({ signal: configRequest.current!.signal })),
        () => {
          if (!valid()) throw new Error('Sessão encerrada.');
          return trace.measure('permission', () => holder().acquire({ audio: microphoneConstraints(opts.current.preferencias?.ambiente ?? 'normal') }) as Promise<MediaStream>);
        },
        allowUnconfirmed,
      ).then(async mic => {
        if (!valid()) { holder().park(); throw new Error('Sessão encerrada.'); }
        // A parked stream keeps the constraints of the conversation that opened it: re-apply the current ones (best effort).
        const wanted = microphoneConstraints(opts.current.preferencias?.ambiente ?? 'normal');
        await Promise.all(mic.getAudioTracks().map(track => typeof track.applyConstraints === 'function' ? track.applyConstraints(wanted).catch(() => {}) : Promise.resolve()));
        if (!valid()) { holder().park(); throw new Error('Sessão encerrada.'); }
        media.current = mic;
        return mic;
      });
      // Independent local preparation can overlap advisory/config/permission I/O.
      // No socket or paid provider connection exists before the tap or preflight.
      const capturePromise = trace.measure('worklet', () => createMicrophoneCapture(ctx, configRequest.current!.signal, () => {
        if (valid()) fail('O processamento do microfone falhou. Encerre e inicie novamente ou use texto.');
      })).then(microphone => {
        if (!valid()) { microphone.stop(); throw new DOMException('Sessão encerrada', 'AbortError'); }
        capture.current = microphone;
        return microphone;
      });
      const detectorPromise = trace.measure('classifier', () => detectorResource().acquire(configRequest.current!.signal)).catch(e => {
        if (valid() && !(e instanceof DOMException && e.name === 'AbortError')) {
          fail('Não consegui preparar o microfone neste aparelho. Tente novamente.', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        }
        throw e;
      });
      const [config, mic, microphone, detector] = await Promise.all([
        trace.measure('config', () => getVoiceConfig({ signal: configRequest.current!.signal })),
        micPromise, capturePromise, detectorPromise,
      ]);
      if (!valid()) return;
      // The track may serve several conversations: this conversation's listener is removed at release.
      const onEnded = () => { if (valid()) fail('O microfone foi desconectado. Conecte-o e inicie novamente.', undefined, 'drop'); };
      mic.getAudioTracks().forEach(track => track.addEventListener('ended', onEnded));
      trackWatch.current = () => mic.getAudioTracks().forEach(track => track.removeEventListener('ended', onEnded));
      ctx.onstatechange = () => {
        if (valid() && stage.current !== 'connecting' && ctx.state === 'suspended') {
          fail('O navegador suspendeu o áudio. Toque em iniciar novamente para liberar microfone e som.');
        }
      };
      if (ctx.state !== 'running') throw new Error('O navegador bloqueou o áudio. Toque em iniciar novamente.');
      classifier.current = detector;
      setPreparing(false);
      const applied = captureSettings(mic, microphone.compatibility);
      setCaptureInfo(applied);
      if (microphone.compatibility) setNotice('Modo de captura compatível ativo. A conversa continua ao vivo, sem gravações.');
      vad.current = new VoiceVad(config.maxTurnSeconds * 10, opts.current.preferencias);
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
      const socketStarted = performance.now();
      let providerStarted = 0;
      ws.current = socket;
      socket.onopen = () => {
        if (valid()) {
          trace.record('ws_open', performance.now() - socketStarted);
          providerStarted = performance.now();
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
            trace.record('start_ready', performance.now() - providerStarted);
            if (message.upstreamMs != null) trace.record('upstream', message.upstreamMs);
            send({ type: 'startup_timing', durations: trace.finish(), capture: { ...applied, ambiente: opts.current.preferencias?.ambiente ?? 'normal', envio: opts.current.preferencias?.envio ?? 'automatico' } });
            connected = true;
            if (startupTimer.current) clearTimeout(startupTimer.current);
            setNotice('Pronto. Voz ativa: respostas em streaming, sem revisão prévia do áudio.');
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
          const detector_ = vad.current!;
          if (opts.current.preferencias) detector_.configure(opts.current.preferencias);
          const detection = detector_.push(packet.pcm, packet.rms, speaker.current?.playing, probability);
          if (mounted.current && stage.current === 'listening') setInputLevel(detection.level);
          if (detection.start) {
            speaker.current?.stop();
            generationDone.current = false; heardFirst.current = false;
            currentTurn.current = crypto.randomUUID();
            setError(null); setNotice(null); setTranscript(''); setFirstAudioMs(null); setStage('listening'); setTurnOpen(true);
            send({ type: 'speech_start', turnId: currentTurn.current, freedomLevel: opts.current.level, ...(opts.current.training == null ? {} : { training: opts.current.training }) });
          }
          const id = currentTurn.current;
          if (!id) return;
          if (detection.cancel) {
            send({ type: 'cancel', turnId: id }); currentTurn.current = null; setTurnOpen(false);
            setError('Faça uma pergunta de até trinta segundos. O áudio longo foi descartado.'); setStage('listening'); return;
          }
          for (const frame of detection.frames) send({ type: 'audio_append', turnId: id, audio: encode(frame) });
          if (detection.warn) setNotice('Já são 25 segundos de fala. Aos 30, envio o que você falou até aqui.');
          if (detection.end) {
            startedAt.current = performance.now();
            send({ type: 'commit', turnId: id }); setStage('processing'); setTurnOpen(false);
            setNotice(detection.limit ? 'Limite de 30 segundos: enviei o que você falou até aqui.' : null);
          }
        } catch (e) { if (valid()) fail(e instanceof Error ? e.message : 'Falha no microfone.'); }
        finally { queued--; }
        });
      });
    } catch (e) {
      if (!valid()) return;
      // Browser/device failures are translated; our own messages (already in plain words) pass through.
      const device: Record<string, string> = {
        NotAllowedError: 'O microfone ou áudio foi bloqueado. Libere a permissão do navegador e toque em iniciar novamente.',
        NotFoundError: 'Não encontrei um microfone neste aparelho. Conecte ou libere um microfone e tente novamente.',
        NotReadableError: 'O microfone está em uso por outro aplicativo ou indisponível. Feche o outro aplicativo e tente novamente.',
        OverconstrainedError: 'O microfone deste aparelho não atende ao formato de áudio necessário. Tente outro aparelho ou use texto.',
        SecurityError: 'O navegador não permite usar o microfone neste endereço. Abra o Tato pelo endereço seguro (https) e tente novamente.',
      };
      const translated = e instanceof DOMException ? device[e.name] : undefined;
      const message = translated ?? (e instanceof Error && !(e instanceof DOMException) ? e.message : 'Não consegui preparar o microfone neste aparelho. Tente novamente.');
      fail(message, translated || !(e instanceof Error) ? (e instanceof Error ? `${e.name}: ${e.message}` : String(e)) : undefined);
      if (e instanceof VoicePreflightWarning && mounted.current) setReadWarning(true);
    }
  }, [fail, release, send, setStage]);

  /** Releases a parked microphone now (the person turned the option off). A running conversation is not touched. */
  const releaseMicrophone = useCallback(() => { if (!alive.current) hold.current?.dispose(); }, []);

  useEffect(() => {
    mounted.current = true;
    void microphonePermission(navigator.permissions, state => { if (mounted.current) setMicPermission(state); }).then(state => { if (mounted.current) setMicPermission(state); });
    // Hidden: a running conversation ends; a parked microphone is released if the page stays hidden for a while. Leaving the page releases it at once.
    const hidden = () => { if (document.hidden && alive.current) stop(); hold.current?.hidden(document.hidden); };
    const gone = () => { hold.current?.dispose(); void resource.current?.dispose(inference.current).catch(() => {}); };
    // After two paints, then browser idle time. No mic acquisition or paid work.
    let cancelled = false;
    let idle: number | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const warm = () => {
      if (cancelled || document.hidden || alive.current) return;
      void detectorResource().warm().then(() => {
        if (!alive.current && !cancelled) resource.current?.park(inference.current);
      }).catch(() => { /* Next explicit start can retry and show its normal error. */ });
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(warm, { timeout: 3000 });
      else fallback = setTimeout(warm, 1000);
    }));
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', gone);
    return () => { cancelled = true; cancelAnimationFrame(frame); if (idle != null) window.cancelIdleCallback(idle); clearTimeout(fallback); mounted.current = false; document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', gone); release('drop'); };
  }, [release, stop]);
  return { state, active, preparing, transcript, error, errorDetail, readWarning, notice, firstAudioMs, micPermission, turnOpen, inputLevel, captureInfo, start, stop, interrupt, sendNow, discardTurn, releaseMicrophone };
}

/**
 * Microphone processing by surroundings. Automatic gain amplifies whatever is quiet, distant voices included, so the noisy
 * levels turn it off and keep noise suppression on; the browser applies what the device supports (see `captureSettings`).
 */
export function microphoneConstraints(ambiente: VadOptions['ambiente']): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: ambiente === 'normal', channelCount: 1 };
}
/** What the browser says it applied (null when it does not say, as Safari may); never audio or device identifiers. */
export function captureSettings(stream: Pick<MediaStream, 'getAudioTracks'>, compatibility: boolean): CaptureInfo {
  const settings = stream.getAudioTracks()[0]?.getSettings?.() as Partial<Record<'echoCancellation' | 'noiseSuppression' | 'autoGainControl', boolean>> | undefined;
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
  return { echoCancellation: flag(settings?.echoCancellation), noiseSuppression: flag(settings?.noiseSuppression), autoGainControl: flag(settings?.autoGainControl), compatibility };
}
