import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { appUrl, publicAppUrl } from './app-path';

export type Papel = 'dono' | 'administrador' | 'gestor';
export type Me = { id: number; nome: string; email: string; papel: Papel; empresaId: number | null; empresa: string | null; dadosProntos: boolean; trocarSenha: boolean };
export class ApiFailure extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

/** Small hand-written client for the account and company-management routes; the metric routes keep using the generated client. */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(appUrl(`/api${path}`), {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFailure(res.status, (data as { error?: string } | null)?.error ?? 'Não foi possível concluir. Tente novamente.', data);
  return data as T;
}
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.');

export const ME_KEY = ['me'] as const;
export function useMe() {
  return useQuery({
    queryKey: ME_KEY, staleTime: Infinity, retry: false,
    queryFn: async (): Promise<Me | null> => {
      try { return await api<Me>('GET', '/auth/me'); }
      catch (e) { if (e instanceof ApiFailure && e.status === 401) return null; throw e; }
    },
  });
}
/** Drops everything cached for the previous person. The session query itself stays, because the screen is subscribed to it. */
const forgetData = (qc: QueryClient) => qc.removeQueries({ predicate: q => q.queryKey[0] !== ME_KEY[0] });
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; senha: string; manter: boolean }) => api<Me>('POST', '/auth/login', v),
    onSuccess: me => { forgetData(qc); qc.setQueryData(ME_KEY, me); },
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    onSettled: () => { forgetData(qc); qc.setQueryData(ME_KEY, null); },
  });
}
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { senhaAtual: string; novaSenha: string }) => api<void>('POST', '/auth/senha', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export type Empresa = { id: number; nome: string; erp: string; ativa: boolean; limiteMensalUsd?: number | null; limiteDiarioUsd?: number | null; dadosProntos: boolean; usuarios: number; criadaEm: string };
export type Usuario = { id: number; nome: string; email: string; papel: Papel; ativo: boolean; trocarSenha: boolean; criadoEm: string; sessoes: number };
export type Sessao = { id: number; aparelho: string; ultimoUso: string; criadaEm: string; expiraEm: string; atual: boolean; persistente: boolean };
export type LinkRedefinicao = { token: string; expiraEm: string; validadeMin: number };
/** The public address of the reset page for a token: the server only knows the token, the browser knows where the app lives. */
export const resetLink = (token: string) => `${publicAppUrl('/redefinir')}?token=${encodeURIComponent(token)}`;
export const ERP_LABEL: Record<string, string> = { sankhya: 'Sankhya', totvs: 'TOTVS', protheus: 'Protheus', outro: 'Outro', demonstracao: 'Demonstração' };
export const PAPEL_LABEL: Record<Papel, string> = { dono: 'Dono do produto', administrador: 'Administrador', gestor: 'Gestor' };
