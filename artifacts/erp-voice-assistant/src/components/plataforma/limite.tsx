import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import { EMPRESAS_KEY } from '@/lib/plataforma';

type Campo = 'limiteMensalUsd' | 'limiteDiarioUsd';
const ROTULO: Record<Campo, { label: string; vazio: string }> = {
  limiteMensalUsd: { label: 'Limite/mês US$', vazio: 'sem limite' },
  limiteDiarioUsd: { label: 'Limite/dia US$', vazio: 'padrão' },
};

/** One ceiling of a company (monthly or daily). An empty daily value means the default: a tenth of the monthly one, or the platform default. */
export function LimitField({ company, campo = 'limiteMensalUsd' }: { company: Empresa; campo?: Campo }) {
  const qc = useQueryClient();
  const atual = company[campo];
  const [value, setValue] = useState(atual === null || atual === undefined ? '' : String(atual));
  const save = useMutation({
    mutationFn: () => api<Empresa>('PATCH', `/plataforma/empresas/${company.id}`, { [campo]: value.trim() === '' ? null : Number(value.replace(',', '.')) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: EMPRESAS_KEY }); qc.invalidateQueries({ queryKey: ['plataforma', 'uso'] }); qc.invalidateQueries({ queryKey: ['plataforma', 'resumo', company.id] }); },
  });
  const invalid = value.trim() !== '' && !(Number(value.replace(',', '.')) >= 0);
  const id = `lim-${campo}-${company.id}`;
  return (
    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (!invalid) save.mutate(); }} data-testid={`campo-${campo}`}>
      <label className="text-xs text-muted-foreground" htmlFor={id}>{ROTULO[campo].label}</label>
      <input id={id} inputMode="decimal" placeholder={ROTULO[campo].vazio} value={value} onChange={e => setValue(e.target.value)} className="h-8 w-24 px-2 rounded border border-input bg-card text-sm num" aria-invalid={invalid} />
      <button className="h-8 px-2 rounded border border-border text-sm hover:bg-muted" disabled={save.isPending || invalid}>{save.isPending ? '…' : 'Salvar'}</button>
      {save.isError && <span className="text-xs text-destructive">{errorMessage(save.error)}</span>}
    </form>
  );
}
