import type { MetricResult } from "@workspace/api-zod";
import { dateBr, monthLabel } from "./periods";

/** A fact is a value computed by SQL/TypeScript, with its screen and spoken forms. The model never produces these. */
export type Fact = {
  id: string;
  label: string;
  kind: "money" | "percent" | "period" | "date" | "name" | "count" | "text";
  value: number | string | null;
  display: string;
  spoken: string;
  /** Key used in apresentado[]; qualified by period so the same fact of another period is new information. */
  key: string;
};

const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function below1000(n: number): string {
  if (n === 100) return "cem";
  const parts: string[] = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (rest < 20) { if (rest || !h) parts.push(UNITS[rest]!); }
  else { parts.push(TENS[Math.floor(rest / 10)]! + (rest % 10 ? ` e ${UNITS[rest % 10]}` : "")); }
  return parts.join(" e ");
}
/** Integer to Brazilian Portuguese words (0 to 999 billion). */
export function numberToWordsPt(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n < 1000) return below1000(n);
  const scales: Array<[number, string, string]> = [[1_000_000_000, "bilhão", "bilhões"], [1_000_000, "milhão", "milhões"], [1000, "mil", "mil"]];
  const chunks: string[] = [];
  let rest = n;
  for (const [size, singular, plural] of scales) {
    const q = Math.floor(rest / size);
    if (!q) continue;
    rest %= size;
    chunks.push(size === 1000 ? (q === 1 ? "mil" : `${below1000(q)} mil`) : `${below1000(q)} ${q === 1 ? singular : plural}`);
  }
  if (rest) chunks.push(below1000(rest));
  // "e" joins the last chunk when it is below 100 or a round hundred.
  const last = chunks.pop()!;
  const joiner = rest && (rest < 100 || rest % 100 === 0) ? " e " : (chunks.length ? ", " : "");
  return chunks.length ? `${chunks.join(", ")}${joiner}${last}` : last;
}
export function spokenReais(value: number): string {
  const sign = value < 0 ? "menos " : "";
  const abs = Math.abs(value);
  const reais = Math.floor(abs + 1e-9);
  const cents = Math.round((abs - reais) * 100);
  const parts: string[] = [];
  if (reais || !cents) parts.push(`${numberToWordsPt(reais)} ${reais === 1 ? "real" : "reais"}`);
  if (cents) parts.push(`${numberToWordsPt(cents)} ${cents === 1 ? "centavo" : "centavos"}`);
  return sign + parts.join(" e ");
}
export function spokenPercent(value: number): string {
  const abs = Math.abs(value);
  const whole = Math.floor(abs + 1e-9);
  const decimals = Math.round((abs - whole) * 100);
  const decimalText = decimals ? ` vírgula ${decimals < 10 ? `zero ${numberToWordsPt(decimals)}` : numberToWordsPt(decimals)}` : "";
  return `${numberToWordsPt(whole)}${decimalText} por cento`;
}
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function spokenDate(iso: string): string {
  const day = Number(iso.slice(8, 10)), month = Number(iso.slice(5, 7)), year = Number(iso.slice(0, 4));
  return `${day === 1 ? "primeiro" : numberToWordsPt(day)} de ${MONTHS[month - 1]} de ${numberToWordsPt(year)}`;
}
export const spokenMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${numberToWordsPt(Number(month.slice(0, 4)))}`;
export const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
export const numberBr = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const lastDay = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
export function periodForms(startDate: string, endDate: string): { display: string; spoken: string } {
  const wholeMonths = startDate.endsWith("-01") && Number(endDate.slice(8)) === lastDay(endDate);
  if (wholeMonths && startDate.slice(0, 7) === endDate.slice(0, 7)) return { display: monthLabel(startDate.slice(0, 7)), spoken: spokenMonth(startDate.slice(0, 7)) };
  if (wholeMonths && startDate.slice(0, 4) === endDate.slice(0, 4)) {
    return { display: `${MONTHS[Number(startDate.slice(5, 7)) - 1]} a ${monthLabel(endDate.slice(0, 7))}`, spoken: `${MONTHS[Number(startDate.slice(5, 7)) - 1]} a ${spokenMonth(endDate.slice(0, 7))}` };
  }
  if (startDate === endDate) return { display: dateBr(startDate), spoken: spokenDate(startDate) };
  return { display: `${dateBr(startDate)} a ${dateBr(endDate)}`, spoken: `${spokenDate(startDate)} a ${spokenDate(endDate)}` };
}

export const periodKey = (result: MetricResult) => result.period.referenceDate ? `ref:${result.period.referenceDate}` : `${result.period.startDate}..${result.period.endDate}`;
/** Stable prefix per result so several consultations in one turn keep labelled, non-colliding ids. */
export const factPrefix = (result: MetricResult) => `${result.metric === "contas_a_receber_vencidas" ? "recebiveis" : result.metric === "produtos_mais_vendidos" ? "produtos" : "faturamento"}_${result.period.referenceDate ?? result.period.startDate!.slice(0, 7)}`;

export function metricFacts(result: MetricResult, prefix = ""): Fact[] {
  const p = prefix ? `${prefix}.` : "";
  const scope = periodKey(result);
  const facts: Fact[] = [];
  const add = (id: string, label: string, kind: Fact["kind"], value: Fact["value"], display: string, spoken = display) =>
    facts.push({ id: p + id, label, kind, value, display, spoken, key: `${result.metric}:${id}@${scope}` });
  const money = (id: string, label: string, value: number) => add(id, label, "money", value, brl(value), spokenReais(value));
  const name = (id: string, label: string, value: string) => add(id, label, "name", value, value, value);

  if (result.period.referenceDate) add("data_referencia", "Data de referência", "date", result.period.referenceDate, dateBr(result.period.referenceDate), spokenDate(result.period.referenceDate));
  else { const forms = periodForms(result.period.startDate!, result.period.endDate!); add("periodo", "Período consultado", "period", `${result.period.startDate}..${result.period.endDate}`, forms.display, forms.spoken); }

  if (result.metric === "faturamento") {
    money("total", "Faturamento líquido do período", result.value);
    if (result.rawResult.filtro) name("filtro", `Filtro por ${String(result.rawResult.agrupamento ?? "nome")}`, String(result.rawResult.filtro));
    const comparison = result.comparisons[0];
    if (comparison && typeof result.rawResult.periodoAnterior === "object" && result.rawResult.periodoAnterior) {
      const prev = result.rawResult.periodoAnterior as { startDate: string; endDate: string };
      const forms = periodForms(prev.startDate, prev.endDate);
      add("comparacao.periodo", "Período anterior equivalente", "period", `${prev.startDate}..${prev.endDate}`, forms.display, forms.spoken);
      money("comparacao.valor", "Faturamento do período anterior", comparison.value);
      if (comparison.variationPct != null) {
        add("comparacao.variacao", "Variação sobre o período anterior", "percent", comparison.variationPct, `${numberBr(Math.abs(comparison.variationPct))}%`, spokenPercent(comparison.variationPct));
        add("comparacao.direcao", "Direção da variação (acima/abaixo)", "text", comparison.variationPct >= 0 ? "acima" : "abaixo", comparison.variationPct >= 0 ? "acima" : "abaixo");
        add("comparacao.movimento", "Movimento da variação (crescimento/queda)", "text", comparison.variationPct >= 0 ? "crescimento" : "queda", comparison.variationPct >= 0 ? "crescimento" : "queda");
      } else add("comparacao.sem_base", "Base da comparação", "text", null, "não há base não nula para calcular a variação percentual");
    }
    const sameDay = result.comparisons[1];
    if (sameDay && typeof result.rawResult.mesmoDiaSemanaAnterior === "number") {
      money("mesmo_dia.valor", sameDay.label, sameDay.value);
      if (sameDay.variationPct != null) add("mesmo_dia.variacao", "Variação sobre o mesmo dia da semana anterior", "percent", sameDay.variationPct, `${numberBr(Math.abs(sameDay.variationPct))}%`, spokenPercent(sameDay.variationPct));
    }
    const monthly = result.rawResult.monthly as Array<{ month: string; amount: number }> | undefined;
    if (monthly && monthly.length > 1) {
      add("meses.quantidade", "Quantidade de meses no período", "count", monthly.length, String(monthly.length), numberToWordsPt(monthly.length));
      monthly.forEach(m => { add(`mes.${m.month}.nome`, "Mês", "period", m.month, monthLabel(m.month), spokenMonth(m.month)); money(`mes.${m.month}.valor`, `Faturamento de ${monthLabel(m.month)}`, m.amount); });
      const first = monthly[0]!, last = monthly.at(-1)!;
      if (first.amount) {
        const trend = Math.round((last.amount - first.amount) / first.amount * 10000) / 100;
        add("meses.variacao_ponta_a_ponta", `Variação de ${monthLabel(first.month)} para ${monthLabel(last.month)}`, "percent", trend, `${numberBr(Math.abs(trend))}%`, spokenPercent(trend));
        add("meses.direcao", "Direção entre o primeiro e o último mês (acima/abaixo)", "text", trend >= 0 ? "acima" : "abaixo", trend >= 0 ? "acima" : "abaixo");
        add("meses.movimento", "Movimento entre o primeiro e o último mês (crescimento/queda)", "text", trend >= 0 ? "crescimento" : "queda", trend >= 0 ? "crescimento" : "queda");
      }
    }
    const groups = result.rawResult.groups as Array<{ subject: string; amount: number }> | undefined;
    if (groups) {
      const grouping = String(result.rawResult.agrupamento);
      add("agrupamento", "Agrupamento", "text", grouping, grouping === "mes" ? "mês" : grouping);
      add("grupos.quantidade", "Quantidade de grupos", "count", Number(result.rawResult.groupCount ?? groups.length), String(result.rawResult.groupCount ?? groups.length), numberToWordsPt(Number(result.rawResult.groupCount ?? groups.length)));
      groups.forEach((g, i) => {
        if (grouping === "mes") add(`grupo.${i + 1}.nome`, "Mês", "period", g.subject, monthLabel(g.subject), spokenMonth(g.subject));
        else name(`grupo.${i + 1}.nome`, `${grouping} na posição ${i + 1}`, g.subject);
        money(`grupo.${i + 1}.valor`, `Valor do ${grouping} na posição ${i + 1}`, g.amount);
      });
      if (groups[0] && result.value > 0 && grouping !== "mes") {
        const share = Math.round(groups[0].amount / result.value * 10000) / 100;
        add("concentracao.lider", `Participação do primeiro ${grouping} no total`, "percent", share, `${numberBr(share)}%`, spokenPercent(share));
      }
    } else {
      const clients = result.details;
      clients.forEach((c, i) => { name(`cliente.${i + 1}.nome`, `Cliente na posição ${i + 1}`, c.subject); money(`cliente.${i + 1}.valor`, `Faturamento do cliente na posição ${i + 1}`, c.amount); });
      if (clients[0] && result.value > 0) {
        const share = Math.round(clients[0].amount / result.value * 10000) / 100;
        add("concentracao.cliente", "Participação do maior cliente no total", "percent", share, `${numberBr(share)}%`, spokenPercent(share));
      }
    }
  }
  if (result.metric === "produtos_mais_vendidos") {
    add("limite", "Quantidade de produtos pedida", "count", Number(result.rawResult.limite ?? result.details.length), String(result.rawResult.limite ?? result.details.length), numberToWordsPt(Number(result.rawResult.limite ?? result.details.length)));
    if (typeof result.rawResult.totalPeriodo === "number") money("total_periodo", "Faturamento líquido total do período", result.rawResult.totalPeriodo);
    result.details.forEach((d, i) => {
      name(`produto.${i + 1}.nome`, `Produto na posição ${i + 1}`, d.subject);
      money(`produto.${i + 1}.valor`, `Valor vendido do produto na posição ${i + 1}`, d.amount);
      if (d.quantity != null) add(`produto.${i + 1}.quantidade`, `Unidades do produto na posição ${i + 1}`, "count", d.quantity, numberBr(d.quantity), `${numberToWordsPt(d.quantity)} unidades`);
    });
    if (result.details[0] && typeof result.rawResult.totalPeriodo === "number" && result.rawResult.totalPeriodo > 0) {
      const share = Math.round(result.details[0].amount / result.rawResult.totalPeriodo * 10000) / 100;
      add("concentracao.lider", "Participação do produto líder no total", "percent", share, `${numberBr(share)}%`, spokenPercent(share));
    }
  }
  if (result.metric === "contas_a_receber_vencidas") {
    money("total", "Total vencido sem baixa", result.value);
    const count = Number(result.rawResult.quantidade ?? 0);
    add("titulos.quantidade", "Quantidade de títulos vencidos", "count", count, String(count), `${numberToWordsPt(count)} ${count === 1 ? "título" : "títulos"}`);
    const debtors = result.details.filter(d => !d.bucket);
    debtors.forEach((d, i) => {
      name(`devedor.${i + 1}.nome`, `Devedor na posição ${i + 1}`, d.subject);
      money(`devedor.${i + 1}.valor`, `Valor vencido do devedor na posição ${i + 1}`, d.amount);
      if (d.daysPastDue != null) add(`devedor.${i + 1}.dias`, `Maior atraso do devedor na posição ${i + 1}`, "count", d.daysPastDue, `${d.daysPastDue} dias`, `${numberToWordsPt(d.daysPastDue)} dias`);
    });
    if (debtors[0] && result.value > 0) {
      const share = Math.round(debtors[0].amount / result.value * 10000) / 100;
      add("concentracao.devedor", "Participação do maior devedor no total vencido", "percent", share, `${numberBr(share)}%`, spokenPercent(share));
    }
    for (const bucket of result.details.filter(d => d.bucket)) {
      const id = `atraso.${bucket.bucket!.replace(/\s+/g, "_").replace("mais_de_", "acima_")}`;
      money(`${id}.valor`, `Vencido com atraso de ${bucket.bucket} dias`, bucket.amount);
      add(`${id}.faixa`, "Faixa de atraso", "text", bucket.bucket, `${bucket.bucket} dias`);
      if (result.value > 0) {
        const share = Math.round(bucket.amount / result.value * 10000) / 100;
        add(`${id}.participacao`, `Participação da faixa ${bucket.bucket} dias`, "percent", share, `${numberBr(share)}%`, spokenPercent(share));
      }
    }
  }
  return facts;
}

/** Explicit "compare A with B": the two totals and a code-computed variation, never a model estimate. */
export function requestedComparisonFacts(current: { prefix: string; result: MetricResult }, base: { prefix: string; result: MetricResult }): Fact[] {
  const variation = base.result.value === 0 ? null : Math.round((current.result.value - base.result.value) / base.result.value * 10000) / 100;
  const key = `comparacao_pedida@${periodKey(current.result)}~${periodKey(base.result)}`;
  const facts: Fact[] = [];
  if (variation == null) facts.push({ id: "comparacao_pedida.sem_base", label: "Base da comparação pedida", kind: "text", value: null, display: "não há base não nula para calcular a variação percentual", spoken: "não há base não nula para calcular a variação percentual", key });
  else {
    facts.push({ id: "comparacao_pedida.variacao", label: `Variação de ${base.prefix} para ${current.prefix}`, kind: "percent", value: variation, display: `${numberBr(Math.abs(variation))}%`, spoken: spokenPercent(variation), key });
    facts.push({ id: "comparacao_pedida.direcao", label: "Direção da comparação pedida (acima/abaixo)", kind: "text", value: variation >= 0 ? "acima" : "abaixo", display: variation >= 0 ? "acima" : "abaixo", spoken: variation >= 0 ? "acima" : "abaixo", key });
    facts.push({ id: "comparacao_pedida.movimento", label: "Movimento da comparação pedida (crescimento/queda)", kind: "text", value: variation >= 0 ? "crescimento" : "queda", display: variation >= 0 ? "crescimento" : "queda", spoken: variation >= 0 ? "crescimento" : "queda", key });
  }
  return facts;
}
export const findFact = (facts: Fact[], id: string) => facts.find(f => f.id === id);
