import { useEffect, useState } from 'react';
import { useGetVoiceStatus, getGetVoiceStatusQueryKey, type VoiceStatus } from '@workspace/api-client-react';
import { useMe } from '@/lib/auth-client';
import { fmtDateTime } from '@/lib/format';

const labels: Record<VoiceStatus['status'], [string, string]> = {
  reachable: ['ElevenLabs acessível', 'A consulta de leitura foi autorizada. As permissões de gerar fala e transcrever pelo Scribe ainda não foram confirmadas.'],
  configuration: ['Voz não configurada', 'Configure a chave da ElevenLabs no servidor ou a conexão no Replit.'],
  authorization: ['Acesso não autorizado', 'Verifique se a chave ou conexão da ElevenLabs está válida.'],
  permissions: ['Permissão insuficiente', 'A consulta de leitura foi negada. Revise o escopo da chave e os IPs autorizados. Isso não confirma as permissões de fala ou Scribe.'],
  quota: ['Limite da ElevenLabs atingido', 'O provedor informou um limite de uso ou de requisições. O diagnóstico não consulta nem exibe saldo.'],
  unavailable: ['Falha de conexão com ElevenLabs', 'Não foi possível concluir a consulta. Verifique a rede e a disponibilidade do provedor e tente novamente.'],
};

export function VoiceStatusPanel() {
  const admin = useMe().data?.papel === 'administrador';
  const q = useGetVoiceStatus({ query: { queryKey: getGetVoiceStatusQueryKey(), enabled: admin, retry: false, staleTime: 0, refetchOnWindowFocus: false } });
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const remaining = Date.parse(q.data.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [q.data]);
  if (!admin) return null;
  const label = q.data && labels[q.data.status];
  return (
    <section aria-labelledby="voice-status-title" className="rounded border border-border bg-card p-4 space-y-3" data-testid="voice-status">
      <h2 id="voice-status-title" className="font-medium">Disponibilidade da voz</h2>
      <div role="status" aria-live="polite" className="text-sm space-y-1">
        {q.isFetching ? <p>Verificando ElevenLabs…</p> : q.isError ? (
          <p className="text-destructive">Não foi possível obter o diagnóstico. Tente novamente.</p>
        ) : label ? (
          <>
            <p className={q.data?.status !== 'reachable' ? 'font-medium text-destructive' : 'font-medium'}>
              {expired ? 'Verificação desatualizada' : label[0]}
            </p>
            {expired && <p>Atualize o diagnóstico antes de usar este resultado.</p>}
            <p>{label[1]}</p>
          </>
        ) : <p>Diagnóstico ainda não disponível.</p>}
      </div>
      {q.data && <p className="text-xs text-muted-foreground">Última verificação: {fmtDateTime(q.data.checkedAt)}</p>}
      <button type="button" disabled={q.isFetching} onClick={() => { void q.refetch(); }}
        className="h-11 px-3 rounded border border-input hover:bg-muted disabled:opacity-50" data-testid="button-check-voice">
        {q.isFetching ? 'Verificando…' : 'Verificar novamente'}
      </button>
      <p className="text-xs text-muted-foreground">
        Consulta sem geração de áudio e sem emissão de tokens. O servidor reutiliza o resultado por até 30 segundos.
        Não testa microfone, HTTPS ou treinamento por voz.
      </p>
    </section>
  );
}
