import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, Smartphone, Tablet } from 'lucide-react';
import { api, errorMessage, ME_KEY, type Sessao } from '@/lib/auth-client';

const KEY = ['auth', 'sessoes'] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const Icon = ({ label }: { label: string }) => /iPhone|Android/.test(label) ? <Smartphone className="h-4 w-4" /> : /iPad/.test(label) ? <Tablet className="h-4 w-4" /> : <Laptop className="h-4 w-4" />;

/** "Meus aparelhos": the person's own active sessions, with this one marked. Ending the current one or all of them signs out here too. */
export function DevicesPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<{ sessoes: Sessao[] }>('GET', '/auth/sessoes') });
  const signedOut = () => { qc.removeQueries({ predicate: s => s.queryKey[0] !== ME_KEY[0] }); qc.setQueryData(ME_KEY, null); };
  const endOne = useMutation({
    mutationFn: (s: Sessao) => api<void>('DELETE', `/auth/sessoes/${s.id}`),
    onSuccess: (_, s) => { if (s.atual) signedOut(); else qc.invalidateQueries({ queryKey: KEY }); },
  });
  const endAll = useMutation({ mutationFn: () => api<void>('POST', '/auth/sessoes/encerrar-todas'), onSuccess: signedOut });
  const problem = [endOne, endAll].find(m => m.isError)?.error;
  return (
    <section aria-labelledby="aparelhos" className={compact ? 'space-y-2' : 'space-y-3'} data-testid="devices-panel">
      <h2 id="aparelhos" className={compact ? 'text-xs uppercase tracking-wider text-muted-foreground' : 'display text-xl'}>Meus aparelhos</h2>
      {!compact && <p className="text-sm text-muted-foreground">Onde a sua conta está conectada agora. Encerre o que você não reconhece.</p>}
      {q.isLoading && <div className="skel h-16" />}
      {q.isError && <p className="text-sm text-destructive">Não foi possível carregar. <button type="button" className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>}
      <ul className="divide-y divide-border border border-border rounded-lg">
        {q.data?.sessoes.map(s => (
          <li key={s.id} className="p-3 flex items-center gap-3" data-testid={`sessao-${s.id}`}>
            <span className="text-muted-foreground"><Icon label={s.aparelho} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{s.aparelho}{s.atual && <span className="ml-2 text-[11px] uppercase tracking-wider text-primary">este aparelho</span>}</span>
              <span className="block text-xs text-muted-foreground num">Último uso {fmt(s.ultimoUso)}{s.persistente ? '' : ' · só nesta sessão do navegador'}</span>
            </span>
            <button type="button" disabled={endOne.isPending} onClick={() => endOne.mutate(s)} className="h-8 px-3 rounded border border-border text-xs hover:bg-muted disabled:opacity-50" data-testid={`button-sair-aparelho-${s.id}`}>
              {s.atual ? 'Sair deste aparelho' : 'Sair'}
            </button>
          </li>
        ))}
      </ul>
      {(q.data?.sessoes.length ?? 0) > 1 && (
        <button type="button" disabled={endAll.isPending} onClick={() => endAll.mutate()} className="inline-flex items-center gap-2 h-9 px-3 rounded border border-destructive/60 text-destructive text-sm hover:bg-destructive/10 disabled:opacity-50" data-testid="button-sair-todos">
          <LogOut className="h-4 w-4" />Sair de todos os aparelhos
        </button>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{errorMessage(problem)}</p>}
    </section>
  );
}
