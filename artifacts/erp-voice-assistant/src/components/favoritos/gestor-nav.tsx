import { Link, useLocation } from 'wouter';
import { Mic, Star } from 'lucide-react';
import { useFavoritos } from '@/lib/favoritos';

/** Appears only after the first favourite exists: a bottom bar on phones, a slim rail on wide screens. */
export function GestorNav() {
  const { lista } = useFavoritos();
  const [loc] = useLocation();
  if (!lista.itens.length) return null;
  const items = [
    { href: '/usuario', label: 'Assistente', icon: Mic, active: loc === '/usuario' },
    { href: '/favoritos', label: 'Favoritos', icon: Star, active: loc.startsWith('/favoritos') },
  ];
  return (
    <nav aria-label="Seções" data-testid="favorito-nav"
      className="fixed z-40 bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur md:inset-x-auto md:left-0 md:top-0 md:bottom-0 md:w-20 md:border-t-0 md:border-r md:flex md:flex-col md:justify-center">
      <ul className="flex md:flex-col justify-around md:gap-2 px-2 pb-[env(safe-area-inset-bottom)]">
        {items.map(i => (
          <li key={i.href}>
            <Link href={i.href} aria-current={i.active ? 'page' : undefined} data-testid={'favorito-nav-' + i.href.slice(1)}
              className={'flex flex-col items-center gap-1 py-2 px-3 rounded-lg text-[11px] ' + (i.active ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
              <i.icon className="h-5 w-5" aria-hidden />{i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
