import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, MoreHorizontal, Star } from 'lucide-react';
import {
  getExecutarFavoritoQueryKey, getListFavoritosQueryKey, useCongelarFavorito, useDeleteFavorito, useExecutarFavorito, useRefazerFavorito, useReorderFavoritos,
  useUpdateFavorito, useUpdateFavoritosConfiguracao, type Favorito, type FavoritoForma, type FavoritoRascunho,
} from '@workspace/api-client-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CartaoFavorito } from '@/components/favoritos/cartao-favorito';
import { CartaoTabela } from '@/components/graficos/CartaoTabela';
import { FixarDialog } from '@/components/favoritos/fixar-dialog';
import { GestorNav } from '@/components/favoritos/gestor-nav';
import { Wordmark } from '@/components/brand-mark';
import { FORMA_LABEL, fmtDados } from '@/lib/cartao-format';
import { apiMessage, useFavoritos, useMarcadorDados } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';

/** The manager's favourites: a grid of cards (1 column on phones, 2 on tablets, 3 on desktops) with ordering and per-card actions. */
export default function Favoritos() {
  const { lista, isLoading, isError, refetch } = useFavoritos();
  const marcador = useMarcadorDados(lista.itens.some(f => f.tipo === 'vivo'));
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: getListFavoritosQueryKey() });
  const fail = (e: unknown) => toast({ title: apiMessage(e), variant: 'destructive' });
  const reorder = useReorderFavoritos();
  const update = useUpdateFavorito();
  const remove = useDeleteFavorito();
  const congelar = useCongelarFavorito();
  const refazer = useRefazerFavorito();
  const config = useUpdateFavoritosConfiguracao();
  const [dragging, setDragging] = useState<number | null>(null);
  const [rename, setRename] = useState<Favorito | null>(null);
  const [redo, setRedo] = useState<{ favorito: Favorito; rascunho: FavoritoRascunho } | null>(null);
  const [redoing, setRedoing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Favorito | null>(null);
  const [, navigate] = useLocation();
  const ids = lista.itens.map(f => f.id);
  const sections = useMemo(() => {
    const map = new Map<string, Favorito[]>();
    for (const f of lista.itens) { const k = f.secao?.trim() || ''; map.set(k, [...(map.get(k) ?? []), f]); }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [lista.itens]);

  const move = (id: number, to: number) => {
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    const next = [...ids]; next.splice(from, 1); next.splice(to, 0, id);
    reorder.mutate({ data: { ids: next } }, { onSuccess: invalidate, onError: fail });
  };
  const patch = (f: Favorito, data: Parameters<typeof update.mutate>[0]['data'], msg?: string) =>
    update.mutate({ id: f.id, data }, { onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: getExecutarFavoritoQueryKey(f.id) }); if (msg) toast({ title: msg }); }, onError: fail });
  const onRefazer = (f: Favorito) => {
    setRedoing(f.id);
    refazer.mutate({ id: f.id }, { onSuccess: r => setRedo({ favorito: f, rascunho: r }), onError: fail, onSettled: () => setRedoing(null) });
  };

  return (
    <div className="min-h-[100dvh] md:pl-20 pb-20 md:pb-8">
      <GestorNav />
      <div className="max-w-5xl mx-auto px-5">
        <header className="flex items-center justify-between py-4">
          <Link href="/usuario" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="favorito-voltar"><ArrowLeft className="h-4 w-4" aria-hidden />Assistente</Link>
          <Wordmark className="text-primary" />
        </header>
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="display text-3xl leading-tight">Favoritos</h1>
            <p className="text-sm text-muted-foreground">{lista.itens.length} de {lista.cota} · os cartões acompanhados atualizam sozinhos quando chegam dados novos.{marcador?.marcador ? <span className="num" data-testid="favoritos-dados-de"> Dados de {fmtDados(marcador.marcador)}.</span> : null}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lista.faixaTelaInicial} onChange={e => config.mutate({ data: { faixaTelaInicial: e.target.checked } }, { onSuccess: invalidate, onError: fail })} className="h-4 w-4 accent-primary" data-testid="favorito-config-faixa" />
            Mostrar favoritos na tela inicial
          </label>
        </div>

        {isLoading && <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <li key={i} className="skel h-48" />)}</ul>}
        {isError && <p className="text-sm text-destructive">Não foi possível carregar os favoritos. <button className="underline" onClick={() => refetch()}>Tentar novamente</button></p>}
        {!isLoading && !lista.itens.length && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2" data-testid="favorito-vazio">
            <Star className="h-6 w-6 mx-auto text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Nenhum favorito ainda. Depois de uma resposta com dados, toque em “Fixar” ou diga “fixa esse faturamento”.</p>
          </div>
        )}

        {sections.map(([section, items]) => (
          <section key={section || '_'} className="mb-8">
            {section && <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{section}</h2>}
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="favorito-grade">
              {items.map(f => {
                const index = ids.indexOf(f.id);
                return (
                  <li key={f.id} className={'min-w-0 ' + (dragging === f.id ? 'opacity-50' : '')} draggable onDragStart={() => setDragging(f.id)} onDragEnd={() => setDragging(null)}
                    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragging !== null && dragging !== f.id) move(dragging, index); setDragging(null); }}>
                    <CartaoFavorito favorito={f} onRefazer={onRefazer}
                      dragHandle={<span className="cursor-grab text-muted-foreground mt-0.5 hidden sm:inline" aria-hidden><GripVertical className="h-4 w-4" /></span>}
                      menu={
                        <div className="flex items-center gap-0.5 -mr-2 -mt-1">
                          <button type="button" onClick={() => move(f.id, index - 1)} disabled={index === 0} aria-label="Mover para antes" className="h-8 w-8 flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground" data-testid={'favorito-subir-' + f.id}><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" onClick={() => move(f.id, index + 1)} disabled={index === ids.length - 1} aria-label="Mover para depois" className="h-8 w-8 flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground" data-testid={'favorito-descer-' + f.id}><ArrowDown className="h-4 w-4" /></button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><button type="button" aria-label="Opções do favorito" className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground" data-testid={'favorito-menu-' + f.id}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onSelect={() => setRename(f)}>Renomear / seção</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => patch(f, { naTelaInicial: !f.naTelaInicial })}>{f.naTelaInicial ? 'Tirar da tela inicial' : 'Mostrar na tela inicial'}</DropdownMenuItem>
                              <FormaSub favorito={f} onChange={forma => patch(f, { forma })} />
                              {f.tipo === 'vivo' && <DropdownMenuItem onSelect={() => congelar.mutate({ id: f.id }, { onSuccess: () => { invalidate(); toast({ title: 'Cópia fixa criada com o valor de agora.' }); }, onError: fail })}>Guardar valor de agora (fixo)</DropdownMenuItem>}
                              {f.tipo === 'vivo' && <DropdownMenuItem onSelect={() => onRefazer(f)} disabled={redoing === f.id}>{redoing === f.id ? 'Refazendo…' : 'Refazer consulta'}</DropdownMenuItem>}
                              {f.forma === 'tabela' && <DropdownMenuItem onSelect={() => navigate(`/favoritos/${f.id}`)}>Ver tudo</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(f)}>Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      }>
                      {f.forma === 'tabela' && <Link href={`/favoritos/${f.id}`} className="text-xs underline text-muted-foreground self-start" data-testid={'favorito-ver-tudo-' + f.id}>Ver tudo</Link>}
                    </CartaoFavorito>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {rename && <RenameDialog favorito={rename} onClose={() => setRename(null)} onSave={(titulo, secao) => { patch(rename, { titulo, secao }, 'Favorito atualizado.'); setRename(null); }} />}
      {redo && <FixarDialog substituir={redo} onClose={() => setRedo(null)} />}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="alertdialog" aria-modal="true" aria-labelledby="excluir-titulo">
          <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={() => setConfirmDelete(null)} />
          <div className="relative w-full max-w-sm bg-background border border-border rounded-2xl p-5 space-y-4">
            <h2 id="excluir-titulo" className="display text-lg">Excluir “{confirmDelete.titulo}”?</h2>
            <p className="text-sm text-muted-foreground">{confirmDelete.tipo === 'fixo' ? 'O valor guardado será perdido.' : 'O cartão deixa de ser acompanhado.'}</p>
            <div className="flex gap-2">
              <button onClick={() => remove.mutate({ id: confirmDelete.id }, { onSuccess: () => { invalidate(); setConfirmDelete(null); }, onError: fail })} className="h-10 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm" data-testid="favorito-excluir-confirmar">Excluir</button>
              <button onClick={() => setConfirmDelete(null)} className="h-10 px-4 rounded-lg border border-border text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Forms the result accepts (a fixed card knows them; a live card learns them from its last run). */
function FormaSub({ favorito, onChange }: { favorito: Favorito; onChange: (f: FavoritoForma) => void }) {
  const qc = useQueryClient();
  const run = qc.getQueryData<{ resultado?: { formas?: FavoritoForma[] } }>(getExecutarFavoritoQueryKey(favorito.id));
  const formas = favorito.formas ?? run?.resultado?.formas ?? [favorito.forma];
  if (formas.length < 2) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Forma: {FORMA_LABEL[favorito.forma]}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Formas compatíveis</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={favorito.forma} onValueChange={v => onChange(v as FavoritoForma)}>
          {formas.map(f => <DropdownMenuRadioItem key={f} value={f}>{FORMA_LABEL[f]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function RenameDialog({ favorito, onClose, onSave }: { favorito: Favorito; onClose: () => void; onSave: (titulo: string, secao: string | null) => void }) {
  const [titulo, setTitulo] = useState(favorito.titulo);
  const [secao, setSecao] = useState(favorito.secao ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="renomear-titulo">
      <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={onClose} />
      <form className="relative w-full max-w-sm bg-background border border-border rounded-2xl p-5 space-y-3" onSubmit={e => { e.preventDefault(); onSave(titulo.trim() || favorito.titulo, secao.trim() || null); }}>
        <h2 id="renomear-titulo" className="display text-lg">Renomear</h2>
        <label className="block text-sm">Título<input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={80} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="favorito-renomear-titulo" /></label>
        <label className="block text-sm">Seção (opcional)<input value={secao} onChange={e => setSecao(e.target.value)} maxLength={40} placeholder="Vendas, Financeiro…" className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card" data-testid="favorito-renomear-secao" /></label>
        <div className="flex gap-2 pt-1">
          <button className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm" data-testid="favorito-renomear-salvar">Salvar</button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-border text-sm">Cancelar</button>
        </div>
      </form>
    </div>
  );
}

/** "Ver tudo": the whole table of one favourite on its own scrollable screen. */
export function FavoritoCompleto({ id }: { id: number }) {
  const { lista } = useFavoritos();
  const favorito = lista.itens.find(f => f.id === id);
  const run = useExecutarFavorito(id, { query: { queryKey: getExecutarFavoritoQueryKey(id), retry: false } });
  const [, navigate] = useLocation();
  const dados = run.data?.estado === 'ok' ? run.data.resultado?.dados : undefined;
  const table = dados && run.data?.resultado ? { ...dados, form: 'tabela' as const, columns: run.data.resultado.columns, rows: run.data.resultado.rows, total: run.data.resultado.rows.length, truncated: run.data.resultado.truncated } : null;
  return (
    <div className="min-h-[100dvh] md:pl-20 pb-20 md:pb-8">
      <GestorNav />
      <div className="max-w-5xl mx-auto px-5">
        <header className="flex items-center justify-between py-4">
          <button onClick={() => navigate('/favoritos')} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Favoritos</button>
          <Wordmark className="text-primary" />
        </header>
        <h1 className="display text-2xl mb-1">{favorito?.titulo ?? 'Favorito'}</h1>
        {run.data?.estado === 'ok' && run.data.resultado && <p className="text-xs text-muted-foreground mb-4">{run.data.resultado.rows.length} linhas{run.data.resultado.truncated ? ' (limite de 200 atingido)' : ''}</p>}
        <div className="rounded-xl border border-border bg-card p-4" data-testid="favorito-tabela-completa">
          {run.isLoading ? <div className="skel h-40" /> : run.isError ? <p className="text-sm text-destructive">{apiMessage(run.error)}</p>
          : run.data?.estado === 'refazer' ? <p className="text-sm text-destructive">{run.data.erro}</p>
          : table ? <CartaoTabela dados={table} todas /> : null}
        </div>
      </div>
    </div>
  );
}
