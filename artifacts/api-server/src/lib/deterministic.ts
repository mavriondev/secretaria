import type { Fact } from "./facts";
import type { Presentation, ToolResult } from "./relevance";
import { validateComposition } from "./validate-text";

export type Rendered = { display: string; spoken: string; usedIds: string[] };
const SPOKEN_LIST_LIMIT = 3;

function render(template: string, facts: Fact[]): Rendered {
  const validated = validateComposition(template, facts, "");
  if (!validated.ok) throw new Error(`Texto determinístico inválido: ${validated.reason}`);
  return validated;
}
const has = (facts: Fact[], id: string) => facts.some(f => f.id === id);

/** Short deterministic headline: only what was asked. Comparison appears only when explicitly requested. */
export function deterministicHeadline(results: ToolResult[], facts: Fact[], presentation: Presentation, requestedComparison: Fact[] = []): Rendered {
  const parts: string[] = [];
  const revenue = results.filter(r => r.result.metric === "faturamento" && !r.result.rawResult.groups);
  const explicitPair = presentation === "comparar" && revenue.length === 2 && requestedComparison.length;
  for (const { prefix, result } of results) {
    const p = prefix ? `${prefix}.` : "";
    if (result.metric === "faturamento") {
      parts.push(presentation === "conciso" ? `O faturamento líquido de {{${p}periodo}} foi {{${p}total}}.` : `Em {{${p}periodo}}, o faturamento líquido foi {{${p}total}}.`);
      if (has(facts, `${p}filtro`)) parts.push(`Filtro por nome exato: {{${p}filtro}}.`);
      if (presentation === "comparar" && !explicitPair && has(facts, `${p}comparacao.valor`)) {
        parts.push(has(facts, `${p}comparacao.variacao`)
          ? `{{${p}comparacao.base_nome}}, {{${p}comparacao.periodo}}, foi {{${p}comparacao.valor}}; o resultado atual ficou {{${p}comparacao.variacao}} {{${p}comparacao.direcao}}.`
          : has(facts, `${p}comparacao.sem_base`) && result.rawResult.baseTemDados === false
            ? `{{${p}comparacao.base_nome}}, {{${p}comparacao.periodo}}, {{${p}comparacao.sem_base}}.`
            : `{{${p}comparacao.base_nome}}, {{${p}comparacao.periodo}}, foi {{${p}comparacao.valor}}; {{${p}comparacao.sem_base}}.`);
      }
    } else if (result.metric === "produtos_mais_vendidos") {
      // The headline states the real size of the ranking: "os 5 produtos mais vendidos, de 12 com vendas"; a single existing product is said as such.
      const total = typeof result.rawResult.totalProdutos === "number" ? result.rawResult.totalProdutos : result.details.length;
      parts.push(!result.details.length ? `Em {{${p}periodo}}, nenhum produto teve vendas.`
        : total === 1 ? `Em {{${p}periodo}}, só um produto teve vendas:`
        : total > result.details.length && has(facts, `${p}produtos.total`) ? `Em {{${p}periodo}}, os {{${p}produtos.exibidos}} produtos mais vendidos por valor líquido, de {{${p}produtos.total}} com vendas no período:`
        : `Em {{${p}periodo}}, o ranking por valor líquido dos {{${p}produtos.exibidos}} produtos com vendas no período:`);
    } else {
      parts.push(`O total vencido sem baixa antes de {{${p}data_referencia}} é {{${p}total}}, em {{${p}titulos.quantidade}}.`);
    }
  }
  if (explicitPair) {
    const [a, b] = revenue as [ToolResult, ToolResult];
    parts.push(has(requestedComparison, "comparacao_pedida.variacao")
      ? `{{${a.prefix}.periodo}} ficou {{comparacao_pedida.variacao}} {{comparacao_pedida.direcao}} de {{${b.prefix}.periodo}}.`
      : `Entre {{${a.prefix}.periodo}} e {{${b.prefix}.periodo}}, {{comparacao_pedida.sem_base}}.`);
  }
  return render(parts.join(" "), [...facts, ...requestedComparison]);
}

/** Structured lists for the screen; the spoken form keeps the first items only, never cutting inside a fact. */
export function deterministicLists(results: ToolResult[], facts: Fact[], presentation: Presentation): Rendered {
  const display: string[] = [], spoken: string[] = [], usedIds: string[] = [];
  const list = (title: string, ids: Array<[string, string | null]>, spokenTitle = title) => {
    if (!ids.length) return;
    const rows = ids.map(([nameId, valueId]) => valueId ? `{{${nameId}}}: {{${valueId}}}` : `{{${nameId}}}`);
    const screen = render(`${title}\n${rows.join("\n")}`, facts);
    const voice = render(`${spokenTitle} ${rows.slice(0, SPOKEN_LIST_LIMIT).join("; ")}.${rows.length > SPOKEN_LIST_LIMIT ? " O detalhamento completo está na tela." : ""}`, facts);
    display.push(screen.display); spoken.push(voice.spoken); usedIds.push(...screen.usedIds);
  };
  for (const { prefix, result } of results) {
    const p = prefix ? `${prefix}.` : "";
    const ids = (pattern: RegExp) => facts.filter(f => pattern.test(f.id)).map(f => f.id);
    if (result.metric === "faturamento") {
      if (presentation === "conciso" && !result.rawResult.groups) continue;
      const groups = ids(new RegExp(`^${escape(p)}grupo\\.\\d+\\.nome$`));
      if (groups.length) {
        const label = facts.find(f => f.id === `${p}agrupamento`)?.display ?? "grupo";
        list(`Por ${label}:`, groups.map(id => [id, id.replace(/\.nome$/, ".valor")]), `Por ${label}:`);
        if (result.rawResult.truncated) {
          const plural: Record<string, string> = { cliente: "clientes", produto: "produtos", vendedor: "vendedores" };
          const r = render(`Os {{${p}grupos.exibidos}} principais de {{${p}grupos.quantidade}} ${plural[label] ?? "grupos"} no período; o total considera todos.`, facts); display.push(r.display); spoken.push(r.spoken);
        }
      } else if (!groups.length && result.rawResult.groups) {
        const empty = result.rawResult.filtro ? "Não encontrei vendas com esse nome exato no período." : "Não há vendas registradas nesse período.";
        display.push(empty); spoken.push(empty);
      } else {
        const months = ids(new RegExp(`^${escape(p)}mes\\.\\d{4}-\\d{2}\\.nome$`));
        if (months.length > 1 && presentation !== "conciso") list("Por mês, dentro desse intervalo:", months.map(id => [id, id.replace(/\.nome$/, ".valor")]), "Por mês:");
      }
    }
    if (result.metric === "produtos_mais_vendidos") {
      const products = ids(new RegExp(`^${escape(p)}produto\\.\\d+\\.nome$`));
      list("", products.map(id => [id, id.replace(/\.nome$/, ".valor")]));
    }
    if (result.metric === "contas_a_receber_vencidas" && presentation !== "conciso") {
      const debtors = ids(new RegExp(`^${escape(p)}devedor\\.\\d+\\.nome$`));
      list("Maiores devedores:", debtors.map(id => [id, id.replace(/\.nome$/, ".valor")]));
      const buckets = ids(new RegExp(`^${escape(p)}atraso\\.[^.]+\\.faixa$`));
      const screen = render(`Por faixa de atraso:\n${buckets.map(id => `{{${id}}}: {{${id.replace(/\.faixa$/, ".valor")}}}`).join("\n")}`, facts);
      if (buckets.length) { display.push(screen.display); usedIds.push(...screen.usedIds); }
    }
  }
  return { display: display.join("\n\n"), spoken: spoken.join(" "), usedIds: [...new Set(usedIds)] };
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
