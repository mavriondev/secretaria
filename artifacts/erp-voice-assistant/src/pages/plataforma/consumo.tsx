import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Download } from 'lucide-react';
import { api, errorMessage } from '@/lib/auth-client';
import { appUrl } from '@/lib/app-path';
import { usd, quando } from '@/lib/plataforma';
import { StatusPill } from '@/components/plataforma/status-pill';

type Vals = { totalUsd: number; textoUsd: number; vozUsd: number; transcricaoUsd: number; outrosUsd: number; perguntas: number; usuariosAtivos: number; custoPorPerguntaUsd: number | null; custoPorUsuarioUsd: number | null; projecaoUsd: number | null };
type Consumo = {
  periodo: { inicio: string; fim: string; rotulo: string; mes: string | null; diasDecorridos: number; diasMes: number };
  totais: Vals;
  empresas: Array<Vals & { empresaId: number; empresa: string; ativa: boolean; tetoMensalUsd: number | null; percentualTeto: number | null }>;
  dias: Array<{ dia: string; empresaId: number; totalUsd: number }>;
  plataforma: { tetoDiarioUsd: number; gastoHojeUsd: number; percentualHoje: number | null };
  nota: string;
};
type Openai = { modo: string; creditoUsd: number | null; creditoEm: string | null; gastoDesdeCreditoUsd: number; saldoEstimadoUsd: number | null; limiarUsd: number; limiarConfiguradoUsd: number | null; mediaDiariaUsd: number; atualizadoEm: string | null };
type Provedores = {
  openai: Openai;
  elevenlabs: { status: 'disponivel' | 'indisponivel'; usado: number | null; limite: number | null; percentual: number | null; verificadoEm: string; motivo: string | null; renovaEm: string | null };
  erros: Array<{ provedor: string; consecutivos: number; ultimoStatus: number | null; atualizadoEm: string | null; limite: number }>;
};

const mesAtual = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
const usd4 = (v: number | null) => (v === null ? '—' : v < 1 ? `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : usd(v));
const filtroQs = (f: 'mes' | '30dias') => (f === 'mes' ? `mes=${mesAtual()}` : 'periodo=30dias');
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function ConsumoPage() {
  const [filtro, setFiltro] = useState<'mes' | '30dias'>('mes');
  const [sel, setSel] = useState<number | null>(null);
  const [erroCsv, setErroCsv] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['plataforma', 'consumo', filtro], queryFn: () => api<Consumo>('GET', `/plataforma/consumo?${filtroQs(filtro)}`) });
  const d = q.data;
  const empresaId = sel ?? d?.empresas[0]?.empresaId ?? null;
  const serie = useMemo(() => (d && empresaId !== null ? d.dias.filter(x => x.empresaId === empresaId).sort((a, b) => a.dia.localeCompare(b.dia)).map(x => ({ dia: x.dia, totalUsd: x.totalUsd })) : []), [d, empresaId]);
  const empSel = d?.empresas.find(e => e.empresaId === empresaId);

  const baixar = async () => {
    setErroCsv(null);
    try {
      const res = await fetch(appUrl(`/api/plataforma/consumo.csv?${filtroQs(filtro)}`), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Não foi possível gerar o arquivo.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `consumo-${filtro === 'mes' ? mesAtual() : '30dias'}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErroCsv(errorMessage(e)); }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Consumo por empresa</h1>
          <p className="text-sm text-muted-foreground">Gasto de cada empresa e situação do crédito dos provedores. Valores em dólar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Período" className="inline-flex rounded border border-border overflow-hidden text-sm">
            {([['mes', 'Mês'], ['30dias', 'Últimos 30 dias']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={filtro === v} onClick={() => setFiltro(v)} data-testid={`filtro-${v}`} className={`h-9 px-3 ${filtro === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/50'}`}>{l}</button>
            ))}
          </div>
          <button type="button" onClick={baixar} data-testid="button-exportar-csv" className="inline-flex items-center gap-2 h-9 px-3 rounded border border-border bg-card text-sm hover:bg-muted/50"><Download className="h-4 w-4" aria-hidden />Exportar CSV</button>
        </div>
      </header>
      {erroCsv && <p className="text-sm text-destructive" role="alert">{erroCsv}</p>}

      <ProvedoresSecao />

      <section className="space-y-4" aria-label="Consumo por empresa">
        {q.isLoading && <div className="skel h-40" />}
        {q.isError && <p className="text-sm">Não foi possível carregar o consumo. <button className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>}
        {d && (
          <>
            <p className="text-sm text-muted-foreground num">{d.periodo.rotulo} · {d.periodo.inicio} a {d.periodo.fim}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card label="Consumo no período" value={usd(d.totais.totalUsd)} hint={`${d.totais.perguntas.toLocaleString('pt-BR')} perguntas · ${d.totais.usuariosAtivos} usuários ativos`} />
              <Card label="Por pergunta" value={usd4(d.totais.custoPorPerguntaUsd)} hint="média no período" />
              <Card label="Por usuário ativo" value={usd(d.totais.custoPorUsuarioUsd ?? 0).replace(/^US\$ 0,00$/, d.totais.custoPorUsuarioUsd === null ? '—' : 'US$ 0,00')} hint="média no período" />
              <Card label="Projeção do mês (estimativa)" value={d.totais.projecaoUsd === null ? '—' : usd(d.totais.projecaoUsd)} hint={d.periodo.mes ? `estimativa pelo ritmo de ${d.periodo.diasDecorridos} de ${d.periodo.diasMes} dias` : 'disponível apenas no mês atual'} />
            </div>
            <div className="rounded border border-border bg-card p-4 space-y-3">
              <h2 className="display text-lg">Totais por categoria</h2>
              <div className="grid gap-3 sm:grid-cols-4 text-sm num">
                {([['Texto (respostas)', d.totais.textoUsd], ['Voz', d.totais.vozUsd], ['Transcrição', d.totais.transcricaoUsd], ['Outros', d.totais.outrosUsd]] as const).map(([l, v]) => (
                  <div key={l}><div className="text-xs text-muted-foreground">{l}</div><div className="display text-xl">{usd(v)}</div>
                    <div className="h-1.5 mt-1 bg-muted rounded overflow-hidden" aria-hidden><div className="h-full bg-primary" style={{ width: `${d.totais.totalUsd ? Math.min(100, (v / d.totais.totalUsd) * 100) : 0}%` }} /></div></div>
                ))}
              </div>
            </div>
            <div className="rounded border border-border bg-card p-4 space-y-2" data-testid="consumo-plataforma">
              <h2 className="display text-lg">Teto da plataforma</h2>
              <p className="text-sm num">Hoje: {usd(d.plataforma.gastoHojeUsd)} de {usd(d.plataforma.tetoDiarioUsd)}{d.plataforma.percentualHoje !== null ? ` (${d.plataforma.percentualHoje.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}</p>
              <p className="text-xs text-muted-foreground">A plataforma tem somente teto diário. O consumo do mês não é comparado com ele.</p>
            </div>

            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground bg-muted/40"><tr>
                  <th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Texto</th><th className="px-3 py-2 text-right">Voz</th><th className="px-3 py-2 text-right">Transcrição</th><th className="px-3 py-2 text-right">Outros</th><th className="px-3 py-2 text-right">Perguntas</th><th className="px-3 py-2 text-right">Por pergunta</th><th className="px-3 py-2 text-right">Projeção (estimativa)</th><th className="px-3 py-2">Teto mensal</th>
                </tr></thead>
                <tbody className="num">
                  {d.empresas.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Nenhum consumo registrado neste período.</td></tr>}
                  {d.empresas.map(e => (
                    <tr key={e.empresaId} className={`border-t border-border cursor-pointer ${e.empresaId === empresaId ? 'bg-muted/40' : 'hover:bg-muted/20'}`} onClick={() => setSel(e.empresaId)} data-testid={`consumo-empresa-${e.empresaId}`}>
                      <td className="px-3 py-2">{e.empresa}{!e.ativa && <span className="text-xs text-muted-foreground"> · desativada</span>}</td>
                      <td className="px-3 py-2 text-right">{usd(e.totalUsd)}</td><td className="px-3 py-2 text-right">{usd(e.textoUsd)}</td><td className="px-3 py-2 text-right">{usd(e.vozUsd)}</td><td className="px-3 py-2 text-right">{usd(e.transcricaoUsd)}</td><td className="px-3 py-2 text-right">{usd(e.outrosUsd)}</td>
                      <td className="px-3 py-2 text-right">{e.perguntas.toLocaleString('pt-BR')}</td><td className="px-3 py-2 text-right">{usd4(e.custoPorPerguntaUsd)}</td>
                      <td className="px-3 py-2 text-right">{e.projecaoUsd === null ? '—' : usd(e.projecaoUsd)}</td>
                      <td className="px-3 py-2">{e.tetoMensalUsd === null ? <span className="text-muted-foreground">sem teto</span> : <>{usd(e.tetoMensalUsd)} {e.percentualTeto !== null && <StatusPill tone={e.percentualTeto >= 100 ? 'bad' : e.percentualTeto >= 80 ? 'warn' : 'ok'}>{e.percentualTeto.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</StatusPill>}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-border bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="display text-lg">Consumo diário{empSel ? ` · ${empSel.empresa}` : ''}</h2>
                <label className="text-sm">Empresa
                  <select value={empresaId ?? ''} onChange={e => setSel(Number(e.target.value))} data-testid="select-empresa-consumo" className="ml-2 h-9 px-2 rounded border border-input bg-card">
                    {d.empresas.map(e => <option key={e.empresaId} value={e.empresaId}>{e.empresa}</option>)}
                  </select>
                </label>
              </div>
              {serie.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">Sem consumo registrado para esta empresa no período.</p> : (
                <div className="h-64" data-testid="grafico-consumo-diario">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={serie} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="dia" tickFormatter={diaCurto} tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tickFormatter={(v: number) => `$${v}`} width={48} tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(v: number) => [usd(v), 'Consumo']} labelFormatter={(l: string) => diaCurto(l)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                      <Area type="linear" dataKey="totalUsd" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            {d.nota && <p className="text-xs text-muted-foreground">{d.nota}</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="display text-2xl mt-1 num">{value}</div>{hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}</div>;
}

function ProvedoresSecao() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plataforma', 'provedores'], queryFn: () => api<Provedores>('GET', '/plataforma/provedores'), refetchInterval: 120_000 });
  const [credito, setCredito] = useState('');
  const [em, setEm] = useState(() => toLocalInput(new Date()));
  const [limiar, setLimiar] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: { creditoUsd: number; creditoEm: string; limiarUsd: number | null }) => api<Openai>('PUT', '/plataforma/provedores/openai', v),
    onSuccess: o => { qc.setQueryData<Provedores>(['plataforma', 'provedores'], old => (old ? { ...old, openai: o } : old)); qc.invalidateQueries({ queryKey: ['plataforma', 'provedores'] }); setCredito(''); setMsg('Crédito atualizado.'); },
    onError: () => setMsg(null),
  });
  const num = (s: string) => Number(s.replace(',', '.'));
  const valido = credito.trim() !== '' && num(credito) >= 0 && num(credito) <= 10_000_000 && Number.isFinite(num(credito)) && Number.isFinite(Date.parse(em)) && (limiar.trim() === '' || (num(limiar) >= 0 && num(limiar) <= 10_000_000 && Number.isFinite(num(limiar))));
  const enviar = (e: FormEvent) => {
    e.preventDefault(); if (!valido) return; setMsg(null);
    m.mutate({ creditoUsd: num(credito), creditoEm: new Date(em).toISOString(), limiarUsd: limiar.trim() === '' ? null : num(limiar) });
  };
  const p = q.data; const o = p?.openai; const el = p?.elevenlabs;
  const baixo = o && o.saldoEstimadoUsd !== null && o.saldoEstimadoUsd < o.limiarUsd;
  return (
    <section className="space-y-3" aria-labelledby="prov">
      <h2 id="prov" className="display text-xl">Crédito dos provedores</h2>
      {q.isLoading && <div className="skel h-32" />}
      {q.isError && <p className="text-sm">Não foi possível carregar os provedores. <button className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>}
      {p && o && el && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border border-border bg-card p-4 space-y-3" data-testid="provedor-openai">
            <div className="flex items-center justify-between gap-2"><h3 className="font-medium">OpenAI</h3><StatusPill tone={o.saldoEstimadoUsd === null ? 'muted' : baixo ? 'bad' : 'ok'}>{o.saldoEstimadoUsd === null ? 'sem referência' : baixo ? 'crédito baixo' : 'crédito ok'}</StatusPill></div>
            <div className="display text-2xl num">{o.saldoEstimadoUsd === null ? '—' : usd(o.saldoEstimadoUsd)} <span className="text-sm font-normal text-muted-foreground">saldo estimado</span></div>
            <p className="text-xs text-muted-foreground num">
              {o.creditoUsd !== null ? `Referência: ${usd(o.creditoUsd)} em ${quando(o.creditoEm)}. ` : 'Nenhum crédito informado ainda. '}
              Gasto desde então: {usd(o.gastoDesdeCreditoUsd)} · média diária {usd(o.mediaDiariaUsd)} · alerta abaixo de {usd(o.limiarUsd)}{o.limiarConfiguradoUsd === null ? ' (automático)' : ''}.
            </p>
            <p className="text-xs text-muted-foreground">Este saldo é uma estimativa calculada pelo Tato, não o saldo informado pela API da OpenAI. A razão pode diferir da fatura. O custo do modo priority já está incluído.</p>
            <form onSubmit={enviar} className="space-y-3 border-t border-border pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm block">Crédito disponível (US$)
                  <input inputMode="decimal" value={credito} onChange={e => setCredito(e.target.value)} placeholder="ex.: 48,50" data-testid="input-credito" className="mt-1 w-full h-9 px-2 rounded border border-input bg-background num" />
                </label>
                <label className="text-sm block">Na data e hora
                  <input type="datetime-local" value={em} onChange={e => setEm(e.target.value)} data-testid="input-credito-em" className="mt-1 w-full h-9 px-2 rounded border border-input bg-background" />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">Informe quanto crédito havia na data indicada. Isso substitui a referência anterior, não soma recargas.</p>
              <label className="text-sm block">Limite de alerta (US$, opcional)
                <input inputMode="decimal" value={limiar} onChange={e => setLimiar(e.target.value)} placeholder="vazio = automático" data-testid="input-limiar" className="mt-1 w-full h-9 px-2 rounded border border-input bg-background num" />
              </label>
              <p className="text-xs text-muted-foreground">Vazio usa o automático: o maior entre o consumo médio de 7 dias e US$ 10.</p>
              {m.isError && <p className="text-sm text-destructive" role="alert">{errorMessage(m.error)}</p>}
              {msg && <p className="text-sm text-chart-4" role="status">{msg}</p>}
              <button type="submit" disabled={!valido || m.isPending} data-testid="button-atualizei-credito" className="h-10 px-4 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50">{m.isPending ? 'Salvando…' : 'Atualizei o crédito'}</button>
            </form>
          </div>
          <div className="space-y-4">
            <div className="rounded border border-border bg-card p-4 space-y-2" data-testid="provedor-elevenlabs">
              <div className="flex items-center justify-between gap-2"><h3 className="font-medium">ElevenLabs (voz)</h3><StatusPill tone={el.status === 'disponivel' ? ((el.percentual ?? 0) >= 95 ? 'bad' : (el.percentual ?? 0) >= 80 ? 'warn' : 'ok') : 'muted'}>{el.status === 'disponivel' ? 'disponível' : 'indisponível'}</StatusPill></div>
              {el.status === 'disponivel' && el.usado !== null && el.limite !== null ? (
                <>
                  <div className="display text-2xl num">{el.usado.toLocaleString('pt-BR')} <span className="text-sm font-normal text-muted-foreground">de {el.limite.toLocaleString('pt-BR')} caracteres{el.percentual !== null ? ` (${el.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}</span></div>
                  <div className="h-1.5 bg-muted rounded overflow-hidden" aria-hidden><div className="h-full bg-primary" style={{ width: `${Math.min(100, el.percentual ?? 0)}%` }} /></div>
                </>
              ) : <p className="text-sm text-muted-foreground">{el.motivo ?? 'Não foi possível consultar a cota agora.'}</p>}
              <p className="text-xs text-muted-foreground">Verificado {quando(el.verificadoEm)}{el.renovaEm ? ` · renova ${quando(el.renovaEm)}` : ''}</p>
            </div>
            <div className="rounded border border-border bg-card p-4 space-y-2" data-testid="provedor-erros">
              <h3 className="font-medium">Falhas consecutivas</h3>
              {p.erros.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma falha registrada.</p> : (
                <ul className="text-sm divide-y divide-border">
                  {p.erros.map(e => (
                    <li key={e.provedor} className="py-1.5 flex flex-wrap items-center gap-x-3"><span className="capitalize">{e.provedor}</span>
                      <StatusPill tone={e.consecutivos >= e.limite ? 'bad' : e.consecutivos > 0 ? 'warn' : 'ok'}>{e.consecutivos} de {e.limite}</StatusPill>
                      <span className="text-xs text-muted-foreground ml-auto num">{e.ultimoStatus !== null ? `status ${e.ultimoStatus} · ` : ''}{quando(e.atualizadoEm)}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
