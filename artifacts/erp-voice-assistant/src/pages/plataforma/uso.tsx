import { useState } from 'react';
import { Link } from 'wouter';
import { usd, quando } from '@/lib/plataforma';
import { useUsoGeral } from '@/pages/plataforma/visao-geral';
import { StatusPill } from '@/components/plataforma/status-pill';
import { EventosLista, PorTipoBars, TetoBar, type Teto } from '@/components/tetos';

const pill = (t: Teto) => (t.bloqueado ? <StatusPill tone="bad">bloqueada</StatusPill> : t.aviso ? <StatusPill tone="warn">perto do limite</StatusPill> : null);
const faixa = (t: Teto) => `${usd(t.usadoUsd)}${t.limiteUsd !== null ? ` / ${usd(t.limiteUsd)}` : ' · sem teto'}`;

/** What every company costs and how much it asks, side by side, with the ceilings of each, the platform's own ceiling and the latest warnings and blocks. */
export default function UsoGeral() {
  const [dias, setDias] = useState(30);
  const uso = useUsoGeral(dias);
  const d = uso.data;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Uso e custo</h1>
          <p className="text-sm text-muted-foreground">Cada chamada paga (modelo, voz, transcrição, favoritos ao vivo, implantação), por empresa. Os limites valem para a soma.</p>
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
          <section className="rounded border border-border bg-card p-4 md:p-6 space-y-4" aria-label="Plataforma" data-testid="plataforma-teto">
            <h2 className="display text-lg">Plataforma hoje</h2>
            {d.plataforma.teto ? <TetoBar titulo="Todas as empresas" teto={d.plataforma.teto} pausa="o serviço inteiro está pausado até amanhã; amplie o teto em Diagnóstico › Limites se for o caso." /> : <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>}
            <div className="grid lg:grid-cols-2 gap-6"><PorTipoBars titulo="Hoje, por tipo" valores={d.plataforma.hoje} /><PorTipoBars titulo="Este mês, por tipo" valores={d.plataforma.mes} /></div>
          </section>
          <p className="text-sm num">{d.total.respostas.toLocaleString('pt-BR')} respostas · {usd(d.total.custoUsd)} de custo das respostas no período (não inclui voz nem transcrição).</p>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground bg-muted/40">
                <tr><th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">Respostas</th><th className="px-3 py-2 text-right">Custo das respostas</th><th className="px-3 py-2 text-right">Latência média</th><th className="px-3 py-2">Hoje × limite</th><th className="px-3 py-2">Mês atual × limite</th><th className="px-3 py-2">Última resposta</th></tr>
              </thead>
              <tbody className="num">
                {d.empresas.map(e => (
                  <tr key={e.empresaId} className="border-t border-border" data-testid={`uso-empresa-${e.empresaId}`}>
                    <td className="px-3 py-2"><Link href={`/plataforma/empresas/${e.empresaId}`} className="hover:underline">{e.empresa}</Link>{!e.ativa && <span className="text-xs text-muted-foreground"> · desativada</span>}</td>
                    <td className="px-3 py-2 text-right">{e.respostas.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">{usd(e.custoUsd)}</td>
                    <td className="px-3 py-2 text-right">{e.latenciaMediaMs === null ? '—' : `${(e.latenciaMediaMs / 1000).toFixed(1)} s`}</td>
                    <td className="px-3 py-2">{faixa(e.dia)}{e.dia.padrao ? <span className="text-xs text-muted-foreground"> · padrão</span> : null} {pill(e.dia)}</td>
                    <td className="px-3 py-2">{faixa(e.limite)} {pill(e.limite)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{quando(e.ultimaResposta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="space-y-2">
            <h2 className="display text-lg">Avisos e bloqueios recentes</h2>
            <EventosLista eventos={d.eventos} comEmpresa />
          </section>
        </>
      )}
    </div>
  );
}
