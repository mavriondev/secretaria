import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/auth-client';
import { fmtDateTime } from '@/lib/format';

type Estado = 'em_dia' | 'atencao' | 'desatualizado' | 'sem_dados';
type Idade = { idadeHoras: number | null; estado: Estado };
type Saude = {
  estado: Estado; mensagem: string; demonstracao: boolean; intervaloMin: number | null; ultimaCargaOkEm?: string | null;
  tabelas: Array<Idade & { nome: string; carregadoEm: string | null }>;
  visoes: Array<Idade & { nome: string; assunto: string; maisRecenteEm: string | null }>;
  cargas: Array<{ id: number; modo: string; disparo: string; status: string; ok: boolean | null; erro: string | null; iniciadaEm: string; concluidaEm: string | null }>;
};
const LABEL: Record<Estado, string> = { em_dia: 'Em dia', atencao: 'Atenção', desatualizado: 'Desatualizado', sem_dados: 'Sem dados' };
const TONE: Record<Estado, string> = { em_dia: 'border-chart-4 text-foreground', atencao: 'border-chart-3 text-foreground', desatualizado: 'border-destructive text-destructive', sem_dados: 'border-border text-muted-foreground' };
const age = (h: number | null) => h === null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.round(h / 24)} dias`;
const Badge = ({ estado }: { estado: Estado }) => <span className={`text-xs px-2 py-0.5 rounded border ${TONE[estado]}`}>{LABEL[estado]}</span>;
const every = (min: number | null) => min === null ? 'Cargas só quando alguém pede.' : min % 60 === 0 ? `Carga automática a cada ${min / 60} h.` : `Carga automática a cada ${min} min.`;

/** How recent the data behind the answers is. A manager's answer always states the data age; this page shows the same age before anyone asks. */
export default function SaudePage() {
  const q = useQuery({ queryKey: ['saude'], queryFn: () => api<Saude>('GET', '/saude'), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="display text-3xl">Saúde dos dados</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">Mostra quão recentes são os dados que embasam as respostas. Dados velhos geram respostas corretas, mas sobre um passado que já mudou.</p>
      </header>
      {q.isLoading && <div className="skel h-32" />}
      {q.isError && <p className="text-sm">{errorMessage(q.error)} <button className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>}
      {d && <>
        <section className={`border rounded p-4 space-y-1 ${TONE[d.estado]}`} data-testid="saude-geral" role="status">
          <div className="flex items-center gap-3"><Badge estado={d.estado} /><span className="text-sm">{d.mensagem}</span></div>
          {!d.demonstracao && <p className="text-xs text-muted-foreground">{every(d.intervaloMin)}{d.ultimaCargaOkEm ? ` Última carga bem-sucedida: ${fmtDateTime(d.ultimaCargaOkEm)}.` : ''}</p>}
        </section>
        {d.visoes.length > 0 && <section className="space-y-2"><h2 className="display text-xl">O que as respostas enxergam</h2>
          <p className="text-xs text-muted-foreground">Data do registro mais recente de cada consulta liberada ao assistente.</p>
          <ul className="divide-y divide-border border border-border rounded">{d.visoes.map(v => (
            <li key={v.nome} className="p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{v.nome}</span><span className="text-xs text-muted-foreground capitalize">{v.assunto}</span>
              <span className="ml-auto num text-muted-foreground">{v.maisRecenteEm ? `${fmtDateTime(v.maisRecenteEm)} · há ${age(v.idadeHoras)}` : 'sem data de atualização'}</span>
              {!d.demonstracao && <Badge estado={v.estado} />}
            </li>))}</ul></section>}
        {d.tabelas.length > 0 && <section className="space-y-2"><h2 className="display text-xl">Cópia dos dados do ERP</h2>
          <ul className="divide-y divide-border border border-border rounded">{d.tabelas.map(t => (
            <li key={t.nome} className="p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium num">{t.nome}</span>
              <span className="ml-auto num text-muted-foreground">{t.carregadoEm ? `carregada ${fmtDateTime(t.carregadoEm)} · há ${age(t.idadeHoras)}` : '—'}</span><Badge estado={t.estado} />
            </li>))}</ul></section>}
        {d.cargas.length > 0 && <section className="space-y-2"><h2 className="display text-xl">Últimas cargas</h2>
          <ul className="divide-y divide-border border border-border rounded">{d.cargas.map(c => (
            <li key={c.id} className="p-3 text-sm space-y-1">
              <div className="flex flex-wrap gap-x-4 num"><span>{fmtDateTime(c.iniciadaEm)}</span><span>{c.modo === 'completa' ? 'completa' : 'incremental'}</span><span className="text-muted-foreground">{c.disparo === 'agendada' ? 'agendada' : 'manual'}</span>
                <span className={c.ok === false ? 'text-destructive' : c.ok ? '' : 'text-muted-foreground'}>{c.status === 'executando' ? 'em andamento' : c.ok ? 'concluída' : 'falhou'}</span></div>
              {c.erro && <p className="text-xs text-destructive">{c.erro}</p>}
            </li>))}</ul></section>}
      </>}
    </div>
  );
}
