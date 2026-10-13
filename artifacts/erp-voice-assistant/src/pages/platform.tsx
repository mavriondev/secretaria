import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, ERP_LABEL, PAPEL_LABEL, type Empresa, type Usuario } from '@/lib/auth-client';
import { SecretBox } from '@/components/secret-box';

const ERPS = ['sankhya', 'totvs', 'protheus', 'outro'] as const;
const KEY = ['plataforma', 'empresas'] as const;

/** Product owner: customer companies. Creating one also creates its first administrator and shows the temporary password once. */
export default function Platform() {
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: KEY, queryFn: () => api<Empresa[]>('GET', '/plataforma/empresas') });
  const [form, setForm] = useState({ nome: '', erp: 'sankhya', adminNome: '', adminEmail: '' });
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ empresa: Empresa; administrador: Usuario; senhaTemporaria: string }>('POST', '/plataforma/empresas', {
      nome: form.nome, erp: form.erp, administrador: { nome: form.adminNome, email: form.adminEmail },
    }),
    onSuccess: r => {
      setSecret({ title: `Administrador de ${r.empresa.nome}: ${r.administrador.email}`, password: r.senhaTemporaria });
      setForm({ nome: '', erp: 'sankhya', adminNome: '', adminEmail: '' });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const toggle = useMutation({
    mutationFn: (c: Empresa) => api<Empresa>('PATCH', `/plataforma/empresas/${c.id}`, { ativa: !c.ativa }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const field = 'mt-1 w-full h-11 px-3 rounded border border-input bg-card';
  return (
    <div className="space-y-10">
      <h1 className="display text-3xl">Empresas clientes</h1>
      {secret && <SecretBox title={secret.title} password={secret.password} onClose={() => setSecret(null)} />}

      <section aria-labelledby="nova" className="space-y-4">
        <h2 id="nova" className="display text-xl">Cadastrar empresa</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <label className="text-sm">Nome da empresa
            <input required minLength={2} maxLength={100} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className={field} data-testid="input-empresa" />
          </label>
          <label className="text-sm">ERP que ela usa
            <select value={form.erp} onChange={e => setForm({ ...form, erp: e.target.value })} className={field}>
              {ERPS.map(erp => <option key={erp} value={erp}>{ERP_LABEL[erp]}</option>)}
            </select>
          </label>
          <label className="text-sm">Administrador (nome)
            <input required minLength={2} maxLength={80} value={form.adminNome} onChange={e => setForm({ ...form, adminNome: e.target.value })} className={field} />
          </label>
          <label className="text-sm">Administrador (e-mail)
            <input required type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className={field} />
          </label>
          <div className="sm:col-span-2 flex items-center gap-4">
            <button disabled={create.isPending} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-criar-empresa">
              {create.isPending ? 'Criando…' : 'Criar empresa e administrador'}
            </button>
            {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
          </div>
        </form>
        <p className="text-xs text-muted-foreground">A empresa nasce sem base de dados conectada: a IA só responde para ela depois da implantação (exportação do ERP e ficha de dados).</p>
      </section>

      <section aria-labelledby="lista" className="space-y-3">
        <h2 id="lista" className="display text-xl">Empresas cadastradas</h2>
        {companies.isLoading && <div className="skel h-24" />}
        {companies.isError && <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => companies.refetch()}>Tentar novamente</button></p>}
        <ul className="divide-y divide-border border border-border rounded">
          {companies.data?.map(c => (
            <li key={c.id} className="p-3 space-y-2" data-testid={`empresa-${c.id}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">{c.nome}</span>
                <span className="text-xs text-muted-foreground">{ERP_LABEL[c.erp] ?? c.erp} · {c.usuarios} usuário(s)</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${c.dadosProntos ? 'border-chart-4' : 'border-border text-muted-foreground'}`}>{c.dadosProntos ? 'Base conectada' : 'Base não conectada'}</span>
                {!c.ativa && <span className="text-xs px-2 py-0.5 rounded border border-destructive text-destructive">Desativada</span>}
                <span className="ml-auto flex gap-2">
                  <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Fechar' : 'Usuários'}</button>
                  {c.id !== 1 && <button className="h-8 px-3 rounded border border-border text-sm hover:bg-muted" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>{c.ativa ? 'Desativar' : 'Reativar'}</button>}
                </span>
              </div>
              {open === c.id && <CompanyUsers company={c} onSecret={setSecret} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CompanyUsers({ company, onSecret }: { company: Empresa; onSecret: (s: { title: string; password: string }) => void }) {
  const users = useQuery({ queryKey: ['plataforma', 'usuarios', company.id], queryFn: () => api<Usuario[]>('GET', `/plataforma/empresas/${company.id}/usuarios`) });
  const reset = useMutation({
    mutationFn: (u: Usuario) => api<{ senhaTemporaria: string }>('POST', `/plataforma/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (r, u) => onSecret({ title: `Nova senha temporária de ${u.email}`, password: r.senhaTemporaria }),
  });
  if (users.isLoading) return <div className="skel h-12" />;
  return (
    <ul className="text-sm space-y-1 pl-2 border-l-2 border-border">
      {users.data?.map(u => (
        <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
          <span>{u.nome}</span><span className="text-muted-foreground">{u.email}</span>
          <span className="text-xs">{PAPEL_LABEL[u.papel]}{!u.ativo ? ' · inativo' : ''}{u.trocarSenha ? ' · ainda não entrou' : ''}</span>
          <button className="ml-auto h-8 px-3 rounded border border-border hover:bg-muted" disabled={reset.isPending} onClick={() => reset.mutate(u)}>Redefinir senha</button>
        </li>
      ))}
      {reset.isError && <li role="alert" className="text-destructive">{errorMessage(reset.error)}</li>}
    </ul>
  );
}
