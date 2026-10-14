import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Star } from 'lucide-react';
import {
  getExecutarFavoritoQueryKey, getListFavoritosQueryKey, useCongelarFavorito, useCopiarFavorito, useDeleteFavorito, useExecutarFavorito, useRefazerFavorito, useReorderFavoritos,
  useUpdateFavorito, useUpdateFavoritosConfiguracao, type Favorito, type FavoritoForma, type FavoritoRascunho,
} from '@workspace/api-client-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CartaoFavorito } from '@/components/favoritos/cartao-favorito';
import { CartaoTabela } from '@/components/graficos/CartaoTabela';
import { FixarDialog } from '@/components/favoritos/fixar-dialog';
import { GestorNav } from '@/components/favoritos/gestor-nav';
import { PageBar } from '@/components/page-bar';
import { useFecharComVoltar, useTituloDaPagina } from '@/lib/navegacao';
import { FORMA_LABEL, fmtDados } from '@/lib/cartao-format';
import { apiMessage, useFavoritos, useMarcadorDados } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';
import { AvisoDialog } from '@/components/avisos/aviso-dialog';
import { Sino } from '@/components/avisos/sino';

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
  const copiar = useCopiarFavorito();
  const refazer = useRefazerFavorito();
  const config = useUpdateFavoritosConfiguracao();
  const [dragging, setDragging] = useState<number | null>(null);
  const [rename, setRename] = useState<Favorito | null>(null);
  const [redo, setRedo] = useState<{ favorito: Favorito; rascunho: FavoritoRascunho } | null>(null);
  const [redoing, setRedoing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Favorito | null>(null);
  useFecharComVoltar(!!confirmDelete, () => setConfirmDelete(null));
  const [avisoDe, setAvisoDe] = useState<number | null>(null);
  const [, navigate] = useLocation();
  // Arriving from a notice (?cartao=id): scroll to that card and highlight it once.
  const destaque = useMemo(() => { const v = new URLSearchParams(window.location.search).get('cartao'); return v ? Number(v) : null; }, []);
  useEffect(() => {
    if (!destaque || !lista.itens.length) return;
    const el = document.querySelector(`[data-testid="favorito-cartao-${destaque}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' }); el.classList.add('ring-2', 'ring-primary');
    const t = setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 4000);
    return () => clearTimeout(t);
  }, [destaque, lista.itens.length]);
  // "Meus": the person's own cards (personal, plus the ones they shared), in their order. "Da empresa": shared by others.
  const meus = useMemo(() => lista.itens.filter(f => f.meu), [lista.itens]);
  const daEmpresa = useMemo(() => lista.itens.filter(f => !f.meu), [lista.itens]);
  const ids = meus.map(f => f.id);
  const agrupar = (items: Favorito[]) => {
    const map = new Map<string, Favorito[]>();
    for (const f of items) { const k = f.secao?.trim() || ''; map.set(k, [...(map.get(k) ?? []), f]); }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  };
  const compartilhados = lista.itens.filter(f => f.escopo === 'empresa').length;

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
        <PageBar inicio="/usuario" acoes={<Sino className="h-9 w-9 mr-1" />} className="py-2" />
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="display text-3xl leading-tight">Favoritos</h1>
            <p className="text-sm text-muted-foreground">{meus.filter(f => f.escopo === 'pessoal').length} de {lista.cota}{compartilhados ? <span data-testid="favoritos-contagem-empresa"> · {compartilhados} da empresa</span> : null} · os cartões acompanhados atualizam sozinhos quando chegam dados novos.{marcador?.marcador ? <span className="num" data-testid="favoritos-dados-de"> Dados de {fmtDados(marcador.marcador)}.</span> : null}</p>
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

        {[{ chave: 'meus', titulo: 'Meus', items: meus }, { chave: 'empresa', titulo: 'Da empresa', items: daEmpresa }].filter(g => g.items.length).map(grupo => (
          <section key={grupo.chave} className="mb-8" data-testid={'favorito-grupo-' + grupo.chave}>
            {(daEmpresa.length > 0 || grupo.chave === 'empresa') && (
              <div className="mb-3">
                <h2 className="display text-lg">{grupo.titulo}</h2>
                {grupo.chave === 'empresa' && <p className="text-xs text-muted-foreground">Compartilhados por administradores; cada pessoa vê com as próprias permissões.</p>}
              </div>
            )}
            {agrupar(grupo.items).map(([section, items]) => (
          <div key={section || '_'} className="mb-5">
            {section && <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{section}</h3>}
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="favorito-grade">
              {items.map(f => {
                const index = ids.indexOf(f.id);
                const podeOrdenar = f.meu;
                return (
                  <li key={f.id} className={'min-w-0 ' + (dragging === f.id ? 'opacity-50' : '')} draggable={podeOrdenar} onDragStart={() => podeOrdenar && setDragging(f.id)} onDragEnd={() => setDragging(null)}
                    onDragOver={e => { if (podeOrdenar) e.preventDefault(); }} onDrop={e => { if (!podeOrdenar) return; e.preventDefault(); if (dragging !== null && dragging !== f.id) move(dragging, index); setDragging(null); }}>
                    <CartaoFavorito favorito={f} onRefazer={f.editavel ? onRefazer : undefined}
                      dragHandle={podeOrdenar ? <span className="cursor-grab text-muted-foreground mt-0.5 hidden sm:inline" aria-hidden><GripVertical className="h-4 w-4" /></span> : undefined}
                      menu={
                        <div className="flex items-center gap-0.5 -mr-2 -mt-1">
                          {podeOrdenar && <button type="button" onClick={() => move(f.id, index - 1)} disabled={index === 0} aria-label="Mover para antes" className="h-8 w-8 flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground" data-testid={'favorito-subir-' + f.id}><ArrowUp className="h-4 w-4" /></button>}
                          {podeOrdenar && <button type="button" onClick={() => move(f.id, index + 1)} disabled={index === ids.length - 1} aria-label="Mover para depois" className="h-8 w-8 flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground" data-testid={'favorito-descer-' + f.id}><ArrowDown className="h-4 w-4" /></button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><button type="button" aria-label="Opções do favorito" className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground" data-testid={'favorito-menu-' + f.id}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              {f.editavel && <DropdownMenuItem onSelect={() => setRename(f)}>Renomear / seção</DropdownMenuItem>}
                              {f.meu && <DropdownMenuItem onSelect={() => patch(f, { naTelaInicial: !f.naTelaInicial })}>{f.naTelaInicial ? 'Tirar da minha tela inicial' : 'Mostrar na minha tela inicial'}</DropdownMenuItem>}
                              {f.editavel && <FormaSub favorito={f} onChange={forma => patch(f, { forma })} />}
                              {lista.podeCompartilhar && f.editavel && (
                                <DropdownMenuItem data-testid={'favorito-escopo-' + f.id} onSelect={() => patch(f, { escopo: f.escopo === 'empresa' ? 'pessoal' : 'empresa' }, f.escopo === 'empresa' ? 'O favorito voltou a ser pessoal.' : 'Favorito compartilhado com a empresa.')}>
                                  {f.escopo === 'empresa' ? 'Voltar a pessoal (despublicar)' : 'Compartilhar com a empresa'}
                                </DropdownMenuItem>
                              )}
                              {lista.podeCompartilhar && f.editavel && f.escopo === 'empresa' && (
                                <DropdownMenuItem data-testid={'favorito-inicial-todos-' + f.id} onSelect={() => patch(f, { naTelaInicialTodos: !f.naTelaInicialTodos })}>{f.naTelaInicialTodos ? 'Tirar da tela inicial de todos' : 'Fixar na tela inicial de todos'}</DropdownMenuItem>
                              )}
                              {!f.meu && <DropdownMenuItem data-testid={'favorito-copiar-' + f.id} onSelect={() => copiar.mutate({ id: f.id }, { onSuccess: () => { invalidate(); toast({ title: 'Copiado para os seus favoritos.' }); }, onError: fail })}>Copiar para os meus</DropdownMenuItem>}
                              {f.tipo === 'vivo' && <DropdownMenuItem data-testid={'favorito-avisar-' + f.id} onSelect={() => setAvisoDe(f.id)}>Avisar quando…</DropdownMenuItem>}
                              {f.tipo === 'vivo' && <DropdownMenuItem onSelect={() => congelar.mutate({ id: f.id }, { onSuccess: () => { invalidate(); toast({ title: 'Cópia fixa criada com o valor de agora.' }); }, onError: fail })}>Guardar valor de agora (fixo)</DropdownMenuItem>}
                              {f.tipo === 'vivo' && f.editavel && <DropdownMenuItem onSelect={() => onRefazer(f)} disabled={redoing === f.id}>{redoing === f.id ? 'Refazendo…' : 'Refazer consulta'}</DropdownMenuItem>}
                              {f.forma === 'tabela' && <DropdownMenuItem onSelect={() => navigate(`/favoritos/${f.id}`)}>Ver tudo</DropdownMenuItem>}
                              {f.editavel && <DropdownMenuSeparator />}
                              {f.editavel && <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(f)}>Excluir</DropdownMenuItem>}
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
          </div>
            ))}
          </section>
        ))}
      </div>

      {rename && <RenameDialog favorito={rename} onClose={() => setRename(null)} onSave={(titulo, secao) => { patch(rename, { titulo, secao }, 'Favorito atualizado.'); setRename(null); }} />}
      {redo && <FixarDialog substituir={redo} onClose={() => setRedo(null)} />}
      {avisoDe !== null && <AvisoDialog favoritoId={avisoDe} onClose={() => setAvisoDe(null)} />}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="alertdialog" aria-modal="true" aria-labelledby="excluir-titulo">
          <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={() => setConfirmDelete(null)} />
          <div className="relative w-full max-w-sm bg-background border border-border rounded-2xl p-5 space-y-4">
            <h2 id="excluir-titulo" className="display text-lg">Excluir “{confirmDelete.titulo}”?</h2>
            <p className="text-sm text-muted-foreground">{confirmDelete.escopo === 'empresa' ? 'Ele some para todos da empresa. ' : ''}{confirmDelete.tipo === 'fixo' ? 'O valor guardado será perdido.' : 'O cartão deixa de ser acompanhado.'}</p>
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
  useFecharComVoltar(true, onClose);
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
  useTituloDaPagina(favorito?.titulo);
  const dados = run.data?.estado === 'ok' ? run.data.resultado?.dados : undefined;
  const table = dados && run.data?.resultado ? { ...dados, form: 'tabela' as const, columns: run.data.resultado.columns, rows: run.data.resultado.rows, total: run.data.resultado.rows.length, truncated: run.data.resultado.truncated } : null;
  return (
    <div className="min-h-[100dvh] md:pl-20 pb-20 md:pb-8">
      <GestorNav />
      <div className="max-w-5xl mx-auto px-5">
        <PageBar inicio="/usuario" className="py-2" />
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
