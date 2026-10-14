/**
 * Answer adjustments of the general audit (A-14, A-15) and the priority tier (Part A): relative periods, ranking size,
 * quantities with units, Markdown-free text, public-origin marker, per-tier pricing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MetricResult } from "@workspace/api-zod";
import { resolvePeriod } from "../lib/periods";
import { limiteDoRanking, RANKING_MINIMO } from "../lib/assistant";
import { metricFacts } from "../lib/facts";
import { deterministicHeadline, deterministicLists } from "../lib/deterministic";
import { validateComposition } from "../lib/validate-text";
import { limparMarkdown, limparMarkdownParaFala } from "../lib/markdown";
import { MARCA_FONTE_PUBLICA, publicAnswerWithOrigin } from "../lib/origem-publica";
import { custoTexto, CustoDoTurno, fatorPrioridade } from "../lib/limite-custo";
import { serviceTier, textCallOptions, tierUsed } from "../lib/openai-direct";
import { periodoDeclarado } from "../lib/free-turn";
import { conciseSpeech } from "../lib/voice-delivery";
import { receivablesResult, revenueResult, toolResult } from "./fixtures";

const WED = new Date("2026-10-14T15:00:00-03:00");

test("A-14.1 'últimos N dias' and 'ano passado' resolve from today without asking, dates stated in the label", () => {
  const thirty = resolvePeriod({ preset: "last_days", days: 30 }, WED);
  assert.equal(thirty.startDate, "2026-09-15"); assert.equal(thirty.endDate, "2026-10-14");
  assert.match(thirty.label, /^Últimos 30 dias — 15\/09\/2026 a 14\/10\/2026$/);
  assert.equal(thirty.comparisonMonths, undefined, "a day window compares with the previous window of the same length, not with months");
  const seven = resolvePeriod({ preset: "last_days", days: 7 }, WED);
  assert.equal(seven.startDate, "2026-10-08", "seven days ending today, today included");
  const lastYear = resolvePeriod({ preset: "last_year" }, WED);
  assert.deepEqual([lastYear.startDate, lastYear.endDate, lastYear.comparisonMonths], ["2025-01-01", "2025-12-31", 12]);
  assert.throws(() => resolvePeriod({ preset: "last_days" }, WED), /dias/);
  assert.throws(() => resolvePeriod({ preset: "last_days", days: 0 }, WED), /dias/);
});

test("A-14.1 free path: a declared period is kept only when it is a valid, ordered pair of dates", () => {
  assert.deepEqual(periodoDeclarado({ inicio: "2026-10-05", fim: "2026-10-11" }), { inicio: "2026-10-05", fim: "2026-10-11" });
  assert.equal(periodoDeclarado(null), null);
  assert.equal(periodoDeclarado(undefined), null);
  assert.equal(periodoDeclarado({ inicio: "2026-10-11", fim: "2026-10-05" }), null, "inverted dates are ignored");
  assert.equal(periodoDeclarado({ inicio: "ontem", fim: "hoje" }), null, "only AAAA-MM-DD");
});

test("A-14.2 a ranking asked without a number shows at least five; an explicit number is respected", () => {
  assert.equal(limiteDoRanking(1, "Qual foi o produto mais vendido em setembro?"), RANKING_MINIMO);
  assert.equal(limiteDoRanking(1, "Qual cliente comprou mais no mês passado?"), RANKING_MINIMO);
  assert.equal(limiteDoRanking(3, "Quais os 3 maiores clientes?"), 3);
  assert.equal(limiteDoRanking(3, "Quais os três maiores clientes?"), 3);
  assert.equal(limiteDoRanking(2, "Os dois produtos que mais venderam"), 2);
  assert.equal(limiteDoRanking(1, "Me dá uma ideia de qual vendedor vendeu mais"), RANKING_MINIMO, "'uma' is an article, not a request for one line");
  assert.equal(limiteDoRanking(10, "Top 10 produtos"), 10);
});

function productsResult(shown: number, total: number): MetricResult {
  const details = Array.from({ length: shown }, (_, i) => ({ subject: `Produto ${i + 1}`, amount: 1000 - i * 100, quantity: 50 - i, daysPastDue: null, bucket: null }));
  return {
    metric: "produtos_mais_vendidos", value: details[0]?.amount ?? 0,
    period: { label: "Setembro de 2026", startDate: "2026-09-01", endDate: "2026-09-30", referenceDate: null },
    filters: [], lastUpdatedAt: "2026-10-09T21:18:14.991Z", comparisons: [], details,
    rawResult: { valorLider: details[0]?.amount ?? 0, totalPeriodo: 5000, periodo: { startDate: "2026-09-01", endDate: "2026-09-30" }, limite: shown, ranking: details, totalProdutos: total, truncated: total > shown },
  };
}

test("A-14.2 the products headline says 'the N leading of M' and never one item of many", () => {
  const partial = toolResult(productsResult(5, 14));
  const facts = metricFacts(partial.result, "");
  assert.ok(facts.some(f => f.id === "produtos.total" && f.display === "14"));
  assert.ok(facts.some(f => f.id === "produto.1.quantidade" && f.display === "50 unidades"), "quantities carry their unit on screen");
  const headline = deterministicHeadline([partial], facts, "normal");
  assert.match(headline.display, /os 5 produtos mais vendidos por valor líquido, de 14 com vendas no período:/);
  assert.match(headline.spoken, /os cinco produtos mais vendidos/);
  const all = toolResult(productsResult(3, 3));
  assert.match(deterministicHeadline([all], metricFacts(all.result, ""), "normal").display, /ranking por valor líquido dos 3 produtos com vendas no período:/);
  const single = toolResult(productsResult(1, 1));
  assert.match(deterministicHeadline([single], metricFacts(single.result, ""), "normal").display, /só um produto teve vendas:/);
});

test("A-14.2 grouped sales say 'the N leading of M <group>' instead of 'showing M groups'", () => {
  const grouped = revenueResult();
  grouped.rawResult = { ...grouped.rawResult, agrupamento: "vendedor", groupCount: 12, truncated: true, groups: Array.from({ length: 5 }, (_, i) => ({ subject: `Vendedor ${i + 1}`, amount: 1000 - i })) };
  const facts = metricFacts(grouped, "");
  const lists = deterministicLists([toolResult(grouped)], facts, "normal");
  assert.match(lists.display, /Os 5 principais de 12 vendedores no período; o total considera todos\./);
  assert.doesNotMatch(lists.display, /Mostrando/);
});

test("A-14.3 counts come with their noun on screen and in speech; a bare count ending a sentence is rejected", () => {
  const receivables = toolResult(receivablesResult());
  const facts = metricFacts(receivables.result, "");
  const headline = deterministicHeadline([receivables], facts, "normal");
  assert.match(headline.display, /, em 9 títulos\.$/);
  assert.match(headline.spoken, /em nove títulos\./);
  const bare = [{ id: "x.quantidade", label: "Quantidade", kind: "count" as const, value: 810, display: "810", spoken: "oitocentos e dez", key: "k" }];
  const rejected = validateComposition("O total está em {{x.quantidade}}.", bare, "");
  assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(rejected.reason, /sem unidade/);
  assert.equal(validateComposition("São {{x.quantidade}} títulos vencidos.", bare, "").ok, true);
  assert.equal(validateComposition("Títulos vencidos: {{x.quantidade}}.", bare, "").ok, true, "a label with a colon keeps the noun");
});

test("A-14.4 Markdown from any origin is removed for the screen and for the voice", () => {
  const raw = "Até **14 de outubro de 2026**, o IPCA foi de **0,82%**.\n\n### Fontes\n- [IPCA no IBGE](https://www.ibge.gov.br/ipca)\n* Outro item\n\nVeja https://exemplo.gov.br/x `codigo`";
  const screen = limparMarkdown(raw);
  assert.doesNotMatch(screen, /\*\*|###|\[|\]\(|`/);
  assert.match(screen, /Até 14 de outubro de 2026, o IPCA foi de 0,82%\./);
  assert.match(screen, /- IPCA no IBGE\n- Outro item/, "list lines stay readable on screen");
  assert.match(screen, /https:\/\/exemplo\.gov\.br\/x/, "URLs stay on screen");
  const voice = limparMarkdownParaFala(raw);
  assert.doesNotMatch(voice, /https?:|\*|#|\n|^- /);
  assert.match(voice, /IPCA no IBGE Outro item/);
  assert.equal(limparMarkdown("Valor líquido de R$ 2.347.973,25 (12 * 3)"), "Valor líquido de R$ 2.347.973,25 (12 * 3)", "a lone asterisk is not emphasis");
  assert.doesNotMatch(conciseSpeech("**Selic** em 15% — veja https://bcb.gov.br"), /\*|https/);
});

test("A-15 public answers end with the fixed marker and the source name, added once", () => {
  const once = publicAnswerWithOrigin("A Selic está em 15% ao ano", [{ title: "Copom — BCB", url: "https://www.bcb.gov.br/controleinflacao/historicotaxasjuros" }]);
  assert.equal(once, `A Selic está em 15% ao ano. ${MARCA_FONTE_PUBLICA} — bcb.gov.br.`);
  assert.equal(publicAnswerWithOrigin(once, [{ title: "x", url: "https://x.gov.br" }]), once, "no duplication");
  assert.equal(publicAnswerWithOrigin("Cotação de hoje.", [], "Banco Central (PTAX)"), `Cotação de hoje. ${MARCA_FONTE_PUBLICA} — Banco Central (PTAX).`);
  assert.equal(publicAnswerWithOrigin("Sem fonte nomeada.", []), `Sem fonte nomeada. ${MARCA_FONTE_PUBLICA}.`);
});

test("Part A: priority tier is a per-call price factor read from the response, not from the request", () => {
  assert.equal(fatorPrioridade("priority"), 2); assert.equal(fatorPrioridade("fast"), 2, "the API names the priority tier 'fast' for the current model"); assert.equal(fatorPrioridade("default"), 1); assert.equal(fatorPrioridade(null), 1);
  assert.equal(custoTexto(1_000_000, 0, "priority"), custoTexto(1_000_000, 0) * 2);
  const turn = new CustoDoTurno();
  turn.somar(1000, 100, "priority"); turn.somar(1000, 100, "default"); turn.somar(500, 0, null);
  assert.equal(turn.tier, "default,priority");
  assert.ok(Math.abs(turn.usd - (custoTexto(1000, 100) * 3 + custoTexto(500, 0))) < 1e-12);
  assert.equal(tierUsed({ service_tier: "priority" }), "priority"); assert.equal(tierUsed({}), null);
  const previous = process.env.OPENAI_SERVICE_TIER;
  try {
    process.env.OPENAI_SERVICE_TIER = "priority"; assert.deepEqual(textCallOptions(), { service_tier: "priority" });
    process.env.OPENAI_SERVICE_TIER = "auto"; assert.equal(serviceTier(), "auto");
    delete process.env.OPENAI_SERVICE_TIER; assert.equal(serviceTier(), "auto", "unset means the standard tier");
  } finally { if (previous === undefined) delete process.env.OPENAI_SERVICE_TIER; else process.env.OPENAI_SERVICE_TIER = previous; }
});
