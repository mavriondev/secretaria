import { BrandMark } from '@/components/brand-mark';
import { BRAND } from '@/lib/brand';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useChangePassword, useLogin, useLogout, errorMessage, type Me } from '@/lib/auth-client';

export function Login() {
  const login = useLogin();
  const [, go] = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  return (
    <main className="min-h-[100dvh] bg-background flex flex-col justify-center px-6 max-w-sm mx-auto">
      <h1 className="display text-4xl flex items-center gap-3"><BrandMark className="h-9 w-9" />{BRAND.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Entre com o e-mail e a senha da sua empresa.</p>
      <form className="mt-8 space-y-4" onSubmit={e => { e.preventDefault(); login.mutate({ email, senha }, { onSuccess: () => go('/') }); }}>
        <label className="block text-sm">E-mail
          <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} data-testid="input-email"
            className="mt-1 w-full h-11 px-3 rounded border border-input bg-card" />
        </label>
        <label className="block text-sm">Senha
          <input type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} data-testid="input-senha"
            className="mt-1 w-full h-11 px-3 rounded border border-input bg-card" />
        </label>
        <button disabled={login.isPending} className="w-full h-11 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-entrar">
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
        {login.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(login.error)}</p>}
      </form>
    </main>
  );
}

/** First access with a temporary password: nothing else is reachable until it is replaced. */
export function ChangePassword({ me }: { me: Me }) {
  const change = useChangePassword();
  const logout = useLogout();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const mismatch = repetir !== '' && nova !== repetir;
  return (
    <main className="min-h-[100dvh] bg-background flex flex-col justify-center px-6 max-w-sm mx-auto">
      <h1 className="display text-3xl">Crie sua senha</h1>
      <p className="mt-2 text-sm text-muted-foreground">{me.nome}, a senha que você recebeu é temporária. Escolha uma nova com pelo menos 10 caracteres.</p>
      <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); if (!mismatch) change.mutate({ senhaAtual: atual, novaSenha: nova }); }}>
        {([['Senha temporária', atual, setAtual, 'current-password'], ['Nova senha', nova, setNova, 'new-password'], ['Repita a nova senha', repetir, setRepetir, 'new-password']] as const).map(([label, value, set, auto]) => (
          <label key={label} className="block text-sm">{label}
            <input type="password" autoComplete={auto} required minLength={auto === 'new-password' ? 10 : 1} value={value} onChange={e => set(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded border border-input bg-card" />
          </label>
        ))}
        {mismatch && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
        <button disabled={change.isPending || mismatch} className="w-full h-11 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-trocar">
          {change.isPending ? 'Salvando…' : 'Salvar e continuar'}
        </button>
        {change.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(change.error)}</p>}
        <button type="button" onClick={() => logout.mutate()} className="w-full text-sm underline text-muted-foreground">Sair</button>
      </form>
    </main>
  );
}
