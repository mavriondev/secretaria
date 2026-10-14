import { type ReactNode } from 'react';
import { Link } from 'wouter';
import { CartaoFavorito } from '@/components/favoritos/cartao-favorito';
import { useFavoritos, useMarcadorDados } from '@/lib/favoritos';

/**
 * Up to three favourites above the orb: the person's own marked cards first, then the company's shared cards an
 * administrator fixed for everyone (the server decides the list). Nothing is rendered when it is empty or the strip is off.
 */
export function FaixaInicial({ acoes }: { acoes?: ReactNode }) {
  const { lista } = useFavoritos();
  const marcados = lista.faixa.map(id => lista.itens.find(f => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f).slice(0, lista.limiteTelaInicial);
  const mostrar = lista.faixaTelaInicial && marcados.length > 0;
  // Polls the data marker only while there is a live card on this screen.
  useMarcadorDados(mostrar && marcados.some(f => f.tipo === 'vivo'));
  if (!mostrar) return null;
  return (
    <section aria-label="Favoritos na tela inicial" className="min-w-0" data-testid="favorito-faixa">
      {/* Phones: one row that scrolls sideways (snap); wider screens: side by side. */}
      <ul className={'flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-5 px-5 sm:mx-0 sm:px-0 sm:grid sm:overflow-visible ' + (marcados.length === 1 ? 'sm:grid-cols-1' : marcados.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')} style={{ scrollbarWidth: 'none' }}>
        {marcados.map(f => <li key={f.id} className={'min-w-0 snap-start shrink-0 ' + (marcados.length === 1 ? 'w-full' : 'w-[78%] sm:w-auto')}><CartaoFavorito favorito={f} compacto /></li>)}
      </ul>
      <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">{acoes}<Link href="/favoritos" className="underline">Todos os favoritos</Link></p>
    </section>
  );
}
