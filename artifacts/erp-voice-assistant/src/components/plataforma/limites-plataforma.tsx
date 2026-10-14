import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';
import { CONFIG_KEY, useConfiguracao, usd, type Configuracao } from '@/lib/plataforma';

const parse = (v: string) => Number(v.replace(',', '.'));

/** The owner's two platform-wide ceilings: the whole service per day and the default per company per day. */
export function LimitesPlataforma() {
  const qc = useQueryClient();
  const cfg = useConfiguracao();
  const [plataforma, setPlataforma] = useState('');
  const [empresa, setEmpresa] = useState('');
  useEffect(() => { if (cfg.data) { setPlataforma(String(cfg.data.valores.teto_diario_plataforma_usd)); setEmpresa(String(cfg.data.valores.teto_diario_empresa_padrao_usd)); } }, [cfg.data]);
  const save = useMutation({
    mutationFn: () => api<Configuracao>('PUT', '/plataforma/configuracao', { teto_diario_plataforma_usd: parse(plataforma), teto_diario_empresa_padrao_usd: parse(empresa) }),
    onSuccess: data => { qc.setQueryData(CONFIG_KEY, data); qc.invalidateQueries({ queryKey: ['plataforma', 'uso'] }); },
  });
  const invalid = !(parse(plataforma) >= 0) || !(parse(empresa) >= 0);
  const c = cfg.data;
  return (
    <section className="rounded border border-border bg-card p-4 md:p-6 space-y-3" aria-label="Limites de uso" data-testid="limites-plataforma">
      <div>
        <h2 className="display text-lg">Limites de uso</h2>
        <p className="text-xs text-muted-foreground">Tetos diários em dólares, renovados à meia-noite de Brasília. Valem para toda chamada paga: modelo, voz, transcrição, favoritos ao vivo e implantação. Ao atingir, a IA responde com uma frase curta e não gasta nada.</p>
      </div>
      {cfg.isLoading && <div className="skel h-16" />}
      {c && (
        <form className="grid sm:grid-cols-2 gap-3 text-sm" onSubmit={e => { e.preventDefault(); if (!invalid) save.mutate(); }}>
          <label className="block">Plataforma inteira, por dia (US$)
            <input inputMode="decimal" value={plataforma} onChange={e => setPlataforma(e.target.value)} className="mt-1 w-full h-10 px-3 rounded border border-input bg-card num" aria-invalid={!(parse(plataforma) >= 0)} data-testid="teto-plataforma" />
            <span className="block text-xs text-muted-foreground mt-1">Padrão {usd(c.padrao.teto_diario_plataforma_usd)}. Soma de todas as empresas.</span></label>
          <label className="block">Empresa sem limite próprio, por dia (US$)
            <input inputMode="decimal" value={empresa} onChange={e => setEmpresa(e.target.value)} className="mt-1 w-full h-10 px-3 rounded border border-input bg-card num" aria-invalid={!(parse(empresa) >= 0)} data-testid="teto-empresa-padrao" />
            <span className="block text-xs text-muted-foreground mt-1">Padrão {usd(c.padrao.teto_diario_empresa_padrao_usd)}. Empresas com limite mensal usam um décimo dele (mínimo {usd(c.minimoDiarioUsd)}); o limite diário próprio, se houver, prevalece.</span></label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button className="h-9 px-3 rounded border border-border hover:bg-muted disabled:opacity-50" disabled={save.isPending || invalid}>{save.isPending ? 'Salvando…' : 'Salvar limites'}</button>
            {save.isSuccess && !save.isPending && <span className="text-xs text-muted-foreground">Salvo.</span>}
            {save.isError && <span role="alert" className="text-xs text-destructive">{errorMessage(save.error)}</span>}
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">Preços estimados usados na conta: voz {usd(c.precos.vozUsdPor1kCaracteres)} por mil caracteres · transcrição {usd(c.precos.transcricaoUsdPorHora)} por hora (ajustáveis por variável de ambiente no servidor).</p>
        </form>
      )}
    </section>
  );
}
