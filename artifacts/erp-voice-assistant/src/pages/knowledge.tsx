import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2, Power, Pencil } from 'lucide-react';
import {
  useListKnowledgeItems, useCreateKnowledgeItem, useUpdateKnowledgeItem, useDeleteKnowledgeItem, useGetErpCatalog,
  getListKnowledgeItemsQueryKey, type KnowledgeItem, type KnowledgeCategory,
} from '@workspace/api-client-react';
import { fmtDateTime } from '@/lib/format';

const TABS: Array<{ value: KnowledgeCategory; label: string; hint: string }> = [
  { value: 'perfil', label: 'Perfil', hint: 'Como falar com o gestor, preferências e instruções pessoais. Exemplos de tom orientam, não viram roteiro.' },
  { value: 'empresa', label: 'Empresa', hint: 'Termos, tags, áreas e vocabulário interno. Esses termos marcam um assunto como interno: nunca vão para a web.' },
  { value: 'interesses', label: 'Interesses e fontes', hint: 'Assuntos externos que o gestor acompanha e sites preferidos. Só nomes e endereços públicos chegam à pesquisa.' },
  { value: 'erp', label: 'ERP', hint: 'Significado de tabelas, colunas, códigos e tipos. Use a referência do catálogo real abaixo.' },
];
const errorText = (e: unknown, fallback: string) => {
  const data = (e as { data?: { error?: string } } | null)?.data;
  return data?.error ?? (e instanceof Error && e.message ? e.message : fallback);
};
type Draft = { title: string; content: string; url: string; erpRef: string };
const empty: Draft = { title: '', content: '', url: '', erpRef: '' };

export default function Knowledge() {
  const qc = useQueryClient();
  const list = useListKnowledgeItems();
  const catalog = useGetErpCatalog();
  const create = useCreateKnowledgeItem();
  const update = useUpdateKnowledgeItem();
  const remove = useDeleteKnowledgeItem();
  const [tab, setTab] = useState<KnowledgeCategory>('perfil');
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const items = useMemo(() => (list.data ?? []).filter(item => item.category === tab), [list.data, tab]);
  const limits = catalog.data?.limits ?? { perCategory: 60, titleMaxLength: 80, contentMaxLength: 400 };
  const refresh = () => qc.invalidateQueries({ queryKey: getListKnowledgeItemsQueryKey() });
  const payload = (active = true) => ({ category: tab, title: draft.title.trim(), content: draft.content.trim(), url: draft.url.trim() || null, erpRef: draft.erpRef.trim() || null, active });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setMessage(null);
    const done = (text: string) => { setMessage({ kind: 'ok', text }); setDraft(empty); setEditing(null); refresh(); };
    const fail = (err: unknown) => setMessage({ kind: 'error', text: errorText(err, 'Não foi possível salvar.') });
    if (editing) update.mutate({ id: editing, data: payload(items.find(i => i.id === editing)?.active ?? true) }, { onSuccess: () => done('Item atualizado.'), onError: fail });
    else create.mutate({ data: payload() }, { onSuccess: () => done('Item salvo. O assistente passa a usá-lo como contexto nas próximas respostas.'), onError: fail });
  };
  const toggle = (item: KnowledgeItem) => update.mutate({ id: item.id, data: { category: item.category, title: item.title, content: item.content, url: item.url, erpRef: item.erpRef, active: !item.active } },
    { onSuccess: refresh, onError: (err) => setMessage({ kind: 'error', text: errorText(err, 'Não foi possível alterar.') }) });
  const del = (item: KnowledgeItem) => { if (!confirm(`Excluir "${item.title}" definitivamente?`)) return; remove.mutate({ id: item.id }, { onSuccess: refresh, onError: (err) => setMessage({ kind: 'error', text: errorText(err, 'Não foi possível excluir.') }) }); };
  const startEdit = (item: KnowledgeItem) => { setEditing(item.id); setDraft({ title: item.title, content: item.content, url: item.url ?? '', erpRef: item.erpRef ?? '' }); setMessage(null); };
  const activeCount = items.filter(i => i.active).length;
  const pending = create.isPending || update.isPending;
  const current = TABS.find(t => t.value === tab)!;

  if (list.isLoading) return <div className="skel h-48" />;
  if (list.isError) return <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="display text-3xl">Conhecimento</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">O que o gestor ensina aqui, ou pelo modo treinamento na tela do usuário, entra nas respostas como contexto rotulado como dado: ajusta tom, vocabulário e domínio, mas nunca fornece números. Valores financeiros são recusados.</p>
      </header>
      <div role="tablist" aria-label="Categorias" className="grid grid-cols-2 sm:grid-cols-4 border border-border rounded overflow-hidden text-xs">
        {TABS.map(t => { const n = (list.data ?? []).filter(i => i.category === t.value && i.active).length; return (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => { setTab(t.value); setDraft(empty); setEditing(null); setMessage(null); }} data-testid={`tab-${t.value}`}
            className={`h-11 ${tab === t.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{t.label} <span className="num opacity-70">({n})</span></button>
        ); })}
      </div>
      <p className="text-xs text-muted-foreground">{current.hint}</p>

      <form onSubmit={submit} className="grid gap-3 max-w-2xl border border-border rounded p-4 bg-card" aria-label={editing ? 'Editar item' : 'Novo item'}>
        <div className="flex items-center justify-between text-sm"><span>{editing ? `Editando item #${editing}` : `Novo item em ${current.label}`}</span>
          <span className="num text-xs text-muted-foreground" data-testid="text-limit">{items.length}/{limits.perCategory} itens · {activeCount} ativos</span></div>
        <label className="text-sm">Título
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} maxLength={limits.titleMaxLength} required data-testid="input-title"
            className="mt-1 w-full h-11 px-3 rounded border border-input bg-background" placeholder={tab === 'empresa' ? 'Ex.: Linha Premium' : tab === 'erp' ? 'Ex.: TIPMOV = V' : tab === 'interesses' ? 'Ex.: Valor Econômico' : 'Ex.: Tom das respostas'} />
        </label>
        <label className="text-sm">Conteúdo <span className="num text-xs text-muted-foreground">({draft.content.length}/{limits.contentMaxLength})</span>
          <textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} maxLength={limits.contentMaxLength} required rows={3} data-testid="input-content"
            className="mt-1 w-full px-3 py-2 rounded border border-input bg-background" placeholder="O que o assistente deve saber, sem valores financeiros." />
        </label>
        {tab === 'interesses' && <label className="text-sm">Fonte (URL pública, opcional)
          <input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} maxLength={300} type="url" data-testid="input-url" className="mt-1 w-full h-11 px-3 rounded border border-input bg-background" placeholder="https://" />
        </label>}
        {tab === 'erp' && <label className="text-sm">Referência do catálogo (TABELA ou TABELA.COLUNA, opcional)
          <input value={draft.erpRef} onChange={e => setDraft({ ...draft, erpRef: e.target.value.toUpperCase() })} maxLength={80} list="erp-refs" data-testid="input-erp-ref" className="mt-1 w-full h-11 px-3 rounded border border-input bg-background num" placeholder="TGFCAB.TIPMOV" />
          <datalist id="erp-refs">{catalog.data?.tables.flatMap(t => [t.name, ...t.columns.map(c => `${t.name}.${c.name}`)]).map(r => <option key={r} value={r} />)}</datalist>
        </label>}
        <div className="flex gap-2">
          <button disabled={pending || (!editing && items.length >= limits.perCategory)} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-save-knowledge">{pending ? 'Salvando…' : editing ? 'Salvar alteração' : 'Adicionar'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setDraft(empty); }} className="h-11 px-4 rounded border border-border">Cancelar</button>}
        </div>
        {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-destructive' : ''}`}>{message.text}</p>}
      </form>

      <ul className="space-y-2 max-w-2xl" aria-label={`Itens de ${current.label}`}>
        {items.length === 0 && <li className="text-sm text-muted-foreground">Nenhum item nesta categoria ainda.</li>}
        {items.map(item => (
          <li key={item.id} className={`border border-border rounded p-3 flex gap-3 ${item.active ? '' : 'opacity-60'}`} data-testid={`knowledge-${item.id}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm"><span className="num text-xs text-muted-foreground mr-2">#{item.id}</span>{item.title}{!item.active && <span className="ml-2 text-xs uppercase text-muted-foreground">inativo</span>}</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.content}</p>
              {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs underline break-all">{item.url}</a>}
              {item.erpRef && <p className="text-xs num text-muted-foreground">ERP: {item.erpRef}</p>}
              <p className="text-[11px] num text-muted-foreground">{item.origin === 'conversa' ? 'Ensinado em treinamento' : 'Cadastrado no painel'} · {fmtDateTime(item.updatedAt)}</p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => startEdit(item)} aria-label={`Editar ${item.title}`} className="h-9 w-9 flex items-center justify-center rounded hover:bg-muted"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => toggle(item)} aria-label={item.active ? `Desativar ${item.title}` : `Reativar ${item.title}`} className="h-9 w-9 flex items-center justify-center rounded hover:bg-muted"><Power className="h-4 w-4" /></button>
              <button onClick={() => del(item)} aria-label={`Excluir ${item.title}`} className="h-9 w-9 flex items-center justify-center rounded hover:bg-muted text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>

      {tab === 'erp' && (
        <section className="max-w-2xl space-y-2">
          <h2 className="display text-xl">Catálogo real do ERP</h2>
          <p className="text-xs text-muted-foreground">Tabelas e colunas existentes no esquema demonstrativo (somente leitura). O papel indica como a consulta governada usa a coluna.</p>
          {catalog.isError && <p className="text-sm text-destructive">Catálogo indisponível.</p>}
          {catalog.data?.tables.map(t => (
            <details key={t.name} className="border border-border rounded p-3">
              <summary className="text-sm cursor-pointer"><span className="num">{t.name}</span> <span className="text-muted-foreground">— {t.role} · {t.columns.length} colunas</span></summary>
              <table className="mt-2 w-full text-xs"><tbody>
                {t.columns.map(c => <tr key={c.name} className="border-t border-border"><td className="num py-1 pr-2">{c.name}</td><td className="text-muted-foreground pr-2">{c.type}</td><td className="text-muted-foreground">{c.role}</td></tr>)}
              </tbody></table>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
