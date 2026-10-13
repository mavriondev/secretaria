import { BrandMark } from '@/components/brand-mark';
import { BRAND } from '@/lib/brand';
import { Link } from 'wouter';
import { useLogout } from '@/lib/auth-client';

export default function Home() {
  const logout = useLogout();
  return (
    <main className="min-h-[100dvh] bg-background flex flex-col justify-center px-6 max-w-md mx-auto">
      <h1 className="display text-5xl flex items-center gap-3"><BrandMark className="h-11 w-11" />{BRAND.name}</h1>
      <p className="mt-3 text-muted-foreground">{BRAND.tagline}</p>
      <div className="mt-10 grid gap-3">
        <Link href="/usuario" data-testid="link-usuario" className="h-14 rounded bg-primary text-primary-foreground flex items-center justify-center text-lg">Usuário</Link>
        <Link href="/admin" data-testid="link-admin" className="h-14 rounded border border-border flex items-center justify-center text-lg hover:bg-muted">Administrativo</Link>
      </div>
      <button type="button" onClick={() => logout.mutate()} className="mt-8 text-xs text-muted-foreground underline self-start" data-testid="button-sair">Sair</button>
    </main>
  );
}
