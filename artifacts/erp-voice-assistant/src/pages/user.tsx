import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowUp, X, GraduationCap, Keyboard, Star } from 'lucide-react';
import {
  useAskAssistant, useGetAssistantSettings, type AssistantResponse,
  useGetVoiceAvailability, getGetVoiceAvailabilityQueryKey,
} from '@workspace/api-client-react';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { microphoneReadyEnabled, setMicrophoneReadyEnabled } from '@/lib/microphone-hold';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { appUrl } from '@/lib/app-path';
import { api, errorMessage, useLogout, useMe } from '@/lib/auth-client';
import { Wordmark } from '@/components/brand-mark';
import { DevicesPanel } from '@/components/devices-panel';
import { InstallHint } from '@/pages/login';
import { VoiceOrb } from '@/components/voice-orb';
import { FixarDialog } from '@/components/favoritos/fixar-dialog';
import { ComoCalculei } from '@/components/como-calculei';
import { FaixaInicial } from '@/components/favoritos/faixa-inicial';
import { GestorNav } from '@/components/favoritos/gestor-nav';
import { useFavoritos } from '@/lib/favoritos';
import { AvisoDialog, type PedidoDeAviso } from '@/components/avisos/aviso-dialog';
import { Sino } from '@/components/avisos/sino';
import { BotaoAtualizar } from '@/components/page-bar';
import { useAlturaVisivel, useFecharComVoltar } from '@/lib/navegacao';
import { EtapaEspera } from '@/components/etapa-espera';

const levels = [
  { v: 0, l: 'ESTRITO', d: 'Responde só o que você perguntou.' },
  { v: 1, l: 'EQUILIBRADO', d: 'Pode acrescentar um comentário quando ajudar.' },
  { v: 2, l: 'FLEXÍVEL', d: 'Comenta e pode sugerir um próximo passo.' },
] as const;
const SUGGESTIONS = ['Quanto vendemos este mês?', 'Quais títulos estão vencidos?', 'Quais os produtos mais vendidos?'];
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const DOMAIN_LABEL: Record<string, string> = { sistema: 'Sistema (ERP)', externo: 'Externo (web)', misto: 'Sistema + externo', conversa: 'Conversa', treinamento: 'Treinamento' };

export default function User() {
  const me = useMe().data;
  const logout = useLogout();
  const settings = useGetAssistantSettings();
  const voiceAvailability = useGetVoiceAvailability({ query: {
    queryKey: getGetVoiceAvailabilityQueryKey(), retry: false, staleTime: 0, refetchOnWindowFocus: false,
  } });
  const ask = useAskAssistant();
  const [level, setLevel] = useState<0 | 1 | 2>(1);
  const [text, setText] = useState('');
  // Typing is on demand: the field only exists while the person asked for it (keyboard button), and folds after sending.
  const [digitar, setDigitar] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);
  const alturaVisivel = useAlturaVisivel(digitar);
  useEffect(() => { if (digitar) campoRef.current?.focus(); }, [digitar]);
  const [menu, setMenu] = useState(false);
  useFecharComVoltar(menu, () => setMenu(false));
  const [answer, setAnswer] = useState<{ id: number; q: string; a: string; sources: AssistantResponse['sources']; domain?: string; fixavel: boolean; explicavel: boolean } | null>(null);
  // Pin dialog: opened by the "Fixar" button or by voice ("fixa esse faturamento"), always for a specific answer.
  const [fixar, setFixar] = useState<number | null>(null);
  // Alert dialog: opened by voice/text ("me avisa quando…"), pre-filled by the server's fixed patterns.
  const [aviso, setAviso] = useState<PedidoDeAviso | null>(null);
  // One-time hint under the first pinnable answer; dismissed for good on this device.
  const [dicaFixar, setDicaFixar] = useState(() => { try { return localStorage.getItem('tato.dica-fixar') !== 'ok'; } catch { return true; } });
  // Microphone kept ready between questions (one permission prompt per screen session); per device, on by default.
  const [micPronto, setMicPronto] = useState(() => microphoneReadyEnabled());
  const dispensarDica = () => { setDicaFixar(false); try { localStorage.setItem('tato.dica-fixar', 'ok'); } catch { /* sem armazenamento */ } };
  const favoritos = useFavoritos();
  // Training is an explicit milestone: the button sets it here and the next turn carries it; the server answer is the source of truth afterwards.
  const [training, setTraining] = useState(false);
  const [trainingOverride, setTrainingOverride] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [contextId, setContextId] = useState<number | null>(null);
  const lastQ = useRef('');

  const onAnswer = (r: AssistantResponse) => {
    const params = (r.parameters ?? {}) as Record<string, unknown>;
    // "Como calculei" exists only for answers that consulted the company's data (shortcut or free query), never for conversation or research alone.
    setAnswer({ id: r.id, q: r.transcript ?? r.question, a: r.answer, sources: r.sources, domain: r.domain, fixavel: params._fixavel === true, explicavel: r.responseKind === 'erp' || r.responseKind === 'mixed' });
    if (typeof params._fixar === 'number') setFixar(params._fixar);
    if (params._aviso && typeof params._aviso === 'object') setAviso(params._aviso as PedidoDeAviso);
    setContextId(r.id);
    if (typeof r.training === 'boolean') setTraining(r.training);
    setTrainingOverride(null);
    // The CSV created by voice/text ("exporta isso") is still announced; the download list lives outside this menu now.
    if (r.document) toast({ title: 'Documento CSV criado', description: r.document.title, action: <ToastAction altText="Baixar o CSV" asChild><a href={appUrl(r.document.downloadUrl)} download>Baixar</a></ToastAction> });
  };
  const live = useLiveVoice({ level, onAnswer, training: trainingOverride });
  const alternarMicPronto = () => { const next = !micPronto; setMicPronto(next); setMicrophoneReadyEnabled(next); if (!next) live.releaseMicrophone(); };
  const toggleTraining = () => { const next = !training; setTraining(next); setTrainingOverride(next); setErr(null); };
  const send = (q: string) => {
    setErr(null); lastQ.current = q;
    ask.mutate(
      { data: { question: q, freedomLevel: level, includeVoice: false, ...(contextId ? { referenceLogId: contextId } : {}), ...(trainingOverride == null ? {} : { training: trainingOverride }) } },
      { onSuccess: onAnswer, onError: (e) => setErr(e instanceof Error ? e.message : 'Não foi possível consultar.') },
    );
  };
  const submit = () => { const q = text.trim(); if (!q || ask.isPending || live.active) return; setText(''); setDigitar(false); send(q); };
  const name = settings.data?.preferredName;

  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (live.error || err) messagesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [live.error, err]);
  const busy = ask.isPending || live.active;
  const initial = (name || me?.nome || '?').trim().charAt(0).toUpperCase();
  const onOrb = () => (live.active ? live.stop() : void live.start());
  // Space starts and ends the conversation when the cursor is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'Space' || e.repeat || menu || t?.closest('input, textarea, button, a, [role="radio"]')) return;
      e.preventDefault(); onOrb();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={'h-[100dvh] max-w-xl mx-auto px-5 flex flex-col ' + (favoritos.lista.itens.length && !digitar ? 'pb-16 md:pb-0 md:ml-24 lg:mx-auto' : favoritos.lista.itens.length ? 'md:ml-24 lg:mx-auto' : '')} style={alturaVisivel ? { height: alturaVisivel } : undefined}>
      {/* While typing on a phone, the bottom bar gives its room to the conversation and the field. */}
      {!digitar && <GestorNav />}
      <header className="flex items-center justify-between py-4">
        <Wordmark className="text-primary" />
        <div className="flex items-center gap-2">
        {favoritos.lista.itens.length > 0 && <Sino />}
        <button onClick={() => setMenu(true)} aria-label="Abrir menu" data-testid="button-menu"
          className="h-10 w-10 rounded-full border border-border bg-card flex items-center justify-center text-sm font-medium text-primary hover:bg-muted">{initial}</button>
        </div>
      </header>

      {/* The conversation scrolls on its own; the footer with the orb never covers a message. */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-center pt-6 pb-4 gap-6">
        {!answer && !live.transcript && !ask.isPending && (
          <div className="space-y-5 rise">
            <h1 className="display text-4xl leading-[1.1]">{training ? <>Modo treinamento.<br />Me ensine.</> : <>{greeting()}{name ? `, ${name}` : ''}.<br /><span className="text-muted-foreground">O que você quer saber?</span></>}</h1>
            {!training && <ul className="flex flex-wrap gap-2" aria-label="Sugestões de perguntas">{SUGGESTIONS.map(q => (
              <li key={q}><button type="button" disabled={busy} onClick={() => send(q)} className="rounded-full border border-border bg-card px-3.5 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-50 transition-colors">{q}</button></li>
            ))}</ul>}
          </div>
        )}
        {training && (
          <p className="text-sm border-l-2 border-accent pl-3 text-muted-foreground" role="status" data-testid="notice-training">
            Tudo o que você disser agora fica guardado como ensinamento (perfil, empresa, interesses ou ERP). Consultas e pesquisas ficam suspensas. Diga “terminei” ou use o menu para encerrar o treinamento.
          </p>
        )}
        <div role="status" aria-live="polite" className="space-y-3" data-testid="panel-answer">
          {live.transcript && live.active && <p className="text-lg text-muted-foreground italic display">“{live.transcript}”</p>}
          {answer && (
            <article className="space-y-4 rise" key={answer.id}>
              <p className="text-sm text-muted-foreground">“{answer.q}”</p>
              <p className="display text-[1.65rem] leading-snug whitespace-pre-wrap">{answer.a}</p>
              {answer.fixavel && (
                <div className="flex flex-wrap items-center gap-3" data-testid="favorito-area">
                  <button type="button" onClick={() => { setFixar(answer.id); dispensarDica(); }} className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20" data-testid="favorito-fixar"><Star className="h-4 w-4" aria-hidden />Fixar</button>
                  {dicaFixar && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="favorito-dica">
                      <span>Fixe respostas para acompanhá-las na aba Favoritos. Quer ver gráfico? Pergunte, por exemplo, “faturamento por dia neste mês” ou “os 5 produtos mais vendidos”.</span>
                      <button type="button" onClick={dispensarDica} className="rounded-full p-1 hover:text-foreground" aria-label="Dispensar dica"><X className="h-3 w-3" aria-hidden /></button>
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                {answer.domain && <span className="text-[11px] uppercase tracking-wider rounded-full bg-muted px-2.5 py-1 text-muted-foreground" data-testid="label-domain">{DOMAIN_LABEL[answer.domain] ?? answer.domain}</span>}
                {answer.explicavel && <ComoCalculei key={'explicacao-' + answer.id} fonte={{ tipo: 'resposta', id: answer.id }} />}
                <FlagAnswer key={answer.id} logId={answer.id} />
              </div>
            </article>
          )}
          {!!answer?.sources?.length && <ul className="text-xs text-muted-foreground space-y-2" aria-label="Fontes da resposta">{answer.sources.map(source => (
            <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.title}</a>{source.referenceDate ? ` · Referência: ${source.referenceDate}` : ''}</li>
          ))}</ul>}
          {(live.notice || live.error || err) && (
            <div ref={messagesRef} className="space-y-3 scroll-mb-6" data-testid="voice-messages">
              {live.notice && <p className="text-sm text-muted-foreground">{live.notice}</p>}
              {(live.error || err) && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 space-y-1" role="alert" data-testid="text-erro-voz">
                  <p className="text-sm text-destructive">{live.error ?? err}{err && <button className="underline ml-2" onClick={() => send(lastQ.current)}>Tentar novamente</button>}</p>
                  {live.error && live.errorDetail && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Detalhe técnico</summary><code className="block mt-1 break-all">{live.errorDetail}</code></details>}
                </div>
              )}
            </div>
          )}
          <EtapaEspera ativa={ask.isPending} />
        </div>
        </div>
      </main>

      {/* Solid footer: messages above it stay fully readable; nothing fades over them. */}
      <footer className="shrink-0 pb-5 pt-3 space-y-5 bg-background">
        {/* Nothing about the voice check in the normal state; one short sentence only when it failed. */}
        {!live.active && (voiceAvailability.isError || voiceAvailability.data?.reachable === false || live.readWarning) && (
          <div className="text-center text-xs space-y-2" role="status" aria-live="polite" data-testid="voice-preflight">
            <p className="text-destructive">{!live.error && 'A voz não está disponível agora. Você pode escrever a pergunta.'}
              <button type="button" disabled={voiceAvailability.isFetching} onClick={() => { void voiceAvailability.refetch(); }} className="underline ml-2 min-h-9 disabled:opacity-50">Tentar de novo</button>
            </p>
            <details className="text-muted-foreground">
              <summary className="cursor-pointer inline-block min-h-9 leading-9">Mais opções</summary>
              <div className="space-y-1 pt-1">
                <button type="button" onClick={() => { void live.start(true); }}
                  className="min-h-11 px-3 rounded border border-input hover:bg-muted" data-testid="button-voice-unconfirmed">
                  Tentar voz mesmo sem confirmação
                </button>
                <p>A tentativa inicia uma conversa real e pode consumir uso de voz.</p>
              </div>
            </details>
          </div>
        )}
        {!live.active && live.micPermission === 'denied' && (
          <p className="text-center text-xs text-destructive" role="status" data-testid="microfone-bloqueado">O microfone está bloqueado neste aparelho. Libere em Ajustes do navegador e volte.</p>
        )}
        {!training && !live.active && !digitar && <FaixaInicial acoes={<BotaoAtualizar />} />}
        <div className="relative">
          <VoiceOrb state={live.state} active={live.active} preparing={live.preparing} onToggle={onOrb} />
          {!live.active && !digitar && (
            <button type="button" onClick={() => setDigitar(true)} aria-label="Digitar" title="Digitar a pergunta" data-testid="button-digitar"
              className="absolute right-0 top-3 h-11 w-11 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary">
              <Keyboard className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        {live.state === 'speaking' && <div className="text-center -mt-2"><button onClick={live.interrupt} className="text-sm underline">Interromper</button></div>}
        {digitar ? (
          // The field takes the place of the footer line while open; the orb stays. Sending or "Fechar" folds it again.
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-center gap-2 -mt-2" data-testid="form-digitar">
            <div className="flex-1 flex items-center gap-1 rounded-full border border-input bg-card pl-4 pr-1.5 h-12 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/40">
              <input ref={campoRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={live.active} aria-label="Pergunta por texto" placeholder="Escreva sua pergunta" enterKeyHint="send"
                className="flex-1 min-w-0 bg-transparent outline-none text-base placeholder:text-muted-foreground" data-testid="input-question" />
              <button disabled={!text.trim() || busy} aria-label="Enviar pergunta" className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30" data-testid="button-send"><ArrowUp className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={() => setDigitar(false)} aria-label="Fechar e voltar a falar" className="h-12 w-12 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground" data-testid="button-fechar-digitar"><X className="h-5 w-5" aria-hidden /></button>
          </form>
        ) : <p className="text-[11px] text-muted-foreground text-center">Voz gerada por IA · O áudio não é gravado{me?.empresaId === 1 ? ' · Dados fictícios de demonstração' : ''}</p>}
      </footer>

      {fixar !== null && <FixarDialog queryLogId={fixar} onClose={() => setFixar(null)} />}
      {aviso && <AvisoDialog pedido={aviso} onClose={() => setAviso(null)} />}
      {menu && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="flex-1 bg-foreground/30" aria-label="Fechar menu" onClick={() => setMenu(false)} />
          <aside className="w-96 max-w-[88vw] bg-background border-l border-border p-5 overflow-y-auto space-y-7">
            <div className="flex items-center justify-between">
              <div><p className="font-medium">{me?.nome}</p><p className="text-xs text-muted-foreground">{me?.empresa}</p></div>
              <button onClick={() => setMenu(false)} aria-label="Fechar" className="h-10 w-10 flex items-center justify-center"><X className="h-5 w-5" /></button>
            </div>

            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Quanta iniciativa ela toma</h2>
              <div role="radiogroup" aria-label="Iniciativa" className="space-y-2">
                {levels.map((o) => (
                  <button key={o.v} role="radio" aria-checked={level === o.v} onClick={() => setLevel(o.v)} data-testid={`button-freedom-${o.v}`}
                    className={`w-full text-left rounded-lg border px-3.5 py-2.5 transition-colors ${level === o.v ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
                    <span className="block text-sm font-medium">{o.l}</span><span className="block text-xs text-muted-foreground">{o.d}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Ensinar a assistente</h2>
              <button type="button" onClick={() => { toggleTraining(); setMenu(false); }} aria-pressed={training} data-testid="button-training"
                className={`w-full h-11 rounded-lg border text-sm inline-flex items-center justify-center gap-2 ${training ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
                <GraduationCap className="h-4 w-4" />{training ? 'Encerrar treinamento' : 'Modo treinamento'}
              </button>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Microfone</h2>
              <button type="button" role="switch" aria-checked={micPronto} onClick={alternarMicPronto} data-testid="switch-microfone-pronto"
                className="w-full text-left rounded-lg border border-border px-3.5 py-2.5 hover:bg-muted flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">Manter o microfone pronto entre perguntas</span>
                  <span className="block text-xs text-muted-foreground">Evita pedir permissão a cada pergunta. O ícone do microfone do celular pode ficar aceso por até 3 minutos depois de falar; nada é gravado nesse tempo.</span>
                </span>
                <span aria-hidden className={`mt-0.5 shrink-0 h-6 w-10 rounded-full p-0.5 transition-colors ${micPronto ? 'bg-primary' : 'bg-muted-foreground/40'}`}><span className={`block h-5 w-5 rounded-full bg-background transition-transform ${micPronto ? 'translate-x-4' : ''}`} /></span>
              </button>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer min-h-9 leading-9">No iPhone, o pedido de permissão volta?</summary>
                <div className="space-y-1.5 pb-1">
                  <p>Para o Safari não perguntar mais neste site: Ajustes do iPhone → Safari → Microfone → “Permitir”. Ou toque em “AA” na barra de endereço, “Ajustes do Site”, e marque Microfone como “Permitir”.</p>
                  <p>No app instalado na tela de início, o iPhone pode perguntar uma vez a cada abertura do app (limitação do sistema). Com a opção acima ligada, isso acontece só uma vez por abertura, não a cada pergunta.</p>
                </div>
              </details>
            </section>

            <DevicesPanel compact />
            <InstallHint className="" />

            <section className="flex items-center gap-5 text-sm pt-2 border-t border-border">
              {me?.papel === 'administrador' && <Link href="/" className="underline">Painel</Link>}
              <Link href="/favoritos" className="underline" data-testid="favorito-link-menu">Favoritos</Link>
              <button type="button" onClick={() => logout.mutate()} className="underline" data-testid="button-sair">Sair</button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/** "Resposta errada": the manager says what was wrong; the administrator reviews it in the panel. */
function FlagAnswer({ logId }: { logId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'sent') return <p className="text-xs text-muted-foreground" role="status">Obrigado. Marquei esta resposta para revisão.</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs underline text-muted-foreground" data-testid="button-resposta-errada">Esta resposta está errada</button>;
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault(); setState('sending'); setError(null);
      try { await api('POST', '/avaliacoes', { logId, motivo: reason }); setState('sent'); }
      catch (err) { setError(errorMessage(err)); setState('idle'); }
    }}>
      <label className="block text-xs text-muted-foreground">O que estava errado? (opcional)
        <textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 rounded border border-input bg-card text-sm" />
      </label>
      <div className="flex gap-2">
        <button disabled={state === 'sending'} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted">{state === 'sending' ? 'Enviando…' : 'Enviar para revisão'}</button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 text-sm underline">Cancelar</button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
