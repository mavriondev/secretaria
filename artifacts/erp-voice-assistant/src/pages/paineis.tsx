import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Copy, GripVertical, MonitorPlay, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import {
  getGetPainelQueryKey, getListPaineisQueryKey, getPreviewPainelQueryKey, useCreatePainel, useGetPainel, useListPaineis, useListPainelFavoritos, usePreviewPainel,
  useRegeneratePainelLink, useRevokePainelLink, useSetPainelApelido, useUpdatePainel,
  type PainelEntrada, type PainelGerenciado, type PainelPublico,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { TvPainel } from '@/components/painel/tv-painel';
import { useMe } from '@/lib/auth-client';
import { podeGerirPaineis } from '@/lib/painel-acesso';
import { FORMA_LABEL, fmtCarimbo } from '@/lib/cartao-format';
import { apiMessage } from '@/lib/favoritos';
import { publicAppUrl } from '@/lib/app-path';
import { MAX_CARTOES, MAX_PAINEIS, ordenarAutomatico, reorganizar, type Forma, type Modelo, type Tamanho } from '@/lib/painel-layout';
import { toast } from '@/hooks/use-toast';

const campo = 'h-10 rounded-md border border-border bg-background px-3 text-sm w-full min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const botao = 'h-10 px-4 rounded-md border border-border text-sm inline-flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50 disabled:pointer-events-none';
const botaoPrimario = 'h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none';
const AVISO_LINK = 'Qualquer pessoa com este link vê os números deste painel. Compartilhe só dentro da empresa. Se um link vazar, revogue ou regenere.';
const INTERVALOS = [{ v: 60, l: '1 minuto' }, { v: 300, l: '5 minutos' }, { v: 600, l: '10 minutos' }, { v: 900, l: '15 minutos' }, { v: 1800, l: '30 minutos' }] as const;
const MODELOS: Array<{ v: Modelo; l: string; d: string }> = [
  { v: 'grade', l: 'Grade', d: 'Tudo na tela, de uma vez' },
  { v: 'destaque', l: 'Destaque + lateral', d: 'Um cartão grande e os demais ao lado' },
  { v: 'rotativo', l: 'Rotativo', d: 'Uma página por vez, trocando sozinha' },
];

const estadoLink = (p: PainelGerenciado) => p.revogado ? { t: 'Link revogado', c: 'bg-destructive/15 text-destructive' }
  : p.expiraEm && new Date(p.expiraEm).getTime() < Date.now() ? { t: 'Link expirado', c: 'bg-muted text-muted-foreground' } : { t: 'Link ativo', c: 'bg-accent/15 text-accent' };

export default function Paineis({ id }: { id?: string }) {
  const me = useMe().data;
  if (!podeGerirPaineis(me)) return <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground" data-testid="paineis-sem-acesso">Só o administrador da empresa cria e edita painéis.</div>;
  if (id === undefined) return <Lista />;
  return <Editor key={id} id={id === 'novo' ? null : Number(id)} />;
}

function Lista() {
  const lista = useListPaineis();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [apelido, setApelido] = useState('');
  const salvarApelido = useSetPainelApelido();
  useEffect(() => { if (lista.data) setApelido(lista.data.apelido); }, [lista.data?.apelido]); // eslint-disable-line react-hooks/exhaustive-deps
  if (lista.isLoading) return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="skel h-24 rounded-xl" />)}</div>;
  if (lista.isError || !lista.data) return <p className="text-sm text-destructive" role="alert">{apiMessage(lista.error)} <button className="underline" onClick={() => lista.refetch()}>Tentar novamente</button></p>;
  const { paineis, limitePaineis } = lista.data;
  const cheio = paineis.length >= (limitePaineis || MAX_PAINEIS);
  return (
    <div className="space-y-6 max-w-5xl" data-testid="paineis-lista">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div><h1 className="display text-3xl">Painéis para TV</h1><p className="text-sm text-muted-foreground mt-1 max-w-xl">Monte um painel com seus favoritos, abra o link na TV da sala e ele se atualiza sozinho.</p></div>
        <button type="button" className={botaoPrimario} disabled={cheio} onClick={() => navigate('/paineis/novo')} data-testid="button-criar-painel"><Plus className="h-4 w-4" />Criar painel</button>
      </div>
      {cheio && <p className="text-sm rounded-md border border-border bg-muted/50 px-3 py-2" data-testid="paineis-limite">Você chegou ao limite de {limitePaineis} painéis. Para criar outro, reaproveite um existente.</p>}
      {paineis.some(p => p.avisos.length > 0) && (
        <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 space-y-1" role="status" data-testid="paineis-avisos">
          {paineis.flatMap(p => p.avisos.map((a, i) => <p key={p.id + '-' + i} className="text-sm flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden /><span><strong>{p.nome}:</strong> {a}</span></p>))}
        </div>
      )}
      <form className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); salvarApelido.mutate({ data: { apelido: apelido.trim() } }, { onSuccess: r => { setApelido(r.apelido); qc.invalidateQueries({ queryKey: getListPaineisQueryKey() }); toast({ title: 'Nome do endereço salvo. Links já criados passam a usar o novo nome só quando forem gerados de novo.' }); }, onError: err => toast({ title: apiMessage(err), variant: 'destructive' }) }); }}>
        <label className="grow min-w-56 text-sm"><span className="block text-muted-foreground mb-1">Nome da empresa no endereço (só para ficar legível)</span>
          <span className="flex items-center gap-1 text-muted-foreground"><span className="text-xs shrink-0">/painel/</span><input className={campo} value={apelido} onChange={e => setApelido(e.target.value.toLowerCase())} minLength={3} maxLength={48} pattern="[a-z0-9-]+" data-testid="input-apelido" /></span></label>
        <button type="submit" className={botao} disabled={salvarApelido.isPending || apelido.trim() === lista.data.apelido || apelido.trim().length < 3} data-testid="button-salvar-apelido">Salvar nome</button>
      </form>
      {paineis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-3" data-testid="paineis-vazio">
          <MonitorPlay className="h-8 w-8 mx-auto text-primary" aria-hidden />
          <h2 className="display text-xl">Nenhum painel ainda</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Escolha alguns favoritos, o Tato organiza a tela e você recebe um link para abrir na TV.</p>
          <button type="button" className={botaoPrimario} onClick={() => navigate('/paineis/novo')}><Plus className="h-4 w-4" />Criar o primeiro painel</button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {paineis.map(p => { const e = estadoLink(p); return (
            <li key={p.id}><Link href={'/paineis/' + p.id} className="block rounded-xl border border-border bg-card p-4 hover:border-primary/60 transition-colors" data-testid={'painel-item-' + p.id}>
              <div className="flex items-start justify-between gap-3"><h2 className="display text-lg truncate">{p.nome}</h2><span className={'text-[11px] rounded-full px-2 py-0.5 shrink-0 ' + e.c}>{e.t}</span></div>
              <p className="text-sm text-muted-foreground mt-1">{p.cartoes.length} {p.cartoes.length === 1 ? 'cartão' : 'cartões'} · {MODELOS.find(m => m.v === p.modelo)?.l}</p>
              <p className="text-xs text-muted-foreground mt-3 num">{p.ultimoAcesso ? 'Último acesso ' + fmtCarimbo(p.ultimoAcesso) + ' · ' + p.acessos24h + ' acessos em 24 h' : 'Ninguém abriu ainda'}</p>
              {p.avisos.length > 0 && <p className="text-xs text-primary mt-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />{p.avisos.length} {p.avisos.length === 1 ? 'aviso' : 'avisos'}</p>}
            </Link></li>); })}
        </ul>
      )}
    </div>
  );
}

type Item = { key: string; favoritoId: number | null; titulo: string; forma: Forma | null; tamanho: Tamanho; pagina: number | null; estado: 'ok' | 'removido' | 'sem_acesso' };
let seq = 0;
const novaChave = () => 'i' + ++seq;

function Editor({ id }: { id: number | null }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const lista = useListPaineis();
  const favoritos = useListPainelFavoritos();
  const painel = useGetPainel(id ?? 0, { query: { enabled: id !== null, queryKey: getGetPainelQueryKey(id ?? 0) } });
  const salvoPreview = usePreviewPainel(id ?? 0, { query: { enabled: id !== null, queryKey: getPreviewPainelQueryKey(id ?? 0), retry: false, refetchOnWindowFocus: false } });
  const criar = useCreatePainel({ mutation: { gcTime: 0 } });
  const atualizar = useUpdatePainel();
  const regenerar = useRegeneratePainelLink({ mutation: { gcTime: 0 } });
  const revogar = useRevokePainelLink();

  const [nome, setNome] = useState('');
  const [modelo, setModelo] = useState<Modelo>('grade');
  const [tema, setTema] = useState<'escuro' | 'claro'>('escuro');
  const [atualizacao, setAtualizacao] = useState<number>(300);
  const [rotacao, setRotacao] = useState(20);
  const [automatica, setAutomatica] = useState(true);
  const [expiraEm, setExpiraEm] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<{ url: string; irPara: number | null } | null>(null);
  const [confirmar, setConfirmar] = useState<'regenerar' | 'revogar' | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const iniciado = useRef<string | null>(null);

  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const chave = id === null ? 'novo' : String(id);
    if (iniciado.current === chave) return;
    if (id === null) { iniciado.current = chave; return; }
    const p = painel.data; if (!p) return;
    iniciado.current = chave;
    setNome(p.nome); setModelo(p.modelo); setTema(p.tema); setAtualizacao(p.atualizacaoSegundos); setRotacao(p.rotacaoSegundos); setAutomatica(p.ordemAutomatica);
    setExpiraEm(p.expiraEm ? p.expiraEm.slice(0, 10) : '');
    setItens(p.cartoes.map(c => ({ key: novaChave(), favoritoId: c.favoritoId, titulo: c.titulo, forma: null, tamanho: c.tamanho, pagina: c.pagina, estado: c.estado })));
  }, [id, painel.data]);

  const favs = favoritos.data?.itens ?? [];
  const limite = lista.data?.limiteCartoes ?? MAX_CARTOES;
  const salvo = painel.data;
  const previewSalvo = salvoPreview.data;
  // The public answer omits cards the creator cannot access: pair by the accessible configured slots only, in order.
  const previaPorFavorito = useMemo(() => {
    const mapa = new Map<number, NonNullable<typeof previewSalvo>['cartoes'][number]>();
    if (!salvo || !previewSalvo) return mapa;
    salvo.cartoes.filter(c => c.estado !== 'sem_acesso').forEach((c, i) => { const p = previewSalvo.cartoes[i]; if (p && c.favoritoId !== null) mapa.set(c.favoritoId, p); });
    return mapa;
  }, [salvo, previewSalvo]);
  const formaDe = (it: Item): Forma => favs.find(f => f.id === it.favoritoId)?.forma ?? (it.favoritoId !== null ? previaPorFavorito.get(it.favoritoId)?.dados?.form : undefined) ?? it.forma ?? 'numero';

  const ordenados = useMemo(() => automatica ? ordenarAutomatico(itens.map(i => ({ ...i, forma: formaDe(i) }))) : itens, [automatica, itens, favs, previewSalvo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview: the saved data is cached; order, sizes and pages are applied locally, data is never invented.
  const previewLocal: PainelPublico = useMemo(() => ({
    nome: nome || 'Novo painel', empresa: '', modelo, tema, atualizacaoSegundos: atualizacao, rotacaoSegundos: rotacao, ordemAutomatica: automatica,
    atualizadoEm: previewSalvo?.atualizadoEm ?? null, verificadoEm: previewSalvo?.verificadoEm ?? new Date().toISOString(),
    cartoes: itens.map(it => {
      const base = it.favoritoId !== null && it.estado !== 'sem_acesso' ? previaPorFavorito.get(it.favoritoId) : undefined;
      return { chave: it.key, titulo: it.titulo, tamanho: it.tamanho, pagina: modelo === 'rotativo' ? it.pagina : null,
        estado: it.estado === 'removido' ? 'removido' as const : base ? base.estado : 'erro' as const, dados: it.estado === 'removido' ? null : base?.dados ?? null, atualizadoEm: base?.atualizadoEm ?? null };
    }),
  }), [nome, modelo, tema, atualizacao, rotacao, automatica, itens, previewSalvo, previaPorFavorito]);

  const entrada = (): PainelEntrada => ({
    nome: nome.trim(), modelo, tema, atualizacaoSegundos: atualizacao as PainelEntrada['atualizacaoSegundos'], rotacaoSegundos: rotacao, ordemAutomatica: automatica,
    expiraEm: expiraEm ? new Date(expiraEm + 'T23:59:59').toISOString() : null,
    cartoes: (automatica ? ordenados : itens).filter(i => i.estado !== 'removido' || i.favoritoId !== null).map(i => ({ favoritoId: i.favoritoId, tamanho: i.tamanho, pagina: modelo === 'rotativo' ? i.pagina : null })),
  });

  const aposSalvar = (p: PainelGerenciado) => {
    qc.setQueryData(getGetPainelQueryKey(p.id), p);
    qc.invalidateQueries({ queryKey: getListPaineisQueryKey() });
    qc.invalidateQueries({ queryKey: getPreviewPainelQueryKey(p.id) });
  };
  const falha = (e: unknown) => toast({ title: apiMessage(e), variant: 'destructive' });

  const salvar = () => {
    if (!nome.trim()) { toast({ title: 'Dê um nome ao painel.', variant: 'destructive' }); return; }
    if (id === null) {
      criar.mutate({ data: entrada() }, { onSuccess: r => { aposSalvar(r.painel); setSegredo({ url: publicAppUrl(r.link), irPara: r.painel.id }); criar.reset(); }, onError: falha });
    } else {
      atualizar.mutate({ id, data: entrada() }, { onSuccess: p => { aposSalvar(p); iniciado.current = String(id); toast({ title: 'Painel salvo.' }); }, onError: falha });
    }
  };
  const confirmarAcao = () => {
    if (id === null || !confirmar) return;
    if (confirmar === 'regenerar') regenerar.mutate({ id }, { onSuccess: r => { aposSalvar(r.painel); setSegredo({ url: publicAppUrl(r.link), irPara: null }); regenerar.reset(); }, onError: falha });
    else revogar.mutate({ id }, { onSuccess: p => { aposSalvar(p); toast({ title: 'Link revogado. As TVs abertas mostram "painel desativado".' }); }, onError: falha });
    setConfirmar(null);
  };
  const fecharSegredo = () => { const ir = segredo?.irPara; setSegredo(null); setCopiado(false); if (ir) navigate('/paineis/' + ir, { replace: true }); };
  const copiar = async () => { if (!segredo) return; try { await navigator.clipboard.writeText(segredo.url); setCopiado(true); } catch { toast({ title: 'Não foi possível copiar. Selecione o endereço e copie.', variant: 'destructive' }); } };

  const adicionar = (f: { id: number; titulo: string; forma: Forma }) => {
    if (itens.length >= limite) return;
    setItens(l => [...l, { key: novaChave(), favoritoId: f.id, titulo: f.titulo, forma: f.forma, tamanho: 'auto', pagina: null, estado: 'ok' }]);
  };
  const mover = (de: string, para: number) => {
    setItens(l => { const base = automatica ? ordenados as Item[] : l; const i = base.findIndex(x => x.key === de); if (i < 0 || para < 0 || para >= base.length || i === para) return l; const c = [...base]; const [x] = c.splice(i, 1); c.splice(para, 0, x); return c; });
    setAutomatica(false);
  };
  const lixo = (key: string) => setItens(l => l.filter(i => i.key !== key));
  const ajustar = (key: string, p: Partial<Item>) => setItens(l => l.map(i => i.key === key ? { ...i, ...p } : i));
  const reorganizarAuto = () => { setItens(l => reorganizar(l.map(i => ({ ...i, forma: formaDe(i) }))).map(i => i)); setAutomatica(true); };

  if (id !== null && painel.isLoading) return <div className="skel h-96 rounded-xl" aria-busy="true" />;
  if (id !== null && (painel.isError || !painel.data)) return <p className="text-sm text-destructive" role="alert">{apiMessage(painel.error)} <button className="underline" onClick={() => painel.refetch()}>Tentar novamente</button></p>;
  const visiveis = automatica ? (ordenados as Item[]) : itens;
  const salvando = criar.isPending || atualizar.isPending;
  const adicionados = new Set(itens.map(i => i.favoritoId));
  const estado = salvo ? estadoLink(salvo) : null;

  return (
    <div className="max-w-7xl space-y-5" data-testid="painel-editor">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h1 className="display text-3xl">{id === null ? 'Novo painel' : salvo?.nome}</h1>
        <button type="button" className={botaoPrimario} onClick={salvar} disabled={salvando} data-testid="button-salvar-painel">{salvando ? 'Salvando…' : id === null ? 'Criar painel e gerar link' : 'Salvar painel'}</button>
      </div>
      {salvo && salvo.avisos.length > 0 && <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm space-y-1" role="status">{salvo.avisos.map((a, i) => <p key={i} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden />{a}</p>)}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          <section className="rounded-xl border border-border bg-card p-4 space-y-4" aria-label="Configuração">
            <label className="block text-sm"><span className="text-muted-foreground block mb-1">Nome do painel</span><input className={campo} value={nome} maxLength={80} onChange={e => setNome(e.target.value)} placeholder="Comercial, Financeiro…" data-testid="input-nome-painel" /></label>
            <fieldset><legend className="text-sm text-muted-foreground mb-1">Modelo</legend>
              <div className="grid gap-2">{MODELOS.map(m => <button key={m.v} type="button" aria-pressed={modelo === m.v} onClick={() => setModelo(m.v)} data-testid={'modelo-' + m.v} className={'text-left rounded-md border px-3 py-2 ' + (modelo === m.v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted')}><span className="block text-sm font-medium">{m.l}</span><span className="block text-xs text-muted-foreground">{m.d}</span></button>)}</div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm"><span className="text-muted-foreground block mb-1">Atualizar a cada</span><select className={campo} value={atualizacao} onChange={e => setAtualizacao(Number(e.target.value))} data-testid="select-atualizacao">{INTERVALOS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
              <label className="block text-sm"><span className="text-muted-foreground block mb-1">Tema da TV</span><select className={campo} value={tema} onChange={e => setTema(e.target.value as 'escuro' | 'claro')} data-testid="select-tema"><option value="escuro">Escuro</option><option value="claro">Claro</option></select></label>
              {modelo === 'rotativo' && <label className="block text-sm"><span className="text-muted-foreground block mb-1">Trocar página a cada (s)</span><input type="number" min={10} max={120} className={campo} value={rotacao} onChange={e => setRotacao(Math.min(120, Math.max(10, Number(e.target.value) || 10)))} data-testid="input-rotacao" /></label>}
              <label className="block text-sm"><span className="text-muted-foreground block mb-1">Link vale até (opcional)</span><input type="date" className={campo} value={expiraEm} onChange={e => setExpiraEm(e.target.value)} data-testid="input-expira" /></label>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Cartões do painel">
            <div className="flex items-center justify-between gap-2"><h2 className="display text-lg">Cartões <span className="num text-sm text-muted-foreground">{itens.length}/{limite}</span></h2>
              <button type="button" className={botao + ' h-9'} onClick={reorganizarAuto} disabled={itens.length === 0} data-testid="button-reorganizar"><Wand2 className="h-4 w-4" />Reorganizar automaticamente</button></div>
            <p className="text-xs text-muted-foreground" data-testid="texto-ordem">{automatica ? 'Organização automática: números em cima, gráficos e tabelas embaixo.' : 'Ordem ajustada por você. Reorganize para voltar ao automático.'}</p>
            {visiveis.length === 0 ? <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-4 text-center" data-testid="cartoes-vazio">Escolha favoritos abaixo para começar.</p> : (
              <ol className="space-y-2">
                {visiveis.map((it, i) => (
                  <li key={it.key} draggable onDragStart={() => setArrastando(it.key)} onDragEnd={() => setArrastando(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (arrastando && arrastando !== it.key) mover(arrastando, i); setArrastando(null); }}
                    className={'rounded-md border border-border bg-background p-2 flex flex-wrap items-center gap-2 ' + (arrastando === it.key ? 'opacity-50' : '')} data-testid={'editor-cartao-' + i}>
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1"><p className="text-sm truncate" title={it.titulo}>{it.estado === 'removido' ? 'Cartão removido' : it.titulo}</p>{it.estado === 'sem_acesso' && <p className="text-[11px] text-destructive">Sem acesso do criador</p>}</div>
                    <select aria-label="Tamanho" className="h-8 rounded border border-border bg-background text-xs px-1" value={it.tamanho} onChange={e => ajustar(it.key, { tamanho: e.target.value as Tamanho })} data-testid={'tamanho-' + i}><option value="auto">Auto</option><option value="pequeno">P</option><option value="medio">M</option><option value="grande">G</option></select>
                    {modelo === 'rotativo' && <select aria-label="Página" className="h-8 rounded border border-border bg-background text-xs px-1" value={it.pagina ?? ''} onChange={e => ajustar(it.key, { pagina: e.target.value ? Number(e.target.value) : null })} data-testid={'pagina-' + i}><option value="">Pág. auto</option>{Array.from({ length: 12 }, (_, n) => <option key={n} value={n + 1}>Pág. {n + 1}</option>)}</select>}
                    <button type="button" aria-label="Mover para cima" className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => mover(it.key, i - 1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" aria-label="Mover para baixo" className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === visiveis.length - 1} onClick={() => mover(it.key, i + 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" aria-label="Remover cartão" className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-destructive" onClick={() => lixo(it.key)} data-testid={'remover-' + i}><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Favoritos disponíveis">
            <h2 className="display text-lg">Seus favoritos</h2>
            {itens.length >= limite && <p className="text-xs text-muted-foreground" data-testid="cartoes-limite">Limite de {limite} cartões por painel.</p>}
            {favoritos.isLoading ? <div className="skel h-20" /> : favoritos.isError ? <p className="text-sm text-destructive">{apiMessage(favoritos.error)} <button className="underline" onClick={() => favoritos.refetch()}>Tentar novamente</button></p>
            : favs.length === 0 ? <p className="text-sm text-muted-foreground">Você ainda não tem favoritos. Guarde uma resposta como favorito para usá-la aqui.</p> : (
              <ul className="divide-y divide-border">
                {favs.map(f => (
                  <li key={f.id} className="py-2 flex items-center gap-2" data-testid={'escolher-favorito-' + f.id}>
                    <div className="min-w-0 flex-1"><p className="text-sm truncate" title={f.titulo}>{f.titulo}</p><p className="text-[11px] text-muted-foreground">{FORMA_LABEL[f.forma]} · {f.tipo === 'vivo' ? 'acompanhando' : 'guardado'}</p></div>
                    <button type="button" className={botao + ' h-8 px-3'} disabled={adicionados.has(f.id) || itens.length >= limite} onClick={() => adicionar(f)} data-testid={'adicionar-favorito-' + f.id}>{adicionados.has(f.id) ? <Check className="h-4 w-4" aria-label="Já no painel" /> : <Plus className="h-4 w-4" aria-hidden />}{adicionados.has(f.id) ? 'No painel' : 'Adicionar'}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5 min-w-0">
          <section aria-label="Pré-visualização" className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2"><h2 className="display text-lg">Pré-visualização na TV</h2>
              {id !== null && <button type="button" className="text-xs underline text-muted-foreground inline-flex items-center gap-1" onClick={() => salvoPreview.refetch()} data-testid="button-atualizar-previa"><RefreshCw className={'h-3 w-3 ' + (salvoPreview.isFetching ? 'animate-spin' : '')} />Atualizar dados</button>}</div>
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-border" data-testid="previa-tv"><TvPainel painel={previewLocal} agora={agora} atualizadoEmMs={previewSalvo ? new Date(previewSalvo.verificadoEm).getTime() : null} desatualizadoMin={null} /></div>
            <p className="text-xs text-muted-foreground mt-2">{id === null ? 'Os dados aparecem depois que você criar o painel.' : 'Os números vêm do último salvamento; ordem, tamanhos e páginas mostram o que você está ajustando.'}</p>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Link da TV" data-testid="secao-link">
            <h2 className="display text-lg">Link da TV</h2>
            <p className="text-sm rounded-md bg-primary/10 border border-primary/30 px-3 py-2" data-testid="aviso-link">{AVISO_LINK}</p>
            <p className="text-xs text-muted-foreground">Para telas que visitantes podem ver, prefira cartões de totais em vez de rankings com nomes de clientes.</p>
            {!salvo ? <p className="text-sm text-muted-foreground">O link é gerado quando você cria o painel e aparece uma única vez.</p> : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><span className={'text-[11px] rounded-full px-2 py-0.5 ' + estado!.c} data-testid="estado-link">{estado!.t}</span>
                  <span className="num text-muted-foreground">/painel/{salvo.apelido}/{salvo.codigoPrefixo}…</span></div>
                <p className="text-xs text-muted-foreground num" data-testid="acessos">{salvo.ultimoAcesso ? 'Último acesso ' + fmtCarimbo(salvo.ultimoAcesso) : 'Ninguém abriu ainda'} · {salvo.acessos24h} acessos nas últimas 24 h</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={botao} onClick={() => setConfirmar('regenerar')} data-testid="button-regenerar"><RefreshCw className="h-4 w-4" />Regenerar link</button>
                  <button type="button" className={botao + ' text-destructive'} disabled={salvo.revogado} onClick={() => setConfirmar('revogar')} data-testid="button-revogar">Revogar agora</button>
                </div>
              </div>
            )}
          </section>

          {salvo && salvo.auditoria.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-4" aria-label="Histórico"><h2 className="display text-lg mb-2">Histórico</h2>
              <ul className="text-sm space-y-1">{salvo.auditoria.map((a, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{a.acao} · {a.ator}</span><span className="num text-xs text-muted-foreground shrink-0">{fmtCarimbo(a.em)}</span></li>)}</ul></section>
          )}
        </div>
      </div>

      <Dialog open={!!segredo} onOpenChange={o => { if (!o) fecharSegredo(); }}>
        <DialogContent data-testid="dialog-segredo" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader><DialogTitle>Link do painel</DialogTitle><DialogDescription>Copie agora. Por segurança este link não aparece de novo; se perder, gere outro.</DialogDescription></DialogHeader>
          <input readOnly value={segredo?.url ?? ''} className={campo + ' num'} onFocus={e => e.currentTarget.select()} aria-label="Endereço do painel" data-testid="input-link-segredo" />
          <p className="text-sm rounded-md bg-primary/10 border border-primary/30 px-3 py-2">{AVISO_LINK}</p>
          <DialogFooter className="gap-2"><button type="button" className={botao} onClick={copiar} data-testid="button-copiar-link">{copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copiado ? 'Copiado' : 'Copiar link'}</button>
            <button type="button" className={botaoPrimario} onClick={fecharSegredo} data-testid="button-fechar-segredo">Já copiei</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmar} onOpenChange={o => { if (!o) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirmar === 'regenerar' ? 'Regenerar o link?' : 'Revogar o link agora?'}</AlertDialogTitle>
            <AlertDialogDescription>{confirmar === 'regenerar' ? 'O link atual para de funcionar na hora e as TVs abertas com ele mostram "painel desativado". Você recebe um novo link.' : 'As TVs abertas mostram "painel desativado" e param de consultar. Você pode regenerar um link depois.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={confirmarAcao} data-testid="button-confirmar-link">{confirmar === 'regenerar' ? 'Regenerar' : 'Revogar'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
