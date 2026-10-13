import { useState } from 'react';
import { Link } from 'wouter';
import { usd, quando } from '@/lib/plataforma';
import { useUsoGeral } from '@/pages/plataforma/visao-geral';
import { StatusPill } from '@/components/plataforma/status-pill';

/** What every company costs and how much it asks, side by side, with the monthly ceiling of each. */
export default function UsoGeral() {
  const [dias, setDias] = useState(30);
  const uso = useUsoGeral(dias);
  const d = uso.data;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Uso e custo</h1>
          <p className="text-sm text-muted-foreground">Valores medidos em cada resposta (tokens e tempo), por empresa.</p>
        </div>
        <label className="text-sm">Período
          <select value={dias} onChange={e => setDias(Number(e.target.value))} className="ml-2 h-9 px-2 rounded border border-input bg-card">
            {[7, 30, 90].map(n => <option key={n} value={n}>{n} dias</option>)}
          </select>
        </label>
      </header>
      {uso.isLoading && <div className="skel h-24" />}
      {d && (
        <>
          <p className="text-sm num">{d.total.respostas.toLocaleString('pt-BR')} respostas · {usd(d.total.custoUsd)} no período.</p>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground bg-muted/40">
                <tr><th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">Respostas</th><th className="px-3 py-2 text-right">Custo</th><th className="px-3 py-2 text-right">Latência média</th><th className="px-3 py-2">Mês atual × limite</th><th className="px-3 py-2">Última resposta</th></tr>
              </thead>
              <tbody className="num">
                {d.empresas.map(e => (
                  <tr key={e.empresaId} className="border-t border-border">
                    <td className="px-3 py-2"><Link href={`/plataforma/empresas/${e.empresaId}`} className="hover:underline">{e.empresa}</Link>{!e.ativa && <span className="text-xs text-muted-foreground"> · desativada</span>}</td>
                    <td className="px-3 py-2 text-right">{e.respostas.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">{usd(e.custoUsd)}</td>
                    <td className="px-3 py-2 text-right">{e.latenciaMediaMs === null ? '—' : `${(e.latenciaMediaMs / 1000).toFixed(1)} s`}</td>
                    <td className="px-3 py-2">
                      {usd(e.limite.usadoUsd)}{e.limite.limiteUsd !== null ? ` / ${usd(e.limite.limiteUsd)}` : ' · sem teto'}
                      {e.limite.bloqueado ? <> <StatusPill tone="bad">bloqueada</StatusPill></> : e.limite.aviso ? <> <StatusPill tone="warn">perto do limite</StatusPill></> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{quando(e.ultimaResposta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
