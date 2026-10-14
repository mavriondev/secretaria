import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ChevronRight, Home, RefreshCw } from 'lucide-react';
import { useAtualizarTela, rotuloDeAtualizacao } from '@/lib/atualizar';
import { paginaDe, useTituloDinamico, useVoltar } from '@/lib/navegacao';

/**
 * Standard header of every secondary page: Voltar (44 px), the title, a breadcrumb trail on wide screens, a shortcut to
 * the start screen and, on pages with data, the discreet refresh icon. Used inside the administrative shell and on the
 * manager's own pages (favourites, notices).
 */
export function PageBar({ titulo, inicio = '/', acoes, className = '' }: { titulo?: string; inicio?: string; acoes?: ReactNode; className?: string }) {
  const [loc] = useLocation();
  const dinamico = useTituloDinamico();
  const pagina = paginaDe(loc, titulo ?? dinamico ?? undefined);
  const voltar = useVoltar(pagina.pai);
  const raiz = pagina.pai === null;
  return (
    <div className={'flex items-center gap-1 min-h-12 ' + className} data-testid="barra-pagina">
      {!raiz && (
        <button type="button" onClick={voltar} aria-label="Voltar" data-testid="button-voltar"
          className="inline-flex items-center gap-1.5 h-11 min-w-11 px-2 -ml-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted shrink-0">
          <ArrowLeft className="h-5 w-5" aria-hidden /><span className="sr-only md:not-sr-only">Voltar</span>
        </button>
      )}
      <nav aria-label="Você está em" className="min-w-0 flex-1 flex items-center gap-1 text-sm">
        <ol className="hidden md:flex items-center gap-1 text-muted-foreground min-w-0">
          {pagina.trilha.map(t => (
            <Fragment key={t.href + t.label}>
              <li className="truncate"><Link href={t.href} className="hover:text-foreground hover:underline">{t.label}</Link></li>
              <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
            </Fragment>
          ))}
        </ol>
        <span className="truncate font-medium" aria-current="page" data-testid="barra-titulo">{pagina.titulo}</span>
      </nav>
      <div className="flex items-center gap-0.5 shrink-0">
        {acoes}
        {pagina.dados && <BotaoAtualizar />}
        {loc !== inicio && (
          <Link href={inicio} aria-label="Início" title="Início" data-testid="link-inicio-barra"
            className="inline-flex items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
            <Home className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The small circular-arrows icon: refreshes the data of the current screen; with a dot, a new version of the app is
 * waiting and the tap applies it (one reload). Never reloads by itself.
 */
export function BotaoAtualizar({ className = '', oculto = false }: { className?: string; oculto?: boolean }) {
  const { atualizar, carregando, ultima, erro, novaVersao } = useAtualizarTela();
  if (oculto) return null;
  const rotulo = erro ?? rotuloDeAtualizacao(ultima);
  return (
    <span className={'inline-flex items-center gap-1 ' + className}>
      {rotulo && !novaVersao && <span className={'hidden sm:inline text-[11px] ' + (erro ? 'text-destructive' : 'text-muted-foreground')} role="status" data-testid="texto-atualizado">{rotulo}</span>}
      {novaVersao && <span className="hidden sm:inline text-[11px] text-primary" role="status">Nova versão disponível</span>}
      <button type="button" onClick={() => { void atualizar(); }} disabled={carregando}
        aria-label={novaVersao ? 'Nova versão disponível — Atualizar' : 'Atualizar'} title={novaVersao ? 'Nova versão disponível — Atualizar' : 'Atualizar'} aria-busy={carregando}
        data-testid="button-atualizar"
        className="relative inline-flex items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60">
        <RefreshCw className={'h-4 w-4 ' + (carregando ? 'animate-spin' : '')} aria-hidden />
        {novaVersao && <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" aria-hidden data-testid="ponto-nova-versao" />}
      </button>
    </span>
  );
}
