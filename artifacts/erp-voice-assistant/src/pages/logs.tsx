import { RotateCw } from 'lucide-react';
import { useListQueryLogs, getListQueryLogsQueryKey } from '@workspace/api-client-react';
import { MetricPanel } from '@/components/metric-panel';
import { brl, fmtDateTime } from '@/lib/format';

const P = { limit: 50 };

type TurnMetrics = {
  chamadas: number;
  etapas: { roteamento: number; consultas: number; composicao: number; validacao: number; voz?: number };
  composicao: 'nao-necessaria' | 'executada' | 'rejeitada' | 'falhou';
  candidatos: number;
  fallback: boolean;
  fallbackMotivo?: string;
  apresentacao: string;
  apresentacaoOrigem: string;
  dominio?: string;
  conhecimento?: number[];
};
const DOMAIN_LABEL: Record<string, string> = { sistema: 'sistema (ERP)', externo: 'externo (web)', misto: 'misto (ERP + web)', conversa: 'conversa', treinamento: 'treinamento' };
const ORIGIN_LABEL: Record<string, string> = { roteador: "pedido no turno", padrao: "pedido no turno, detectado no texto", conversa: "padrão da conversa", "sugestao-pendente": "sugestão aceita", continuacao: "continuação da consulta anterior" };
/** Only turns measured by the current pipeline carry _metrics; older rows show nothing instead of estimates. */
function metricsOf(parameters: unknown): TurnMetrics | null {
  const m = (parameters as { _metrics?: Partial<TurnMetrics> } | null)?._metrics;
  return m && typeof m.chamadas === 'number' && m.etapas ? (m as TurnMetrics) : null;
}
const COMPOSITION_LABEL: Record<TurnMetrics['composicao'], string> = {
  'nao-necessaria': 'composição não necessária', executada: 'composição executada', rejeitada: 'composição rejeitada pelo validador', falhou: 'composição falhou',
};

export default function Logs() {
  const q = useListQueryLogs(P, { query: { queryKey: getListQueryLogsQueryKey(P) } });
  const measured = (q.data ?? []).map((l) => metricsOf(l.parameters)).filter((m): m is TurnMetrics => m != null);
  const composed = measured.filter((m) => m.composicao !== 'nao-necessaria');
  const fallbacks = measured.filter((m) => m.fallback).length;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Auditoria</h1>
          <p className="text-sm text-muted-foreground mt-1">As 50 consultas mais recentes, com função, parâmetros e resultado.</p>
        </div>
        <button onClick={() => q.refetch()} data-testid="button-refresh" className="h-9 px-3 rounded border border-border text-sm flex items-center gap-2 hover:bg-muted">
          <RotateCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />Atualizar
        </button>
      </header>
      {q.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}</div>}
      {q.isError && (
        <div className="border border-destructive/40 bg-destructive/5 rounded p-3 text-sm flex justify-between" role="alert" data-testid="status-error">
          Falha ao carregar os logs.
          <button className="underline" onClick={() => q.refetch()} data-testid="button-retry">Tentar novamente</button>
        </div>
      )}
      {measured.length > 0 && (
        <div className="border border-border rounded-md bg-card p-3 text-xs num text-muted-foreground flex flex-wrap gap-x-4 gap-y-1" data-testid="summary-metrics">
          <span>{measured.length} turnos medidos</span>
          <span>{(measured.reduce((a, m) => a + m.chamadas, 0) / measured.length).toFixed(2)} chamadas ao modelo por turno (média)</span>
          <span>{composed.length} com composição</span>
          <span>taxa de fallback: {composed.length ? `${((fallbacks / composed.length) * 100).toFixed(0)}% (${fallbacks}/${composed.length})` : 'sem composições'}</span>
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="border border-dashed border-border rounded-md p-8 text-center">
          <p className="display text-xl">Sem registros</p>
          <p className="text-sm text-muted-foreground mt-1">As perguntas feitas na conversa aparecem aqui.</p>
        </div>
      )}
      <ol className="space-y-3">
        {q.data?.map((l) => (
          <li key={l.id} className="border border-border rounded-md bg-card p-4 space-y-3 rise" data-testid={`row-log-${l.id}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium">{l.question}</p>
              <span className="text-xs num text-muted-foreground">#{l.id} · {fmtDateTime(l.createdAt)}</span>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{l.answer}</p>
            <p className="text-[11px] num text-muted-foreground">
              {l.functionName ?? 'sem função'} · nível {l.freedomLevel} · {l.latencyMs} ms
              {l.inputTokens != null && ` · ${l.inputTokens}/${l.outputTokens ?? 0} tokens`}
              {l.estimatedCostUsd != null && ` · custo estimado (apenas tokens de texto, sem áudio): US$ ${l.estimatedCostUsd.toFixed(4)}`}
              {l.result && ` · ${brl(l.result.value)}`}
            </p>
            {(() => {
              const m = metricsOf(l.parameters);
              if (!m) return null;
              return (
                <p className="text-[11px] num text-muted-foreground" data-testid={`metrics-log-${l.id}`}>
                  {m.chamadas} {m.chamadas === 1 ? 'chamada' : 'chamadas'} ao modelo · roteamento {m.etapas.roteamento} ms · consultas {m.etapas.consultas} ms · composição {m.etapas.composicao} ms · validação {m.etapas.validacao} ms
                  {m.etapas.voz != null && ` · voz ${m.etapas.voz} ms`}
                  {` · ${COMPOSITION_LABEL[m.composicao] ?? m.composicao}`}
                  {` · ${m.candidatos} ${m.candidatos === 1 ? 'candidato' : 'candidatos'}`}
                  {` · registro ${m.apresentacao} (${m.apresentacao === "normal" && m.apresentacaoOrigem === "roteador" ? "padrão do sistema" : ORIGIN_LABEL[m.apresentacaoOrigem] ?? m.apresentacaoOrigem})`}
                  {m.dominio && ` · domínio ${DOMAIN_LABEL[m.dominio] ?? m.dominio}`}
                  {!!m.conhecimento?.length && ` · conhecimento usado: ${m.conhecimento.map(id => `#${id}`).join(', ')}`}
                  {m.fallback && <span className="text-destructive"> · fallback determinístico{m.fallbackMotivo ? `: ${m.fallbackMotivo}` : ''}</span>}
                </p>
              );
            })()}
            {l.result ? (
              <MetricPanel id={`log-${l.id}`} functionName={l.functionName} parameters={l.parameters} result={l.result} />
            ) : (
              <p className="text-xs border-l-2 border-accent pl-2 text-muted-foreground">Pergunta sem resultado numérico; nenhum dado foi gerado.</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
