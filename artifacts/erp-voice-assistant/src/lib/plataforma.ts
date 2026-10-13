import { useQuery } from '@tanstack/react-query';
import { api, type Empresa } from '@/lib/auth-client';

export const EMPRESAS_KEY = ['plataforma', 'empresas'] as const;
export const useEmpresas = () => useQuery({ queryKey: EMPRESAS_KEY, queryFn: () => api<Empresa[]>('GET', '/plataforma/empresas') });

export type Resumo = {
  origem: string; recebendo: boolean; assuntos: string[]; baseConectada: boolean; dadosProntos: boolean; erroDados: string | null;
  usuarios: { total: number; ativos: number; pendentes: number };
  uso30d: { respostas: number; custoUsd: number; ultimaResposta: string | null };
  limite: { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; mesDesde: string };
  ultimaCarga: { status: string; ok: boolean | null; erro: string | null; iniciadaEm: string } | null;
};
export const useResumo = (id: number) => useQuery({ queryKey: ['plataforma', 'resumo', id], queryFn: () => api<Resumo>('GET', `/plataforma/empresas/${id}/resumo`) });

export const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
