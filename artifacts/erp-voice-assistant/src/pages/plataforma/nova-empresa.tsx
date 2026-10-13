import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage, ERP_LABEL, type Empresa, type Usuario } from '@/lib/auth-client';
import { EMPRESAS_KEY } from '@/lib/plataforma';
import { SecretBox } from '@/components/secret-box';

const ERPS = ['sankhya', 'totvs', 'protheus', 'outro'] as const;

/** Creating a company also creates its first administrator; the temporary password is shown once, here. */
export default function NovaEmpresa() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ nome: '', erp: 'sankhya', adminNome: '', adminEmail: '' });
  const [created, setCreated] = useState<{ empresa: Empresa; title: string; password: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ empresa: Empresa; administrador: Usuario; senhaTemporaria: string }>('POST', '/plataforma/empresas', {
      nome: form.nome, erp: form.erp, administrador: { nome: form.adminNome, email: form.adminEmail },
    }),
    onSuccess: r => {
      setCreated({ empresa: r.empresa, title: `Administrador de ${r.empresa.nome}: ${r.administrador.email}`, password: r.senhaTemporaria });
      qc.invalidateQueries({ queryKey: EMPRESAS_KEY });
    },
  });
  const field = 'mt-1 w-full h-11 px-3 rounded border border-input bg-card';
  if (created) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="display text-3xl">{created.empresa.nome} criada</h1>
        <SecretBox title={created.title} password={created.password} onClose={() => navigate(`/plataforma/empresas/${created.empresa.id}`)} />
        <p className="text-sm text-muted-foreground">Próximo passo: na página da empresa, conecte a base de dados (aba "Base de dados") ou gere a chave de envio (aba "Recebimento").</p>
        <Link href={`/plataforma/empresas/${created.empresa.id}`} className="inline-flex h-10 items-center px-4 rounded border border-border text-sm hover:bg-muted">Abrir a empresa</Link>
      </div>
    );
  }
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/plataforma" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />Visão geral</Link>
      <div>
        <h1 className="display text-3xl">Nova empresa</h1>
        <p className="text-sm text-muted-foreground mt-1">A empresa nasce sem base conectada: a IA só responde para ela depois da implantação.</p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <label className="text-sm sm:col-span-2">Nome da empresa
          <input required minLength={2} maxLength={100} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className={field} data-testid="input-empresa" />
        </label>
        <label className="text-sm sm:col-span-2">ERP que ela usa
          <select value={form.erp} onChange={e => setForm({ ...form, erp: e.target.value })} className={field}>
            {ERPS.map(erp => <option key={erp} value={erp}>{ERP_LABEL[erp]}</option>)}
          </select>
        </label>
        <fieldset className="sm:col-span-2 grid gap-4 sm:grid-cols-2 rounded border border-border p-4">
          <legend className="px-1 text-sm font-medium">Primeiro administrador</legend>
          <label className="text-sm">Nome
            <input required minLength={2} maxLength={80} value={form.adminNome} onChange={e => setForm({ ...form, adminNome: e.target.value })} className={field} />
          </label>
          <label className="text-sm">E-mail
            <input required type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className={field} />
          </label>
        </fieldset>
        <div className="sm:col-span-2 flex items-center gap-4">
          <button disabled={create.isPending} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-criar-empresa">
            {create.isPending ? 'Criando…' : 'Criar empresa e administrador'}
          </button>
          {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
        </div>
      </form>
    </div>
  );
}
