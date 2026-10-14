import { Link } from 'wouter';
import { Bell } from 'lucide-react';
import { useNotificacoes } from '@/lib/avisos';

/** Bell with the unread counter; opens the inbox. Shown wherever the manager works (assistant and favourites). */
export function Sino({ className = '' }: { className?: string }) {
  const { naoLidas } = useNotificacoes();
  return (
    <Link href="/avisos" aria-label={naoLidas ? `Avisos: ${naoLidas} não lidos` : 'Avisos'} data-testid="sino"
      className={'relative h-10 w-10 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted ' + className}>
      <Bell className="h-4 w-4" aria-hidden />
      {naoLidas > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-medium flex items-center justify-center num" data-testid="sino-contador">{naoLidas > 99 ? '99+' : naoLidas}</span>}
    </Link>
  );
}
