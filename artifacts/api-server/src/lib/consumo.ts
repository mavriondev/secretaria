/** Billing views use only the existing ledger. No provider or customer-database call. */
import { pool } from "@workspace/db";
import type { Pool } from "pg";
import { lerConfiguracao } from "./limite-custo";

const DAY = 86_400_000;
const brasil = (now: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const localDate = (date: string) => new Date(`${date}T00:00:00-03:00`);
export function periodoConsumo(input: { mes?: string; periodo?: "30dias" }, now = new Date()) {
  const today = brasil(now);
  if (input.periodo === "30dias") {
    const end = new Date(localDate(today).getTime() + DAY);
    return { inicio: new Date(end.getTime() - 30 * DAY).toISOString(), fim: end.toISOString(), rotulo: "Últimos 30 dias (incluindo hoje, Brasília)", mes: null, diasDecorridos: 30, diasMes: 30 };
  }
  const month = input.mes ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 2200) throw new Error("Informe um mês válido (AAAA-MM).");
  const [year, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const next = `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const elapsed = month === today.slice(0, 7) ? Number(today.slice(8)) : month < today.slice(0, 7) ? days : 0;
  return { inicio: localDate(`${month}-01`).toISOString(), fim: localDate(next).toISOString(), rotulo: `${month} (Brasília)`, mes: month, diasDecorridos: elapsed, diasMes: days };
}
export function resumoConsumo(total: number, questions: number, active: number, period: ReturnType<typeof periodoConsumo>) {
  return { custoPorPerguntaUsd: questions ? total / questions : null, custoPorUsuarioUsd: active ? total / active : null,
    projecaoUsd: period.mes && period.diasDecorridos > 0 ? total / period.diasDecorridos * period.diasMes : null };
}
export async function consumoPorEmpresa(input: { mes?: string; periodo?: "30dias" } = {}, now = new Date(), database: Pool = pool) {
  const period = periodoConsumo(input, now);
  // Ignore future-dated entries. The selected month keeps a full, explicit calendar boundary.
  const end = new Date(Math.min(new Date(period.fim).getTime(), now.getTime()));
  const { rows } = await database.query(`SELECT e.id, e.nome, e.ativa, e.limite_mensal_usd,
    coalesce(sum(c.custo_usd),0)::text AS total,
    coalesce(sum(c.custo_usd) FILTER (WHERE c.tipo IN ('texto','reescrita','implantacao')),0)::text AS texto,
    coalesce(sum(c.custo_usd) FILTER (WHERE c.tipo='voz'),0)::text AS voz,
    coalesce(sum(c.custo_usd) FILTER (WHERE c.tipo='transcricao'),0)::text AS transcricao,
    coalesce(sum(c.custo_usd) FILTER (WHERE c.tipo NOT IN ('texto','reescrita','implantacao','voz','transcricao')),0)::text AS outros,
    count(DISTINCT c.usuario_id)::int AS ativos
    FROM empresas e LEFT JOIN custos_ia c ON c.empresa_id=e.id AND c.criado_em >= $1 AND c.criado_em < $2
    GROUP BY e.id ORDER BY e.id`, [period.inicio, end]);
  const questions = await database.query("SELECT empresa_id,count(*)::int AS n FROM query_logs WHERE created_at >= $1 AND created_at < $2 GROUP BY empresa_id", [period.inicio, end]);
  const questionCounts = new Map(questions.rows.map(r => [Number(r.empresa_id), Number(r.n)]));
  const empresas = rows.map(r => {
    const total = Number(r.total), perguntas = questionCounts.get(Number(r.id)) ?? 0, ativos = Number(r.ativos), limit = r.limite_mensal_usd == null ? null : Number(r.limite_mensal_usd);
    return { empresaId: r.id as number, empresa: r.nome as string, ativa: r.ativa as boolean, totalUsd: total, textoUsd: Number(r.texto), vozUsd: Number(r.voz), transcricaoUsd: Number(r.transcricao), outrosUsd: Number(r.outros),
      perguntas, usuariosAtivos: ativos, ...resumoConsumo(total, perguntas, ativos, period), tetoMensalUsd: limit, percentualTeto: limit && period.mes ? total / limit * 100 : null };
  });
  const daily = await database.query(`SELECT (criado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia, empresa_id,
    sum(custo_usd)::text AS total FROM custos_ia WHERE criado_em >= $1 AND criado_em < $2 GROUP BY 1,2 ORDER BY 1,2`, [period.inicio, end]);
  const byDay = new Map(daily.rows.map(r => [`${r.dia}:${r.empresa_id}`, Number(r.total)]));
  const dias: Array<{ dia: string; empresaId: number; totalUsd: number }> = [];
  for (let at = new Date(period.inicio).getTime(); at < end.getTime(); at += DAY) {
    const dia = new Date(at).toISOString().slice(0, 10);
    for (const e of empresas) dias.push({ dia, empresaId: e.empresaId, totalUsd: byDay.get(`${dia}:${e.empresaId}`) ?? 0 });
  }
  const totals = empresas.reduce((a, e) => ({ totalUsd: a.totalUsd + e.totalUsd, textoUsd: a.textoUsd + e.textoUsd, vozUsd: a.vozUsd + e.vozUsd, transcricaoUsd: a.transcricaoUsd + e.transcricaoUsd, outrosUsd: a.outrosUsd + e.outrosUsd, perguntas: a.perguntas + e.perguntas, usuariosAtivos: a.usuariosAtivos + e.usuariosAtivos }), { totalUsd: 0, textoUsd: 0, vozUsd: 0, transcricaoUsd: 0, outrosUsd: 0, perguntas: 0, usuariosAtivos: 0 });
  // Platform users are globally unique, but counting separately makes no assumption about past company transfers.
  const active = await database.query("SELECT count(DISTINCT usuario_id)::int AS n FROM custos_ia WHERE criado_em >= $1 AND criado_em < $2", [period.inicio, end]);
  totals.usuariosAtivos = active.rows[0].n;
  const config = await lerConfiguracao();
  const budget = (await pool.query("SELECT coalesce(sum(custo_usd),0)::text AS n FROM custos_ia WHERE criado_em >= $1 AND criado_em <= $2", [localDate(brasil(now)), now])).rows[0];
  const limit = config.teto_diario_plataforma_usd;
  return { periodo: period, totais: { ...totals, ...resumoConsumo(totals.totalUsd, totals.perguntas, totals.usuariosAtivos, period) }, empresas,
    dias,
    plataforma: { tetoDiarioUsd: limit, gastoHojeUsd: Number(budget.n), percentualHoje: limit > 0 ? Number(budget.n) / limit * 100 : null },
    nota: "Valores registrados no razão de custos, incluindo o multiplicador do tier priority. Podem diferir da fatura dos provedores; a conferência é responsabilidade do dono. Perguntas: registros do histórico retido, incluindo respostas sem custo; usuários ativos: pessoas identificadas em chamadas pagas. Histórico já excluído pela retenção e chamadas sem usuário não podem ser reconstruídos nos denominadores, mas seus custos continuam no razão. Texto inclui reescrita e implantação. Projeção é estimativa por dias de calendário." };
}
export function csvConsumo(data: Awaited<ReturnType<typeof consumoPorEmpresa>>) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r\n]/.test(text) || /^\s+[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines: unknown[][] = [["empresa", "mes", "categoria", "US$", "perguntas", "usuarios ativos"]];
  for (const e of data.empresas) for (const [name, cost] of [["texto", e.textoUsd], ["voz", e.vozUsd], ["transcricao", e.transcricaoUsd], ["outros", e.outrosUsd]])
    lines.push([e.empresa, data.periodo.mes ?? "ultimos-30-dias", name, Number(cost).toFixed(8), e.perguntas, e.usuariosAtivos]);
  return "\uFEFF" + lines.map(row => row.map(cell).join(";")).join("\r\n");
}
