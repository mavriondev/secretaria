import { useQuery } from '@tanstack/react-query';
import { api, type Empresa } from '@/lib/auth-client';
import type { EventoTeto, PorTipo, Teto, Tetos } from '@/components/tetos';

export const EMPRESAS_KEY = ['plataforma', 'empresas'] as const;
export const useEmpresas = () => useQuery({ queryKey: EMPRESAS_KEY, queryFn: () => api<Empresa[]>('GET', '/plataforma/empresas') });

export type Resumo = {
  origem: string; recebendo: boolean; assuntos: string[]; baseConectada: boolean; dadosProntos: boolean; erroDados: string | null;
  usuarios: { total: number; ativos: number; pendentes: number };
  uso30d: { respostas: number; custoUsd: number; ultimaResposta: string | null };
  limite: { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; mesDesde: string };
  tetos?: Tetos;
  ultimaCarga: { status: string; ok: boolean | null; erro: string | null; iniciadaEm: string } | null;
};
export const useResumo = (id: number) => useQuery({ queryKey: ['plataforma', 'resumo', id], queryFn: () => api<Resumo>('GET', `/plataforma/empresas/${id}/resumo`) });

export const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export type Configuracao = { valores: { teto_diario_plataforma_usd: number; teto_diario_empresa_padrao_usd: number }; padrao: { teto_diario_plataforma_usd: number; teto_diario_empresa_padrao_usd: number }; minimoDiarioUsd: number; precos: { vozUsdPor1kCaracteres: number; transcricaoUsdPorHora: number } };
export const CONFIG_KEY = ['plataforma', 'configuracao'] as const;
export const useConfiguracao = () => useQuery({ queryKey: CONFIG_KEY, queryFn: () => api<Configuracao>('GET', '/plataforma/configuracao') });

export type UsoGeral = {
  dias: number; total: { respostas: number; custoUsd: number };
  plataforma: { teto: Teto | null; hoje: PorTipo; mes: PorTipo };
  eventos: EventoTeto[];
  empresas: Array<{ empresaId: number; empresa: string; ativa: boolean; respostas: number; custoUsd: number; latenciaMediaMs: number | null; ultimaResposta: string | null; limite: Teto; dia: Teto; hoje: PorTipo; mes: PorTipo }>;
};
