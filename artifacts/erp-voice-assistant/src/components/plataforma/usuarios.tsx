import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errorMessage, PAPEL_LABEL, type Empresa, type Usuario } from '@/lib/auth-client';

export function CompanyUsers({ company, onSecret }: { company: Empresa; onSecret: (s: { title: string; password: string }) => void }) {
  const users = useQuery({ queryKey: ['plataforma', 'usuarios', company.id], queryFn: () => api<Usuario[]>('GET', `/plataforma/empresas/${company.id}/usuarios`) });
  const reset = useMutation({
    mutationFn: (u: Usuario) => api<{ senhaTemporaria: string }>('POST', `/plataforma/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (r, u) => onSecret({ title: `Nova senha temporária de ${u.email}`, password: r.senhaTemporaria }),
  });
  if (users.isLoading) return <div className="skel h-12" />;
  if (users.isError) return <p role="alert" className="text-sm text-destructive">{errorMessage(users.error)} <button type="button" className="underline" onClick={() => users.refetch()}>Tentar novamente</button></p>;
  return (
    <ul className="text-sm space-y-1 pl-2 border-l-2 border-border">
      {users.data?.length === 0 && <li className="text-muted-foreground py-1">Nenhum usuário cadastrado nesta empresa. O administrador cria os acessos em Usuários, dentro do painel da empresa.</li>}
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
