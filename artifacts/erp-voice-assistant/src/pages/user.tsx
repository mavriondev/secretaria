import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Menu, Mic, Square, X, Download, GraduationCap } from 'lucide-react';
import {
  useAskAssistant, useGetAssistantSettings, useListExportDocuments, useCreateExportDocument,
  getListExportDocumentsQueryKey, type AssistantResponse,
} from '@workspace/api-client-react';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { toast } from '@/hooks/use-toast';
import { fmtDateTime } from '@/lib/format';
import { api, errorMessage, useLogout, useMe } from '@/lib/auth-client';

const levels = [{ v: 0, l: 'ESTRITO' }, { v: 1, l: 'EQUILIBRADO' }, { v: 2, l: 'FLEXÍVEL' }] as const;
const DOMAIN_LABEL: Record<string, string> = { sistema: 'Sistema (ERP)', externo: 'Externo (web)', misto: 'Sistema + externo', conversa: 'Conversa', treinamento: 'Treinamento' };

export default function User() {
  const me = useMe().data;
  const logout = useLogout();
  const qc = useQueryClient();
  const settings = useGetAssistantSettings();
  const docs = useListExportDocuments();
  const createDoc = useCreateExportDocument();
  const ask = useAskAssistant();
  const [level, setLevel] = useState<0 | 1 | 2>(1);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [answer, setAnswer] = useState<{ id: number; q: string; a: string; sources: AssistantResponse['sources']; domain?: string } | null>(null);
  // Training is an explicit milestone: the button sets it here and the next turn carries it; the server answer is the source of truth afterwards.
  const [training, setTraining] = useState(false);
  const [trainingOverride, setTrainingOverride] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  const [contextId, setContextId] = useState<number | null>(null);
  const lastQ = useRef('');

  const onAnswer = (r: AssistantResponse) => {
    setAnswer({ id: r.id, q: r.transcript ?? r.question, a: r.answer, sources: r.sources, domain: r.domain });
    setContextId(r.id);
    if (typeof r.training === 'boolean') setTraining(r.training);
    setTrainingOverride(null);
    if (r.metricResult) setLastId(r.id);
    if (r.document) {
      toast({ title: 'Documento CSV criado', description: r.document.title });
      qc.invalidateQueries({ queryKey: getListExportDocumentsQueryKey() });
    }
  };
  const live = useLiveVoice({ level, onAnswer, training: trainingOverride });
  const toggleTraining = () => { const next = !training; setTraining(next); setTrainingOverride(next); setErr(null); };
  const send = (q: string) => {
    setErr(null); lastQ.current = q;
    ask.mutate(
      { data: { question: q, freedomLevel: level, includeVoice: false, ...(contextId ? { referenceLogId: contextId } : {}), ...(trainingOverride == null ? {} : { training: trainingOverride }) } },
      { onSuccess: onAnswer, onError: (e) => setErr(e instanceof Error ? e.message : 'Não foi possível consultar.') },
    );
  };
  const submit = () => { const q = text.trim(); if (!q || ask.isPending || live.active) return; setText(''); send(q); };
  const name = settings.data?.preferredName;
  const statusLabel: Record<string, string> = { idle: 'Toque para falar', connecting: 'Conectando…', listening: 'Ouvindo', processing: 'Consultando…', speaking: 'Respondendo', error: 'Falha na conversa' };
  const makeCsv = () => {
    if (!lastId) return;
    createDoc.mutate({ data: { queryLogId: lastId } }, {
      onSuccess: (d) => { toast({ title: 'Documento CSV criado', description: d.title }); qc.invalidateQueries({ queryKey: getListExportDocumentsQueryKey() }); },
    });
  };

  return (
    <div className="min-h-[100dvh] max-w-xl mx-auto px-5 py-4 flex flex-col">
      <header className="flex items-center justify-between">
        <button onClick={() => setMenu(true)} aria-label="Abrir documentos" data-testid="button-menu" className="h-11 w-11 -ml-2 flex items-center justify-center"><Menu className="h-6 w-6" /></button>
        <span className="flex items-center gap-4 text-xs text-muted-foreground">
          {me?.papel === 'administrador' && <Link href="/" className="underline">Início</Link>}
          <button type="button" onClick={() => logout.mutate()} className="underline" data-testid="button-sair">Sair</button>
        </span>
      </header>

      <main className="flex-1 flex flex-col justify-center py-8 gap-6">
        <h1 className="display text-3xl">{training ? 'Modo treinamento.' : name ? `Olá, ${name}.` : 'Olá.'} {training ? 'Me ensine.' : 'Pergunte.'}</h1>
        {training && (
          <p className="text-sm border-l-2 border-primary pl-3 text-muted-foreground" role="status" data-testid="notice-training">
            Tudo o que você disser agora fica guardado como ensinamento (perfil, empresa, interesses ou ERP). Consultas e pesquisas ficam suspensas. Diga “terminei” ou toque em Encerrar treinamento para voltar.
          </p>
        )}
        <div role="status" aria-live="polite" className="min-h-28 space-y-2" data-testid="panel-answer">
          {live.transcript && live.active && <p className="text-muted-foreground">“{live.transcript}”</p>}
          {answer && (<><p className="text-sm text-muted-foreground">“{answer.q}”</p><p className="text-xl whitespace-pre-wrap">{answer.a}</p>
            <FlagAnswer key={answer.id} logId={answer.id} />
            {answer.domain && <p className="text-[11px] uppercase tracking-wide text-muted-foreground" data-testid="label-domain">{DOMAIN_LABEL[answer.domain] ?? answer.domain}</p>}</>)}
          {!!answer?.sources?.length && <ul className="text-xs text-muted-foreground space-y-2" aria-label="Fontes da resposta">{answer.sources.map(source => (
            <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.title}</a>{source.referenceDate ? ` · Referência: ${source.referenceDate}` : ''}</li>
          ))}</ul>}
          {live.notice && <p className="text-sm text-muted-foreground">{live.notice}</p>}
          {(live.error || err) && (
            <p className="text-sm text-destructive" role="alert">{live.error ?? err}{err && <button className="underline ml-2" onClick={() => send(lastQ.current)}>Tentar novamente</button>}</p>
          )}
          {ask.isPending && <div className="skel h-12" />}
        </div>
      </main>

      <footer className="space-y-4 pb-2">
        <div className="flex items-center gap-4">
          <button onClick={() => (live.active ? live.stop() : void live.start())} aria-label={live.active ? 'Encerrar conversa' : 'Iniciar conversa por voz'} data-testid="button-record"
            className={`h-16 w-16 rounded-full flex items-center justify-center ${live.active ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}>
            {live.active ? <Square className="h-6 w-6" /> : <Mic className="h-7 w-7" />}
          </button>
          <span className="text-sm" data-testid="status-live">{statusLabel[live.state] ?? live.state}</span>
          {live.state === 'speaking' && <button onClick={live.interrupt} className="text-sm underline ml-auto">Interromper</button>}
        </div>
        <button type="button" onClick={toggleTraining} aria-pressed={training} data-testid="button-training"
          className={`w-full h-11 rounded border text-sm inline-flex items-center justify-center gap-2 ${training ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
          <GraduationCap className="h-4 w-4" />{training ? 'Encerrar treinamento' : 'Modo treinamento'}
        </button>
        <div role="radiogroup" aria-label="Modo" className="grid grid-cols-3 border border-border rounded overflow-hidden text-xs">
          {levels.map((o) => (
            <button key={o.v} role="radio" aria-checked={level === o.v} onClick={() => setLevel(o.v)} data-testid={`button-freedom-${o.v}`}
              className={`h-11 ${level === o.v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{o.l}</button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={live.active} aria-label="Pergunta por texto" placeholder="Ou digite aqui"
            className="flex-1 h-11 px-3 rounded border border-input bg-card" data-testid="input-question" />
          <button disabled={!text.trim() || ask.isPending || live.active} className="h-11 px-4 rounded border border-border disabled:opacity-50" data-testid="button-send">Enviar</button>
        </form>
        <p className="text-[11px] text-muted-foreground">Demonstração · Voz gerada por IA · Sem gravações.</p>
      </footer>

      {menu && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Documentos">
          <aside className="w-80 max-w-[85vw] bg-background border-r border-border p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="display text-xl">Documentos</h2>
              <button onClick={() => setMenu(false)} aria-label="Fechar" className="h-11 w-11 flex items-center justify-center"><X className="h-5 w-5" /></button>
            </div>
            <button onClick={makeCsv} disabled={!lastId || createDoc.isPending} data-testid="button-create-csv"
              className="w-full h-11 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50">{createDoc.isPending ? 'Criando…' : 'Criar CSV da última consulta'}</button>
            {!lastId && <p className="text-xs text-muted-foreground mt-2">Faça uma consulta de métrica primeiro.</p>}
            {createDoc.isError && <p className="text-xs text-destructive mt-2" role="alert">Não foi possível criar o CSV. <button className="underline" onClick={makeCsv}>Tentar novamente</button></p>}
            <ul className="mt-5 space-y-3">
              {docs.isLoading && [0, 1].map((i) => <li key={i} className="skel h-12" />)}
              {docs.isError && <li className="text-sm text-destructive">Falha ao carregar. <button className="underline" onClick={() => docs.refetch()}>Tentar novamente</button></li>}
              {docs.data?.length === 0 && <li className="text-sm text-muted-foreground">Nenhum documento ainda.</li>}
              {docs.data?.map((d) => (
                <li key={d.id} className="border-b border-border pb-2">
                  <p className="text-sm">{d.title}</p>
                  <p className="text-xs text-muted-foreground num">{fmtDateTime(d.createdAt)} · CSV</p>
                  <a href={d.downloadUrl} download className="text-sm underline inline-flex items-center gap-1 mt-1"><Download className="h-3 w-3" />Baixar</a>
                </li>
              ))}
            </ul>
          </aside>
          <button className="flex-1 bg-foreground/30" aria-label="Fechar menu" onClick={() => setMenu(false)} />
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
