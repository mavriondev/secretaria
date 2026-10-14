import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Download, Share } from 'lucide-react';
import { AuthFrame } from '@/components/auth-frame';
import { BrandMark } from '@/components/brand-mark';
import { PasswordField } from '@/components/password-field';
import { BRAND } from '@/lib/brand';
import { api, useChangePassword, useLogin, useLogout, errorMessage, type Me } from '@/lib/auth-client';
import { isMobileLike, useInstallPrompt } from '@/lib/pwa';

const field = 'mt-1 w-full h-12 px-3 rounded-lg border border-input bg-card text-base';
const primary = 'w-full h-13 min-h-12 rounded-lg bg-primary text-primary-foreground font-medium text-base disabled:opacity-50 transition-colors hover:bg-primary/90';

export function Login() {
  const login = useLogin();
  const [, go] = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [manter, setManter] = useState(() => isMobileLike());
  const [help, setHelp] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { emailRef.current?.focus(); }, []);
  // Typing again after a failure clears the message; the next attempt gets a clean screen.
  const edit = (set: (v: string) => void) => (v: string) => { set(v); if (login.isError) login.reset(); };
  return (
    <AuthFrame><main>
      <header className="flex items-center gap-3">
        {/* Provisional symbol: the final logo takes this slot (same box, 40px) without moving anything else. */}
        <span className="h-10 w-10 rounded-xl bg-sidebar border border-sidebar-border flex items-center justify-center text-primary" data-testid="brand-symbol"><BrandMark className="h-6 w-6" /></span>
        <div><h1 className="display text-3xl leading-none">{BRAND.name}</h1><p className="mt-1 text-sm text-muted-foreground">Entre com o e-mail e a senha da sua empresa.</p></div>
      </header>
      <form className="mt-8 space-y-4" noValidate onSubmit={e => { e.preventDefault(); if (!email || !senha) return; login.mutate({ email, senha, manter }, { onSuccess: () => go('/') }); }}>
        <label className="block text-sm">E-mail
          <input ref={emailRef} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={email}
            onChange={e => edit(setEmail)(e.target.value)} data-testid="input-email" className={field} />
        </label>
        <label className="block text-sm">Senha
          <PasswordField autoComplete="current-password" required value={senha} onChange={e => edit(setSenha)(e.target.value)} data-testid="input-senha" />
        </label>
        <label className="flex items-center gap-3 text-sm min-h-11 select-none">
          <input type="checkbox" checked={manter} onChange={e => setManter(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-manter" />
          <span>Manter conectado<span className="block text-xs text-muted-foreground">{manter ? 'Você continua conectado neste aparelho por até 60 dias de uso.' : 'A sessão termina ao fechar o navegador (no máximo 12 horas).'}</span></span>
        </label>
        <button disabled={login.isPending || !email || !senha} aria-busy={login.isPending} className={primary} data-testid="button-entrar">
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
        {login.isError && <p role="alert" aria-live="assertive" className="text-sm text-destructive" data-testid="text-erro-login">{errorMessage(login.error)}</p>}
      </form>
      <div className="mt-6 space-y-3 text-sm">
        <button type="button" onClick={() => setHelp(v => !v)} aria-expanded={help} className="underline text-muted-foreground hover:text-foreground" data-testid="link-esqueci-senha">Esqueci minha senha</button>
        {help && (
          <p className="text-muted-foreground rounded-lg border border-border bg-card p-3" data-testid="text-ajuda-senha">
            Peça ao administrador da sua empresa. Ele gera um link de redefinição no painel, em Usuários, e envia para você. O link vale por 1 hora e só pode ser usado uma vez.
          </p>
        )}
      </div>
      <InstallHint />
    </main></AuthFrame>
  );
}

/** Discreet install control: the browser's own prompt when it offers one, and a two-line hint on iPhone, where no prompt exists. */
export function InstallHint({ className = 'mt-8' }: { className?: string }) {
  const { canPrompt, ios, install } = useInstallPrompt();
  if (!canPrompt && !ios) return null;
  return (
    <div className={`${className} text-xs text-muted-foreground`} data-testid="install-hint">
      {canPrompt && <button type="button" onClick={install} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border hover:bg-muted text-foreground" data-testid="button-instalar"><Download className="h-4 w-4" />Instalar app</button>}
      {ios && <p className="inline-flex items-start gap-2"><Share className="h-4 w-4 shrink-0 mt-0.5" /><span>No iPhone: toque em Compartilhar no Safari e depois em “Adicionar à Tela de Início”.<br />O {BRAND.name} abre como aplicativo, já conectado.</span></p>}
    </div>
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
    <AuthFrame><main>
      <span className="block h-1 w-10 bg-accent rounded-full mb-5" aria-hidden />
      <h1 className="display text-3xl">Crie sua senha</h1>
      <p className="mt-2 text-sm text-muted-foreground">{me.nome}, a senha que você recebeu é temporária. Escolha uma nova com pelo menos 10 caracteres.</p>
      <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); if (!mismatch) change.mutate({ senhaAtual: atual, novaSenha: nova }); }}>
        {([['Senha temporária', atual, setAtual, 'current-password'], ['Nova senha', nova, setNova, 'new-password'], ['Repita a nova senha', repetir, setRepetir, 'new-password']] as const).map(([label, value, set, auto]) => (
          <label key={label} className="block text-sm">{label}
            <PasswordField autoComplete={auto} required minLength={auto === 'new-password' ? 10 : 1} value={value} onChange={e => set(e.target.value)} />
          </label>
        ))}
        {mismatch && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
        <button disabled={change.isPending || mismatch} className={primary} data-testid="button-trocar">
          {change.isPending ? 'Salvando…' : 'Salvar e continuar'}
        </button>
        {change.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(change.error)}</p>}
        <button type="button" onClick={() => logout.mutate()} className="w-full text-sm underline text-muted-foreground">Sair</button>
      </form>
    </main></AuthFrame>
  );
}

/** Public page reached from a one-time link generated by an administrator. Consuming it ends every session of the person. */
export function ResetPassword() {
  const search = useSearch();
  const [, go] = useLocation();
  const token = new URLSearchParams(search).get('token') ?? '';
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const mismatch = repetir !== '' && nova !== repetir;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (mismatch || !nova) return;
    setState({ kind: 'busy' });
    try { await api<void>('POST', '/auth/redefinir', { token, novaSenha: nova }); setState({ kind: 'done' }); }
    catch (err) { setState({ kind: 'error', message: errorMessage(err) }); }
  };
  return (
    <AuthFrame><main>
      <span className="block h-1 w-10 bg-accent rounded-full mb-5" aria-hidden />
      <h1 className="display text-3xl">Redefinir senha</h1>
      {state.kind === 'done' ? (
        <div className="mt-4 space-y-4" data-testid="text-redefinida">
          <p className="text-sm">Senha redefinida. Todos os aparelhos foram desconectados; entre de novo com a nova senha.</p>
          <button type="button" onClick={() => go('/')} className={primary} data-testid="button-ir-login">Ir para o login</button>
        </div>
      ) : !token ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="text-sem-token">Este endereço está incompleto. Abra o link exatamente como o administrador enviou ou peça um novo.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Escolha uma nova senha com pelo menos 10 caracteres. Este link vale por 1 hora e só funciona uma vez.</p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            {([['Nova senha', nova, setNova, 'input-nova-senha'], ['Repita a nova senha', repetir, setRepetir, 'input-repetir-senha']] as const).map(([label, value, set, testId]) => (
              <label key={label} className="block text-sm">{label}
                <PasswordField autoComplete="new-password" required minLength={10} value={value} onChange={e => { set(e.target.value); if (state.kind === 'error') setState({ kind: 'idle' }); }} data-testid={testId} />
              </label>
            ))}
            {mismatch && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
            <button disabled={state.kind === 'busy' || mismatch || nova.length < 10} className={primary} data-testid="button-redefinir">{state.kind === 'busy' ? 'Salvando…' : 'Salvar nova senha'}</button>
            {state.kind === 'error' && <p role="alert" className="text-sm text-destructive" data-testid="text-erro-redefinir">{state.message}</p>}
          </form>
        </>
      )}
    </main></AuthFrame>
  );
}
