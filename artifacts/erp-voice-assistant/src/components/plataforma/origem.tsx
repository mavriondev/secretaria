import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import { useResumo } from '@/lib/plataforma';

type Carga = { id: number; modo: string; disparo: string; status: string; ok: boolean | null; erro: string | null; iniciadaEm: string; concluidaEm: string | null; relatorio: { tabelas: Array<{ tabela: string; modo: string; lidas: number; ms: number; erro?: string }> } | null };
export type OrigemState = { conectada: boolean; tipo: string; tiposDisponiveis: string[]; assuntos: string[]; intervaloMin: number | null; assuntosDisponiveis: Record<string, string[]> | null; cargas: Carga[] };

type Receb = { ativa: boolean; recebimentos: Array<{ tabela: string; recebidoEm: string | null }> | null };
const ASSUNTO: Record<string, { rotulo: string; desc: string; perguntas: string[] }> = {
  vendas: { rotulo: 'Vendas', desc: 'Notas, itens vendidos, clientes, produtos e vendedores.', perguntas: ['Quanto vendemos este mês?', 'Quais os produtos mais vendidos?', 'Quem é o melhor vendedor?'] },
  financeiro: { rotulo: 'Contas a receber', desc: 'Títulos a receber, vencimentos e baixas.', perguntas: ['Quanto temos em aberto?', 'Quais clientes estão vencidos?', 'Quanto vence esta semana?'] },
};
const TABELA: Record<string, string> = { tgfcab: 'cabeçalho das notas', tgfite: 'itens das notas', tgftop: 'tipos de operação', tgftpv: 'tipos de negociação', tgfpar: 'parceiros (clientes e fornecedores)', tgfpro: 'produtos', tgfgru: 'grupos de produtos', tgfven: 'vendedores', tsiemp: 'empresas', tsicus: 'centros de resultado', tgffin: 'títulos financeiros', tgfnat: 'naturezas' };
const rotuloAssunto = (n: string) => ASSUNTO[n]?.rotulo ?? n;
const chip = 'inline-block text-[11px] rounded border px-1.5 py-0.5';
const KIND_LABEL: Record<string, string> = { postgres: 'PostgreSQL (o sistema lê)', recebida: 'Enviado pelo cliente (REST)' };

/** Where the company's ERP data comes from and the loads that fill its mirror. */
export function CompanyOrigin({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['plataforma', 'origem', company.id], queryFn: () => api<OrigemState>('GET', `/plataforma/empresas/${company.id}/origem`),
    refetchInterval: q => (q.state.data?.cargas[0]?.status === 'executando' ? 3000 : false) });
  const s = state.data;
  const [url, setUrl] = useState('');
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [interval, setIntervalMin] = useState<string | null>(null);
  const chosen = subjects ?? s?.assuntos ?? [];
  const every = interval ?? (s?.intervaloMin ? String(s.intervaloMin) : '');
  const resumo = useResumo(company.id);
  const ing = useQuery({ queryKey: ['plataforma', 'ingestao', company.id], enabled: s?.tipo === 'recebida', queryFn: () => api<Receb>('GET', `/plataforma/empresas/${company.id}/ingestao`) });
  const [aberto, setAberto] = useState<string[]>([]);
  const salvos = s?.assuntos ?? [];
  const mudou = !!s && (chosen.length !== salvos.length || chosen.some(x => !salvos.includes(x)));
  const recebidas = new Set((ing.data?.recebimentos ?? []).filter(r => r.recebidoEm).map(r => r.tabela.toLowerCase()));
  const lidas = new Map<string, { erro?: string; lidas: number; ms: number }>();
  for (const c of [...(s?.cargas ?? [])].reverse()) for (const x of c.relatorio?.tabelas ?? []) lidas.set(x.tabela.toLowerCase(), x);
  const refresh = () => qc.invalidateQueries({ queryKey: ['plataforma'] });
  const save = useMutation({
    mutationFn: () => api('PUT', `/plataforma/empresas/${company.id}/origem`, { ...(url.trim() ? { url: url.trim() } : {}), assuntos: chosen, intervaloMin: every ? Number(every) : null }),
    onSuccess: () => { setSaved(true); setUrl(''); setSubjects(null); setIntervalMin(null); refresh(); },
  });
  const load = useMutation({ mutationFn: (modo: 'incremental' | 'completa') => api('POST', `/plataforma/empresas/${company.id}/carga`, { modo }), onSuccess: refresh });
  const running = s?.cargas[0]?.status === 'executando';
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  return (
    <div className="border-t border-border pt-3 space-y-3">
      <h3 className="font-medium">Origem dos dados (ERP do cliente) e cargas</h3>
      <p className="text-xs text-muted-foreground">{s?.tipo === 'recebida' ? 'O cliente envia os dados dos assuntos selecionados por HTTPS; o Tato não acessa o banco do ERP.' : `O sistema lê, somente leitura, as tabelas dos assuntos escolhidos no banco do cliente e mantém uma cópia no banco da empresa. ${s?.conectada ? 'Origem cadastrada.' : 'Nenhuma origem cadastrada.'}`}</p>
      <p className="text-xs rounded border border-border bg-muted/40 p-2">Banco de origem é o do ERP do cliente, aqui só lido. O que é copiado vai para o espelho, o banco da empresa (aba Base de dados). A IA responde pelas views montadas sobre o espelho, nunca direto na origem.</p>
      {s && !s.assuntosDisponiveis && <p className="text-sm text-destructive">Ainda não existe pacote de tabelas para o ERP desta empresa ({company.erp}).</p>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="block">Modo de chegada dos dados
          <select disabled className={`${field} h-11`} value={s?.tipo ?? 'postgres'}>{(s?.tiposDisponiveis ?? ['postgres']).map(k => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>
          <span className="text-xs text-muted-foreground">Leitura direta disponível para PostgreSQL. Para outros bancos, o técnico pode extrair e enviar por REST. Gerar a chave na aba Recebimento muda para esse modo.</span>
        </label>
        {s?.tipo === 'recebida'
          ? <p className="text-sm text-muted-foreground">Os dados desta empresa são enviados pelo próprio cliente. A chave, os endereços e o kit de teste estão na aba Recebimento.</p>
          : <label className="block">Endereço de leitura (postgresql://…)
              <input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder={s?.conectada ? 'Deixe em branco para manter o atual' : ''} className={`${field} h-11`} />
            </label>}
        {s?.assuntosDisponiveis && (
          <fieldset className="space-y-2"><legend className="font-medium">Assuntos a copiar</legend>
            <p className="text-xs text-muted-foreground">Marque o que a IA deve poder responder. {mudou ? <strong className="text-foreground">Alteração ainda não salva: salve para valer.</strong> : 'A seleção abaixo é a que está salva.'}</p>
            <p className="text-xs rounded border border-border bg-muted/40 p-2" data-testid="text-verificacao-geral">Verificação geral da base: {resumo.data ? (resumo.data.dadosProntos ? 'liberada' : 'ainda não liberada') : '…'}. Ela vale para a base inteira; não comprova que cada assunto está completo nem correto.</p>
            {Object.entries(s.assuntosDisponiveis).map(([nome, tabelas]) => {
              const on = chosen.includes(nome); const salvo = salvos.includes(nome); const info = ASSUNTO[nome]; const open = aberto.includes(nome);
              const rec = tabelas.filter(x => recebidas.has(x.toLowerCase())).length;
              const rest = s.tipo === 'recebida';
              const comErro = tabelas.filter(x => lidas.get(x.toLowerCase())?.erro).length;
              const lidasOk = tabelas.filter(x => { const l = lidas.get(x.toLowerCase()); return l && !l.erro; }).length;
              return (
                <div key={nome} data-testid={`assunto-${nome}`} className={`rounded border p-3 space-y-2 ${on ? 'border-primary bg-card' : 'border-border'}`}>
                  <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" data-testid={`check-assunto-${nome}`} checked={on} onChange={e => { setSaved(false); setSubjects(e.target.checked ? [...chosen, nome] : chosen.filter(x => x !== nome)); }} />
                    <span className="flex-1"><span className="font-medium">{rotuloAssunto(nome)}</span>{' '}<span className="num text-[11px] text-muted-foreground">({nome})</span>
                      <span className="block text-xs text-muted-foreground">{info?.desc ?? `Reúne ${tabelas.length} tabelas do ERP.`}</span></span></label>
                  <div className="flex flex-wrap gap-1 pl-6">
                    <span className={`${chip} border-border text-muted-foreground`}>Disponível no pacote</span>
                    <span className={`${chip} ${on ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>{on ? (salvo ? 'Selecionado e salvo' : 'Selecionado, não salvo') : salvo ? 'Será removido ao salvar' : 'Não selecionado'}</span>
                    {salvo && (rest
                      ? <span className={`${chip} border-border`}>{rec === tabelas.length ? 'Registro completo: todas as tabelas recebidas (conteúdo não validado)' : `Recebido em ${rec} de ${tabelas.length} tabelas`}</span>
                      : <span className={`${chip} ${comErro ? 'border-destructive text-destructive' : 'border-border'}`}>{comErro ? `Carga com erro em ${comErro} tabela(s)` : lidasOk ? `Lidas em carga: ${lidasOk} de ${tabelas.length}` : 'Nenhuma carga ainda'}</span>)}
                  </div>
                  {info && <p className="pl-6 text-xs text-muted-foreground">Perguntas possíveis: {info.perguntas.map(q => `"${q}"`).join(' · ')}</p>}
                  <button type="button" className="ml-6 text-xs underline" aria-expanded={open} data-testid={`button-tabelas-${nome}`} onClick={() => setAberto(open ? aberto.filter(x => x !== nome) : [...aberto, nome])}>{open ? 'Ocultar' : 'Ver'} {tabelas.length} tabelas técnicas</button>
                  {open && <ul className="ml-6 text-xs space-y-0.5">{tabelas.map(x => { const l = lidas.get(x.toLowerCase()); return <li key={x}><span className="num">{x.toLowerCase()}</span> <span className="text-muted-foreground">{TABELA[x.toLowerCase()] ?? ''}{rest ? (recebidas.has(x.toLowerCase()) ? ' · recebida' : ' · não recebida') : l ? (l.erro ? '' : ` · ${l.lidas} linhas na última leitura`) : ''}</span>{l?.erro && <span className="text-destructive"> {l.erro}</span>}</li>; })}</ul>}
                </div>);
            })}
          </fieldset>
        )}
        <label className="block">{s?.tipo === 'recebida' ? 'Envio esperado a cada (minutos; o cliente agenda a rotina)' : 'Atualizar a cada (minutos; em branco = carga manual)'}
          <input type="number" min={5} max={10080} value={every} onChange={e => setIntervalMin(e.target.value)} className={`${field} h-11 max-w-40`} /></label>
        <div className="flex flex-wrap gap-2 items-center">
          <button disabled={save.isPending} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{save.isPending ? 'Testando e salvando…' : 'Salvar origem'}</button>
          {s?.conectada && s.tipo !== 'recebida' && <>
            <button type="button" disabled={running || load.isPending} onClick={() => load.mutate('incremental')} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">{running ? 'Carregando…' : 'Carregar agora (só o que mudou)'}</button>
            <button type="button" disabled={running || load.isPending} onClick={() => window.confirm('A carga completa refaz cada tabela inteira e pode demorar. Continuar?') && load.mutate('completa')} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">Carga completa</button></>}
        </div>
        {saved && !save.isPending && !mudou && <p role="status" data-testid="text-salvo" className="text-sm text-chart-4">Origem salva. Assuntos ativos: {salvos.map(rotuloAssunto).join(', ') || 'nenhum'}.</p>}
        {(save.isError || load.isError) && <p role="alert" className="text-destructive">{errorMessage(save.error ?? load.error)}</p>}
      </form>
      {!!s?.cargas.length && (
        <ul className="space-y-2" aria-label="Últimas cargas">{s.cargas.map(c => (
          <li key={c.id} className="text-xs border border-border rounded p-2">
            <p className="num"><span className={c.status === 'executando' ? '' : c.ok ? 'text-chart-4' : 'text-destructive'}>{c.status === 'executando' ? 'em andamento' : c.ok ? 'concluída' : 'com problema'}</span> · {c.modo === 'completa' ? 'completa' : 'incremental'} · {c.disparo} · {new Date(c.iniciadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            {c.erro && <p className="text-destructive">{c.erro}</p>}
            {c.relatorio?.tabelas.map(t => <p key={t.tabela} className={t.erro ? 'text-destructive' : 'text-muted-foreground'}>{t.tabela}: {t.erro ?? `${t.lidas} linhas em ${(t.ms / 1000).toFixed(1)} s`}</p>)}
          </li>))}</ul>
      )}
    </div>
  );
}
