import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, PAPEL_LABEL, resetLink, type Empresa, type LinkRedefinicao, type Usuario } from '@/lib/auth-client';
import { LINK_NOTE } from '@/pages/users';

export function CompanyUsers({ company, onSecret }: { company: Empresa; onSecret: (s: { title: string; password: string; note?: string }) => void }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'usuarios', company.id] as const;
  const users = useQuery({ queryKey: key, queryFn: () => api<Usuario[]>('GET', `/plataforma/empresas/${company.id}/usuarios`) });
  const reset = useMutation({
    mutationFn: (u: Usuario) => api<{ senhaTemporaria: string }>('POST', `/plataforma/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (r, u) => { onSecret({ title: `Nova senha temporária de ${u.email}`, password: r.senhaTemporaria }); qc.invalidateQueries({ queryKey: key }); },
  });
  const link = useMutation({
    mutationFn: (u: Usuario) => api<LinkRedefinicao>('POST', `/plataforma/usuarios/${u.id}/link-redefinicao`),
    onSuccess: (r, u) => onSecret({ title: `Link de redefinição de senha para ${u.email}`, password: resetLink(r.token), note: LINK_NOTE }),
  });
  const endSessions = useMutation({ mutationFn: (u: Usuario) => api<void>('POST', `/plataforma/usuarios/${u.id}/encerrar-sessoes`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const problem = [reset, link, endSessions].find(m => m.isError)?.error;
  if (users.isLoading) return <div className="skel h-12" />;
  if (users.isError) return <p role="alert" className="text-sm text-destructive">{errorMessage(users.error)} <button type="button" className="underline" onClick={() => users.refetch()}>Tentar novamente</button></p>;
  return (
    <ul className="text-sm space-y-1 pl-2 border-l-2 border-border">
      {users.data?.length === 0 && <li className="text-muted-foreground py-1">Nenhum usuário cadastrado nesta empresa. O administrador cria os acessos em Usuários, dentro do painel da empresa.</li>}
      {users.data?.map(u => (
        <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
          <span>{u.nome}</span><span className="text-muted-foreground">{u.email}</span>
          <span className="text-xs">{PAPEL_LABEL[u.papel]}{!u.ativo ? ' · inativo' : ''}{u.trocarSenha ? ' · ainda não entrou' : ''}{u.sessoes > 0 ? ` · ${u.sessoes} ${u.sessoes === 1 ? 'aparelho' : 'aparelhos'}` : ''}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            {u.ativo && <button className="h-8 px-3 rounded border border-border hover:bg-muted" disabled={link.isPending} onClick={() => link.mutate(u)}>Gerar link de redefinição</button>}
            <button className="h-8 px-3 rounded border border-border hover:bg-muted" disabled={reset.isPending} onClick={() => reset.mutate(u)}>Senha temporária</button>
            {u.sessoes > 0 && <button className="h-8 px-3 rounded border border-border hover:bg-muted" disabled={endSessions.isPending} onClick={() => endSessions.mutate(u)}>Desconectar aparelhos</button>}
          </span>
        </li>
      ))}
      {problem && <li role="alert" className="text-destructive">{errorMessage(problem)}</li>}
    </ul>
  );
}
