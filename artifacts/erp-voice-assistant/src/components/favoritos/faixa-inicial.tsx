import { Link } from 'wouter';
import { CartaoFavorito } from '@/components/favoritos/cartao-favorito';
import { useFavoritos } from '@/lib/favoritos';

/** Up to three favourites above the orb. Nothing is rendered when none is marked or the person turned the strip off. */
export function FaixaInicial() {
  const { lista } = useFavoritos();
  const marcados = lista.itens.filter(f => f.naTelaInicial).slice(0, lista.limiteTelaInicial);
  if (!lista.faixaTelaInicial || !marcados.length) return null;
  return (
    <section aria-label="Favoritos na tela inicial" className="min-w-0" data-testid="favorito-faixa">
      {/* Phones: one row that scrolls sideways (snap); wider screens: side by side. */}
      <ul className={'flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-5 px-5 sm:mx-0 sm:px-0 sm:grid sm:overflow-visible ' + (marcados.length === 1 ? 'sm:grid-cols-1' : marcados.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')} style={{ scrollbarWidth: 'none' }}>
        {marcados.map(f => <li key={f.id} className={'min-w-0 snap-start shrink-0 ' + (marcados.length === 1 ? 'w-full' : 'w-[78%] sm:w-auto')}><CartaoFavorito favorito={f} compacto /></li>)}
      </ul>
      <p className="text-right"><Link href="/favoritos" className="text-xs underline text-muted-foreground">Todos os favoritos</Link></p>
    </section>
  );
}
