import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import { EMPRESAS_KEY } from '@/lib/plataforma';

export function LimitField({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(company.limiteMensalUsd === null || company.limiteMensalUsd === undefined ? '' : String(company.limiteMensalUsd));
  const save = useMutation({
    mutationFn: () => api<Empresa>('PATCH', `/plataforma/empresas/${company.id}`, { limiteMensalUsd: value.trim() === '' ? null : Number(value.replace(',', '.')) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: EMPRESAS_KEY }),
  });
  const invalid = value.trim() !== '' && !(Number(value.replace(',', '.')) >= 0);
  return (
    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (!invalid) save.mutate(); }}>
      <label className="text-xs text-muted-foreground" htmlFor={`lim-${company.id}`}>Limite/mês US$</label>
      <input id={`lim-${company.id}`} inputMode="decimal" placeholder="sem limite" value={value} onChange={e => setValue(e.target.value)} className="h-8 w-24 px-2 rounded border border-input bg-card text-sm num" aria-invalid={invalid} />
      <button className="h-8 px-2 rounded border border-border text-sm hover:bg-muted" disabled={save.isPending || invalid}>{save.isPending ? '…' : 'Salvar'}</button>
      {save.isError && <span className="text-xs text-destructive">{errorMessage(save.error)}</span>}
    </form>
  );
}
