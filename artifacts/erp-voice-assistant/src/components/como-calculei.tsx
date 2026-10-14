import { useEffect, useRef, useState } from 'react';
import { Calculator, Check, Copy, Info, X } from 'lucide-react';
import { getExplicarFavoritoQueryKey, getExplicarRespostaQueryKey, useExplicarFavorito, useExplicarResposta, type Explicacao } from '@workspace/api-client-react';
import { useFecharComVoltar } from '@/lib/navegacao';
import { fmtCarimbo } from '@/lib/cartao-format';
import { apiMessage } from '@/lib/favoritos';

export type FonteExplicacao = { tipo: 'resposta'; id: number } | { tipo: 'favorito'; id: number };
type Props = { fonte: FonteExplicacao; variante?: 'texto' | 'icone'; className?: string };

/**
 * "Como calculei": a discreet button that opens a short panel explaining where a number came from. The panel only shows
 * what the server read from the answer's own record or from the card; nothing here (or there) calls the model.
 */
export function ComoCalculei({ fonte, variante = 'texto', className = '' }: Props) {
  const [aberto, setAberto] = useState(false);
  const testId = `como-calculei-${fonte.tipo}-${fonte.id}`;
  return (
    <>
      {variante === 'icone' ? (
        <button type="button" onClick={() => setAberto(true)} aria-label="Como foi calculado" title="Como foi calculado" data-testid={testId}
          className={'h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted ' + className}>
          <Info className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={() => setAberto(true)} data-testid={testId}
          className={'inline-flex items-center gap-1.5 min-h-9 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-accent transition-colors ' + className}>
          <Calculator className="h-3.5 w-3.5 text-accent" aria-hidden />Como calculei
        </button>
      )}
      {aberto && <PainelExplicacao fonte={fonte} onClose={() => setAberto(false)} />}
    </>
  );
}

function useExplicacao(fonte: FonteExplicacao) {
  const resposta = useExplicarResposta(fonte.id, { query: { queryKey: getExplicarRespostaQueryKey(fonte.id), enabled: fonte.tipo === 'resposta', retry: false, staleTime: 5 * 60_000 } });
  const favorito = useExplicarFavorito(fonte.id, { query: { queryKey: getExplicarFavoritoQueryKey(fonte.id), enabled: fonte.tipo === 'favorito', retry: false, staleTime: 60_000 } });
  return fonte.tipo === 'resposta' ? resposta : favorito;
}

function PainelExplicacao({ fonte, onClose }: { fonte: FonteExplicacao; onClose: () => void }) {
  useFecharComVoltar(true, onClose);
  const query = useExplicacao(fonte);
  const fecharRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fecharRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const titulo = fonte.tipo === 'favorito' ? 'Como foi calculado' : 'Como calculei';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="explicacao-titulo" data-testid="explicacao-dialogo">
      <button className="absolute inset-0 bg-foreground/30" aria-label="Fechar" onClick={onClose} tabIndex={-1} />
      <div className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-background border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="explicacao-titulo" className="display text-xl inline-flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" aria-hidden />{titulo}</h2>
          <button ref={fecharRef} onClick={onClose} aria-label="Fechar" className="h-9 w-9 -mr-2 -mt-1 flex items-center justify-center rounded-full hover:bg-muted"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        {query.isPending && <div className="space-y-2" aria-busy="true"><div className="skel h-4 w-3/4" /><div className="skel h-4 w-full" /><div className="skel h-4 w-2/3" /></div>}
        {query.isError && <p className="text-sm text-destructive" role="alert">{apiMessage(query.error)}</p>}
        {query.data && <Conteudo e={query.data} />}
      </div>
    </div>
  );
}

const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <section className="space-y-1.5">
    <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">{titulo}</h3>
    <div className="text-sm leading-snug">{children}</div>
  </section>
);

function Conteudo({ e }: { e: Explicacao }) {
  if (e.origem === 'nenhuma') return <p className="text-sm text-muted-foreground" data-testid="explicacao-nenhuma">Esta resposta não veio de uma consulta aos dados da empresa, então não há cálculo para mostrar.</p>;
  if (e.origem === 'externa') return (
    <Secao titulo="Fonte pública">
      {e.fontesPublicas.length ? <ul className="space-y-1">{e.fontesPublicas.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a>{s.referenceDate ? <span className="text-muted-foreground"> · referência {s.referenceDate}</span> : null}</li>)}</ul>
        : <p className="text-muted-foreground">Resposta pesquisada em fonte pública; nenhum dado interno foi consultado.</p>}
    </Secao>
  );
  return (
    <div className="space-y-4" data-testid="explicacao-conteudo">
      <Secao titulo="Você perguntou"><p className="text-muted-foreground">“{e.pergunta}”</p></Secao>
      {e.entendimento && <Secao titulo="Como entendi"><p data-testid="explicacao-entendimento">{e.entendimento}</p></Secao>}
      <Secao titulo="De onde vieram os dados">
        <ul className="space-y-1">
          {e.fontes.map(f => <li key={f.assunto + f.descricao}><span className="font-medium">{f.assunto}</span><span className="text-muted-foreground"> — {f.descricao}</span></li>)}
          {e.periodo && <li data-testid="explicacao-periodo"><span className="font-medium">Período:</span> {e.periodo.texto}{e.periodo.relativo && <span className="ml-1.5 rounded-full bg-accent/15 px-2 py-px text-[11px] text-accent">{e.periodo.relativo}</span>}</li>}
          {e.filtros.map(f => <li key={f} className="text-muted-foreground">· {f}</li>)}
        </ul>
      </Secao>
      {e.metodo && <Secao titulo="Como cheguei ao valor"><p data-testid="explicacao-metodo">{e.metodo}</p></Secao>}
      <Secao titulo="Dados e quantidade">
        <ul className="space-y-1 text-muted-foreground">
          <li><span className="text-foreground num">{e.dadosDe ? `Dados de ${fmtCarimbo(e.dadosDe)}` : 'Idade dos dados não registrada'}</span>{e.dadosDeObs && e.dadosDe ? ` · ${e.dadosDeObs}` : ''}</li>
          {e.linhas !== null && <li data-testid="explicacao-linhas"><span className="text-foreground num">{e.linhas}</span> {e.linhas === 1 ? 'linha entrou' : 'linhas entraram'} no resultado</li>}
          {e.calculadoEm && <li>Calculado em {fmtCarimbo(e.calculadoEm)}</li>}
        </ul>
        {e.resumido && <p className="mt-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary" role="note" data-testid="explicacao-resumido">{e.resumido}</p>}
        {e.faltando.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Não registrado nesta resposta: {e.faltando.join(', ')}.</p>}
      </Secao>
      {e.fontesPublicas.length > 0 && <Secao titulo="Fontes públicas também citadas"><ul className="space-y-1">{e.fontesPublicas.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a></li>)}</ul></Secao>}
      {e.sql && <Consulta sql={e.sql} obs={e.sqlObs} tabelas={e.tabelas} />}
    </div>
  );
}

/** Read-only SQL for administrators, folded by default and copiable. Managers never receive it. */
function Consulta({ sql, obs, tabelas }: { sql: string; obs: string | null; tabelas: string[] }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => { try { await navigator.clipboard.writeText(sql); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sem área de transferência */ } };
  return (
    <details className="rounded-lg border border-border" data-testid="explicacao-consulta">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm min-h-10 flex items-center">Ver consulta</summary>
      <div className="border-t border-border p-3 space-y-2">
        {obs && <p className="text-xs text-muted-foreground">{obs}</p>}
        {tabelas.length > 0 && <p className="text-xs text-muted-foreground">Lê: {tabelas.join(', ')}</p>}
        <pre className="num text-xs whitespace-pre-wrap break-words rounded-md bg-muted p-3 max-h-56 overflow-auto"><code>{sql}</code></pre>
        <button type="button" onClick={copiar} className="inline-flex items-center gap-1.5 min-h-9 rounded-full border border-border px-3 text-xs hover:border-accent" data-testid="explicacao-copiar">
          {copiado ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </details>
  );
}
