import { fmtDateTime } from '@/lib/format';

export type Teto = { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; padrao?: boolean };
export type Tetos = { mes: Teto; dia: Teto; plataforma: Teto; bloqueado: boolean; motivo: 'empresa_mes' | 'empresa_dia' | 'plataforma_dia' | null; mensagem: string | null };
export type PorTipo = { texto: number; voz: number; transcricao: number; reescrita: number; implantacao: number; total: number };
export type EventoTeto = { id: number; empresaId: number; escopo: string; periodo: string; nivel: number; usadoUsd: number; limiteUsd: number; criadoEm: string; empresa?: string; disparadoPorNome?: string | null };

export const usd = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
export const ESCOPO: Record<string, string> = { empresa_mes: 'limite do mês', empresa_dia: 'limite de hoje', plataforma_dia: 'limite de hoje da plataforma' };
const TIPOS: Array<[keyof PorTipo, string]> = [['texto', 'Respostas (modelo)'], ['voz', 'Voz'], ['transcricao', 'Transcrição'], ['reescrita', 'Favoritos ao vivo'], ['implantacao', 'Implantação']];

/** One ceiling as a bar: how much of it was spent, colour by state, and a plain sentence when 80 % or the limit is reached. */
export function TetoBar({ titulo, teto, pausa, testId }: { titulo: string; teto: Teto; pausa: string; testId?: string }) {
  if (teto.limiteUsd === null) return <p className="text-sm text-muted-foreground" data-testid={testId}>{titulo}: sem limite definido · já gastos {usd(teto.usadoUsd)}.</p>;
  const pct = Math.min(100, Math.round((teto.percentual ?? 0) * 100));
  const tone = teto.bloqueado ? 'bg-destructive' : teto.aviso ? 'bg-chart-4' : 'bg-primary';
  return (
    <div className="space-y-1.5" data-testid={testId} data-estado={teto.bloqueado ? 'bloqueado' : teto.aviso ? 'aviso' : 'ok'}>
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{titulo}{teto.padrao ? <span className="text-xs text-muted-foreground"> · padrão</span> : null}</span><span className="num">{usd(teto.usadoUsd)} de {usd(teto.limiteUsd)} ({pct}%)</span></div>
      <div className="h-2 bg-muted rounded overflow-hidden" role="progressbar" aria-label={titulo} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      {teto.bloqueado ? <p className="text-sm text-destructive">Limite atingido: {pausa}</p> : teto.aviso && <p className="text-sm">Atenção: mais de 80% deste limite já foi usado.</p>}
    </div>
  );
}

/** The three ceilings that pause the assistant (month, day, whole platform) in one card. */
export function TetosCard({ tetos, titulo = 'Limites de uso' }: { tetos: Tetos; titulo?: string }) {
  return (
    <section className="border border-border rounded p-4 space-y-4" aria-label={titulo} data-testid="limites-uso">
      <h2 className="display text-xl">{titulo}</h2>
      <TetoBar titulo="Hoje" teto={tetos.dia} pausa="as perguntas com IA voltam amanhã (favoritos e listas continuam)." testId="limite-diario" />
      <TetoBar titulo="Este mês" teto={tetos.mes} pausa="as perguntas com IA voltam quando o mês virar ou quando o limite for ampliado." testId="limite-mensal" />
      {tetos.plataforma.aviso && <TetoBar titulo="Plataforma hoje" teto={tetos.plataforma} pausa="o serviço inteiro atingiu o teto de hoje; volta amanhã." testId="limite-plataforma" />}
    </section>
  );
}

/** Spend split by kind of paid call, as proportional bars. */
export function PorTipoBars({ titulo, valores }: { titulo: string; valores: PorTipo }) {
  const max = Math.max(0.000001, ...TIPOS.map(([k]) => valores[k]));
  return (
    <section className="space-y-2" aria-label={titulo}>
      <div className="flex justify-between text-sm"><h3 className="font-medium">{titulo}</h3><span className="num">{usd(valores.total, 4)}</span></div>
      <ul className="space-y-1">{TIPOS.map(([k, label]) => (
        <li key={k} className="grid grid-cols-[9rem_1fr_6.5rem] items-center gap-3 text-sm">
          <span className="text-muted-foreground truncate">{label}</span>
          <span className="h-2.5 bg-muted rounded overflow-hidden" aria-hidden><span className="block h-full bg-primary/80" style={{ width: `${valores[k] > 0 ? Math.max(2, (valores[k] / max) * 100) : 0}%` }} /></span>
          <span className="text-right num">{usd(valores[k], 4)}</span>
        </li>))}</ul>
    </section>
  );
}

/** When a ceiling reached 80 % or was hit, one line each, newest first. */
export function EventosLista({ eventos, comEmpresa = false }: { eventos: EventoTeto[]; comEmpresa?: boolean }) {
  if (!eventos.length) return <p className="text-sm text-muted-foreground">Nenhum aviso ou bloqueio registrado.</p>;
  return (
    <ul className="divide-y divide-border border border-border rounded text-sm" data-testid="eventos-teto">{eventos.map(e => (
      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
        <span className={`inline-flex h-2 w-2 rounded-full ${e.nivel >= 100 ? 'bg-destructive' : 'bg-chart-4'}`} aria-hidden />
        <span className="font-medium">{e.nivel >= 100 ? 'Bloqueio' : 'Aviso de 80%'}</span>
        <span className="text-muted-foreground">{ESCOPO[e.escopo] ?? e.escopo}{comEmpresa && e.empresa ? ` · ${e.empresa}` : ''}{e.disparadoPorNome ? ` (última chamada: ${e.disparadoPorNome})` : ''}</span>
        <span className="num">{usd(e.usadoUsd)} de {usd(e.limiteUsd)}</span>
        <span className="ml-auto text-xs text-muted-foreground num">{fmtDateTime(e.criadoEm)}</span>
      </li>))}</ul>
  );
}
