import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';

type Coluna = { nome: string; rotulo: string | null; tipo: string; descricao: string; valores: Record<string, string> | null; nota: string };
type Visao = { nome: string; assunto: string; descricao: string; atualizadoEm: string | null; observacao: string | null; colunas: Coluna[] };
type Dados = { empresa: string; erp: string | null; naoDisponivel: string[]; visoes: Visao[] };
const KEY = ['dados'] as const;

/** What the assistant can read (tables and columns of the company's ficha) and a note beside each column to teach it what the column means here. */
export default function DadosPage() {
  const dados = useQuery({ queryKey: KEY, queryFn: () => api<Dados>('GET', '/dados') });
  const [filter, setFilter] = useState('');
  if (dados.isLoading) return <div className="skel h-40" />;
  if (dados.isError) return <p className="text-sm">{errorMessage(dados.error)} <button className="underline" onClick={() => dados.refetch()}>Tentar novamente</button></p>;
  const q = filter.trim().toLowerCase();
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="display text-3xl">Dados que a IA consulta</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">Estas são as tabelas e colunas que o assistente pode ler. Use o campo de nota para explicar o que cada coluna significa na sua empresa (apelidos, regras, pegadinhas). A IA lê as notas como contexto; números continuam vindo só das consultas, por isso notas com valores em reais ou percentuais são recusadas.</p>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por tabela ou coluna" className="h-11 w-full max-w-sm px-3 rounded border border-input bg-card" aria-label="Filtrar" />
      </div>
      {dados.data!.visoes.map(v => {
        const cols = q && !v.nome.toLowerCase().includes(q) ? v.colunas.filter(c => c.nome.toLowerCase().includes(q) || (c.rotulo ?? '').toLowerCase().includes(q)) : v.colunas;
        if (!cols.length) return null;
        return (
          <section key={v.nome} className="space-y-3" aria-labelledby={`v-${v.nome}`}>
            <div>
              <h2 id={`v-${v.nome}`} className="display text-xl font-mono">{v.nome}</h2>
              <p className="text-sm">{v.assunto} — <span className="text-muted-foreground">{v.descricao}</span></p>
              {v.observacao && <p className="text-xs text-muted-foreground">Regra: {v.observacao}</p>}
              {v.atualizadoEm && <p className="text-xs text-muted-foreground">Atualização registrada na coluna <span className="font-mono">{v.atualizadoEm}</span>.</p>}
            </div>
            <ul className="divide-y divide-border border border-border rounded">
              {cols.map(c => <ColumnRow key={c.nome} view={v.nome} column={c} />)}
            </ul>
          </section>
        );
      })}
      {dados.data!.naoDisponivel.length > 0 && (
        <section className="space-y-1"><h2 className="display text-xl">Assuntos sem dados nesta empresa</h2>
          <p className="text-sm text-muted-foreground">{dados.data!.naoDisponivel.join(' · ')}</p></section>
      )}
    </div>
  );
}

function ColumnRow({ view, column }: { view: string; column: Coluna }) {
  const qc = useQueryClient();
  const [text, setText] = useState(column.nota);
  const save = useMutation({
    mutationFn: () => api<{ nota: string }>('PUT', '/dados/notas', { visao: view, coluna: column.nome, nota: text }),
    onSuccess: r => { setText(r.nota); qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['/api/knowledge'] }); },
  });
  const dirty = text.trim() !== column.nota;
  return (
    <li className="p-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-testid={`coluna-${view}-${column.nome}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-sm font-medium">{column.nome}</span>
          <span className="text-xs text-muted-foreground">{column.tipo}{column.rotulo ? ` · ${column.rotulo}` : ''}</span></div>
        <p className="text-sm text-muted-foreground">{column.descricao}</p>
        {column.valores && <p className="text-xs text-muted-foreground">{Object.entries(column.valores).map(([k, v]) => `${k} = ${v}`).join(' · ')}</p>}
      </div>
      <form className="flex gap-2 items-start" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="sr-only" htmlFor={`n-${view}-${column.nome}`}>Nota sobre {column.nome}</label>
        <textarea id={`n-${view}-${column.nome}`} rows={2} maxLength={400} value={text} onChange={e => setText(e.target.value)} placeholder="Ensine a IA sobre esta coluna"
          className="flex-1 min-w-0 px-3 py-2 rounded border border-input bg-card text-sm" />
        <button disabled={!dirty || save.isPending} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted disabled:opacity-40">{save.isPending ? '…' : 'Salvar'}</button>
        {save.isError && <span role="alert" className="text-xs text-destructive basis-full">{errorMessage(save.error)}</span>}
      </form>
    </li>
  );
}
