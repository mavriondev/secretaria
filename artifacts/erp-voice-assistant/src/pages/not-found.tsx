import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { AuthFrame } from '@/components/auth-frame';

export default function NotFound() {
  return (
    <AuthFrame>
      <main className="space-y-4 text-foreground">
        <p className="display num text-7xl text-primary leading-none" aria-hidden>404</p>
        <h1 className="display text-3xl">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço não existe ou você não tem acesso a ele.</p>
        <Link href="/" className="inline-flex h-11 items-center gap-2 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium w-fit" data-testid="link-inicio"><ArrowLeft className="h-4 w-4" aria-hidden />Voltar ao início</Link>
      </main>
    </AuthFrame>
  );
}
