import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';

/**
 * In-app navigation: every secondary page has a logical parent, so "Voltar" works the same whether the app is
 * open in a browser tab or installed (where there is no browser back button).
 */
export type Trilha = Array<{ href: string; label: string }>;
export type PaginaInfo = { titulo: string; pai: string | null; trilha: Trilha; dados: boolean };

const INICIO = { href: '/', label: 'Início' };
const ADMIN = { href: '/admin', label: 'Administração' };
const PLAT = { href: '/plataforma', label: 'Plataforma' };
const ASSIST = { href: '/usuario', label: 'Assistente' };

const admin = (titulo: string, dados = false): PaginaInfo => ({ titulo, pai: '/admin', trilha: [INICIO, ADMIN], dados });
const PAGINAS: Record<string, PaginaInfo> = {
  '/admin': { titulo: 'Configurações', pai: '/', trilha: [INICIO], dados: false },
  '/admin/usuarios': admin('Usuários', true),
  '/admin/dados': admin('Dados', true),
  '/admin/saude': admin('Saúde dos dados', true),
  '/admin/testes': admin('Perguntas de teste', true),
  '/admin/uso': admin('Custo e tempo', true),
  '/admin/avaliacoes': admin('Respostas ruins', true),
  '/admin/conhecimento': admin('Conhecimento', true),
  '/admin/conferencia': admin('Conferência', true),
  '/admin/logs': admin('Auditoria', true),
  '/plataforma': { titulo: 'Visão geral', pai: null, trilha: [], dados: true },
  '/plataforma/uso': { titulo: 'Uso e custo', pai: '/plataforma', trilha: [PLAT], dados: true },
  '/plataforma/sistema': { titulo: 'Diagnóstico', pai: '/plataforma', trilha: [PLAT], dados: true },
  '/plataforma/empresas/nova': { titulo: 'Nova empresa', pai: '/plataforma', trilha: [PLAT, { href: '/plataforma', label: 'Empresas' }], dados: false },
  '/favoritos': { titulo: 'Favoritos', pai: '/usuario', trilha: [ASSIST], dados: true },
  '/avisos': { titulo: 'Avisos', pai: '/usuario', trilha: [ASSIST], dados: true },
};

/** Title, parent and breadcrumb trail for a path; dynamic routes (company, favourite) fall back to their list. */
export function paginaDe(path: string, titulo?: string): PaginaInfo {
  const p = path.replace(/\?.*$/, '');
  if (PAGINAS[p]) return titulo ? { ...PAGINAS[p], titulo } : PAGINAS[p];
  if (/^\/plataforma\/empresas\/\d+$/.test(p)) return { titulo: titulo ?? 'Empresa', pai: '/plataforma', trilha: [PLAT, { href: '/plataforma', label: 'Empresas' }], dados: true };
  if (/^\/favoritos\/\d+$/.test(p)) return { titulo: titulo ?? 'Favorito', pai: '/favoritos', trilha: [ASSIST, { href: '/favoritos', label: 'Favoritos' }], dados: true };
  return { titulo: titulo ?? '', pai: '/', trilha: [INICIO], dados: false };
}

/** The screens visited in this tab, in order. Used to decide between history.back() and the logical parent. */
const pilha: string[] = [];
let voltando = false;
let ignorarProximoPop = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { if (ignorarProximoPop) { ignorarProximoPop = false; return; } voltando = true; });

/** Mounted once (in the router): records in-app navigation. */
export function useRegistroDeNavegacao() {
  const [loc] = useLocation();
  useEffect(() => {
    if (voltando) { voltando = false; if (pilha.length > 1) pilha.pop(); if (pilha[pilha.length - 1] !== loc) pilha.push(loc); return; }
    if (pilha[pilha.length - 1] !== loc) pilha.push(loc);
  }, [loc]);
}

/** "Voltar": the previous in-app screen when there is one, otherwise the page's logical parent. */
export function useVoltar(pai: string | null) {
  const [, navigate] = useLocation();
  return () => {
    if (pilha.length > 1) { window.history.back(); return; }
    navigate(pai ?? '/', { replace: true });
  };
}

/**
 * Dialogs and drawers: the device's back gesture/button and Esc close them without leaving the page.
 * While open, one history entry is pushed; closing by button pops it; popping it (back gesture) closes the dialog.
 */
export function useFecharComVoltar(aberto: boolean, fechar: () => void) {
  const marcado = useRef(false);
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    if (!aberto) return;
    const estado = { tatoDialogo: Date.now() };
    window.history.pushState(estado, '', window.location.href);
    marcado.current = true;
    const onPop = () => { voltando = false; if (marcado.current) { marcado.current = false; fecharRef.current(); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharRef.current(); } };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey, true);
      // Closed by a button: remove the entry so the next back gesture does not reopen anything.
      if (marcado.current) { marcado.current = false; const s = window.history.state as { tatoDialogo?: number } | null; if (s?.tatoDialogo === estado.tatoDialogo) { ignorarProximoPop = true; window.history.back(); } }
    };
  }, [aberto]);
}

/** Tracks whether the on-screen keyboard shrank the visible area (phones): the footer then follows the visual viewport. */
export function useAlturaVisivel(ativo: boolean) {
  const [altura, setAltura] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!ativo || !vv) { setAltura(null); return; }
    const medir = () => { const reduzido = window.innerHeight - vv.height > 80; setAltura(reduzido ? vv.height : null); if (reduzido) window.scrollTo(0, 0); };
    medir();
    vv.addEventListener('resize', medir); vv.addEventListener('scroll', medir);
    return () => { vv.removeEventListener('resize', medir); vv.removeEventListener('scroll', medir); };
  }, [ativo]);
  return altura;
}

/** Pages with a dynamic title (a company, a favourite) announce it to the page bar. */
let tituloDinamico: string | null = null;
const ouvintesDeTitulo = new Set<() => void>();
export function useTituloDaPagina(titulo: string | null | undefined) {
  useEffect(() => {
    tituloDinamico = titulo ?? null; ouvintesDeTitulo.forEach(l => l());
    return () => { tituloDinamico = null; ouvintesDeTitulo.forEach(l => l()); };
  }, [titulo]);
}
export function useTituloDinamico() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick(n => n + 1); ouvintesDeTitulo.add(l); return () => { ouvintesDeTitulo.delete(l); }; }, []);
  return tituloDinamico;
}
