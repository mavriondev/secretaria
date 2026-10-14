import { BRAND } from '@/lib/brand';
import { Link } from 'wouter';
import { ArrowRight, Mic, SlidersHorizontal } from 'lucide-react';
import { useLogout } from '@/lib/auth-client';
import { AuthFrame } from '@/components/auth-frame';

export default function Home() {
  const logout = useLogout();
  return (
    <AuthFrame>
      <main className="flex flex-col">
        <span className="block h-1 w-10 bg-primary rounded-full mb-5" aria-hidden />
        <h1 className="display text-5xl">{BRAND.name}</h1>
        <p className="mt-3 text-muted-foreground">{BRAND.tagline}</p>
        <div className="mt-10 grid gap-3">
          <Link href="/usuario" data-testid="link-usuario" className="group h-16 rounded-lg bg-primary text-primary-foreground flex items-center gap-3 px-5 text-lg font-medium">
            <Mic className="h-5 w-5" aria-hidden /><span className="flex-1">Usuário</span><ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
          <Link href="/admin" data-testid="link-admin" className="group h-16 rounded-lg border border-border bg-card flex items-center gap-3 px-5 text-lg hover:border-accent transition-colors">
            <SlidersHorizontal className="h-5 w-5 text-accent" aria-hidden /><span className="flex-1">Administrativo</span><ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>
        <button type="button" onClick={() => logout.mutate()} className="mt-8 min-h-11 text-sm text-muted-foreground underline self-start hover:text-foreground" data-testid="button-sair">Sair</button>
      </main>
    </AuthFrame>
  );
}
