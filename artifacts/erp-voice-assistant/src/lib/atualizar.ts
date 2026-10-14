import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ME_KEY } from '@/lib/auth-client';
import { aplicarAtualizacao, useAtualizacaoDoApp } from '@/lib/pwa';

/** Favourite executions are driven by the data marker only: refreshing a screen never re-runs a card by itself. */
const EXECUCAO = /^\/api\/favoritos\/\d+\/executar$/;
const refaz = (key: readonly unknown[]) => !(typeof key[0] === 'string' && EXECUCAO.test(key[0])) && key !== ME_KEY && key[0] !== ME_KEY[0];

/**
 * "Atualizar": re-runs every query mounted on the current screen (not the whole app, not the favourite executions),
 * without reloading the page or touching what the person is typing. Also surfaces a waiting app version.
 */
export function useAtualizarTela() {
  const qc = useQueryClient();
  const [loc] = useLocation();
  const [carregando, setCarregando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const app = useAtualizacaoDoApp();
  const atualizar = useCallback(async () => {
    if (app.disponivel) { aplicarAtualizacao(); return; }
    setCarregando(true); setErro(null);
    try {
      await qc.refetchQueries({ type: 'active', predicate: q => refaz(q.queryKey) });
      const falhou = qc.getQueryCache().findAll({ type: 'active' }).some(q => q.state.status === 'error' && refaz(q.queryKey));
      if (falhou) setErro('Parte dos dados não atualizou.');
      setUltima(new Date());
    } catch { setErro('Não foi possível atualizar.'); }
    finally { setCarregando(false); }
  }, [qc, app.disponivel]);
  // Each screen starts with its own "agora" instead of inheriting the instant of another page.
  useEffect(() => { setUltima(null); setErro(null); }, [loc]);
  return { atualizar, carregando, ultima, erro, novaVersao: app.disponivel };
}

/** "atualizado agora" for the first minute, then the time. */
export function rotuloDeAtualizacao(ultima: Date | null, agora = new Date()): string | null {
  if (!ultima) return null;
  if (agora.getTime() - ultima.getTime() < 60_000) return 'atualizado agora';
  return `atualizado às ${ultima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
