import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, PAPEL_LABEL, useMe, type Papel, type Usuario } from '@/lib/auth-client';
import { SecretBox } from '@/components/secret-box';

const KEY = ['empresa', 'usuarios'] as const;

/** Company administrator: the people of their own company. The company comes from the session, so there is nothing to pick. */
export default function Users() {
  const qc = useQueryClient();
  const me = useMe().data;
  const users = useQuery({ queryKey: KEY, queryFn: () => api<Usuario[]>('GET', '/empresa/usuarios') });
  const [form, setForm] = useState<{ nome: string; email: string; papel: 'administrador' | 'gestor' }>({ nome: '', email: '', papel: 'gestor' });
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const add = useMutation({
    mutationFn: () => api<{ usuario: Usuario; senhaTemporaria: string }>('POST', '/empresa/usuarios', form),
    onSuccess: r => { setSecret({ title: `Acesso de ${r.usuario.nome}: ${r.usuario.email}`, password: r.senhaTemporaria }); setForm({ nome: '', email: '', papel: 'gestor' }); refresh(); },
  });
  const change = useMutation({
    mutationFn: (v: { id: number; body: { ativo?: boolean; papel?: Papel } }) => api<Usuario>('PATCH', `/empresa/usuarios/${v.id}`, v.body),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (u: Usuario) => api<{ senhaTemporaria: string }>('POST', `/empresa/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (r, u) => setSecret({ title: `Nova senha temporária de ${u.email}`, password: r.senhaTemporaria }),
  });
  const field = 'mt-1 w-full h-11 px-3 rounded border border-input bg-card';
  const problem = [add, change, reset].find(m => m.isError)?.error;
  return (
    <div className="space-y-10">
      <h1 className="display text-3xl">Usuários</h1>
      {secret && <SecretBox title={secret.title} password={secret.password} onClose={() => setSecret(null)} />}
      <section aria-labelledby="novo" className="space-y-4">
        <h2 id="novo" className="display text-xl">Adicionar pessoa</h2>
        <form className="grid gap-4 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
          <label className="text-sm">Nome
            <input required minLength={2} maxLength={80} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className={field} data-testid="input-usuario-nome" />
          </label>
          <label className="text-sm">E-mail
            <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={field} data-testid="input-usuario-email" />
          </label>
          <label className="text-sm">Perfil
            <select value={form.papel} onChange={e => setForm({ ...form, papel: e.target.value as 'administrador' | 'gestor' })} className={field}>
              <option value="gestor">Gestor: faz perguntas</option>
              <option value="administrador">Administrador: configura e cria usuários</option>
            </select>
          </label>
          <div className="sm:col-span-3"><button disabled={add.isPending} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-adicionar">{add.isPending ? 'Criando…' : 'Criar acesso'}</button></div>
        </form>
      </section>
      <section aria-labelledby="equipe" className="space-y-3">
        <h2 id="equipe" className="display text-xl">Equipe</h2>
        {users.isLoading && <div className="skel h-24" />}
        {users.isError && <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => users.refetch()}>Tentar novamente</button></p>}
        <ul className="divide-y divide-border border border-border rounded">
          {users.data?.map(u => (
            <li key={u.id} className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid={`usuario-${u.id}`}>
              <span className="font-medium">{u.nome}{u.id === me?.id ? ' (você)' : ''}</span>
              <span className="text-sm text-muted-foreground">{u.email}</span>
              <span className="text-xs">{PAPEL_LABEL[u.papel]}{!u.ativo ? ' · inativo' : ''}{u.trocarSenha ? ' · ainda não entrou' : ''}</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" disabled={reset.isPending} onClick={() => reset.mutate(u)}>Redefinir senha</button>
                {u.id !== me?.id && <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" disabled={change.isPending} onClick={() => change.mutate({ id: u.id, body: { ativo: !u.ativo } })}>{u.ativo ? 'Desativar' : 'Reativar'}</button>}
              </span>
            </li>
          ))}
        </ul>
        {problem && <p role="alert" className="text-sm text-destructive">{errorMessage(problem)}</p>}
      </section>
    </div>
  );
}
