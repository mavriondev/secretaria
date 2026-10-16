/**
 * Guided clarification (Part C of the manual-send prompt): round state, the two-round ceiling, real options and the
 * adjustment buttons. The router is faked here; the paid scenarios live in generated-artifacts/p71/cenarios-c.mjs.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool, queryLogsTable } from "@workspace/db";
import { ensureDemoCompany } from "../lib/auth";
import { answerQuestion, type Router } from "../lib/assistant";
import { advanceState, emptyState, stateFrom } from "../lib/conversation-state";
import { ajustesPara, botoesDasOpcoes, contextoDeEsclarecimento, continuaPedido, pedidoCompleto, MAX_AJUSTES, MAX_OPCOES, MAX_RODADAS, mencionaAgrupamento, mencionaPeriodo, opcoesValidas, pendente, perguntaDeEntidade, registrarPergunta, rodadasEsgotadas } from "../lib/esclarecimento";
import { resolvePeriod } from "../lib/periods";
import { ClarificationNeeded, salesQuery } from "../lib/sales-query";

const ask = (q: string) => advanceState(emptyState(), { presented: [], executed: [], offered: null, refusedPending: false, perguntaAberta: q, esclarecimento: registrarPergunta(emptyState(), "me mostra as vendas", q, "periodo") });

test("rounds are counted per request, answers are kept per field and the pending request lives one turn", () => {
  const s1 = ask("Qual período: hoje, esta semana, este mês ou mês passado?");
  assert.equal(pendente(s1)?.rodadas, 1);
  assert.equal(continuaPedido(s1, "mês passado"), true, "a short reply continues the request");
  assert.equal(continuaPedido(s1, "Quais foram os produtos mais vendidos em setembro de 2026?"), false, "a long message is a new request");
  assert.equal(rodadasEsgotadas(s1, "mês passado"), false);
  const r2 = registrarPergunta(s1, "mês passado", "Agrupo por cliente ou por produto?", "metrica");
  assert.equal(r2.rodadas, 2); assert.equal(r2.pedido, "me mostra as vendas");
  assert.deepEqual(r2.respondido, { periodo: "mês passado" }, "the reply is stored under the field that was asked");
  const s2 = advanceState(s1, { presented: [], executed: [], offered: null, refusedPending: false, perguntaAberta: "Agrupo por cliente ou por produto?", esclarecimento: r2 });
  assert.equal(rodadasEsgotadas(s2, "tanto faz"), true, `the ${MAX_RODADAS}nd round is the last`);
  assert.match(contextoDeEsclarecimento(s2, "tanto faz")!, /Limite de 2 rodadas atingido/);
  assert.match(contextoDeEsclarecimento(s2, "tanto faz")!, /período = "mês passado"/);
  assert.equal(contextoDeEsclarecimento(s2, "Quanto temos de contas a receber vencidas hoje?"), null, "a subject change abandons the pending request");
  assert.equal(pedidoCompleto(s2, "o primeiro"), "me mostra as vendas mês passado o primeiro", "the hypothesis looks at everything the person said for this request");
  assert.equal(pedidoCompleto(s2, "Quanto temos de contas a receber vencidas hoje?"), "Quanto temos de contas a receber vencidas hoje?");
  const s3 = advanceState(s2, { presented: [], executed: [], offered: null, refusedPending: false });
  assert.equal(pendente(s3), null, "answered: nothing pending");
  assert.equal(registrarPergunta(s3, "me mostra as vendas", "Qual período?", "periodo").rodadas, 1, "a new request starts at round 1");
  assert.equal(stateFrom([{ parameters: { _state: s2 } }]).esclarecimento?.rodadas, 2, "the state survives the log round trip");
  assert.equal(stateFrom([{ parameters: { _state: { ...emptyState(), esclarecimento: undefined } } }]).esclarecimento, null, "older states without the field still parse");
});

test("options are real, capped and never include 'outro' as a button", () => {
  assert.deepEqual(opcoesValidas(["A", " A ", "", "outro", "B", "C", "D", "E", 7]), ["A", "B", "C", "D"]);
  assert.equal(opcoesValidas(["x"]).length, 1); assert.equal(MAX_OPCOES, 4);
  assert.deepEqual(botoesDasOpcoes(["Comercial Litoral 32", "Comercial Litoral 40"]), [{ rotulo: "Comercial Litoral 32", pergunta: "Comercial Litoral 32" }, { rotulo: "Comercial Litoral 40", pergunta: "Comercial Litoral 40" }]);
  const pergunta = perguntaDeEntidade("cliente", "Litoral", ["Comercial Litoral 32", "Comercial Litoral 40"], true, "01/10/2026 a 16/10/2026");
  assert.match(pergunta, /1\) Comercial Litoral 32, 2\) Comercial Litoral 40/); assert.match(pergunta, /Há outros/); assert.match(pergunta, /número ou o nome/);
});

test("the hypothesis is declared and the buttons follow what the person did not say, at most three", () => {
  assert.equal(mencionaPeriodo("Como está o faturamento?"), false);
  assert.equal(mencionaPeriodo("Faturamento de setembro de 2026"), true);
  assert.equal(mencionaPeriodo("Vendas dos últimos 7 dias"), true);
  assert.equal(mencionaAgrupamento("Qual cliente comprou mais?"), true);
  assert.equal(mencionaAgrupamento("Como está o faturamento?"), false);
  const semPeriodo = ajustesPara({ question: "Como está o faturamento?", tool: "faturamento", parameters: { periodo: "this_month" } });
  assert.equal(semPeriodo.hipotese, "Considerei este mês.");
  assert.deepEqual(semPeriodo.ajustes.map(a => a.rotulo), ["mês passado", "esta semana", "por cliente"]);
  assert.equal(semPeriodo.ajustes[0]!.pergunta, "Como está o faturamento — mês passado", "the button is a new question through the normal path");
  assert.ok(semPeriodo.ajustes.length <= MAX_AJUSTES);
  const completo = ajustesPara({ question: "Qual foi o faturamento de setembro de 2026?", tool: "faturamento", parameters: { periodo: "custom" } });
  assert.deepEqual(completo, { hipotese: null, ajustes: [] }, "nothing assumed, nothing to adjust: the answer stays as before");
  const ranking = ajustesPara({ question: "Quais foram os 12 produtos mais vendidos em setembro de 2026?", tool: "produtos_mais_vendidos", parameters: { periodo: "custom" } });
  assert.deepEqual(ranking, { hipotese: null, ajustes: [] });
  const receber = ajustesPara({ question: "Como estão as contas a receber?", tool: "contas_a_receber_vencidas", parameters: { data_referencia: "2026-10-16" } });
  assert.equal(receber.hipotese, "Considerei só os títulos vencidos.");
  assert.deepEqual(receber.ajustes.map(a => a.rotulo), ["a vencer", "por cliente"]);
  assert.equal(ajustesPara({ question: "Quanto temos de contas a receber vencidas hoje?", tool: "contas_a_receber_vencidas", parameters: {} }).hipotese, null);
  const nome = ajustesPara({ question: "Quanto vendemos para a Oliveira este mês?", tool: "consultar_vendas", parameters: { periodo: "this_month", agrupar: "mes", filtro_tipo: "cliente", filtro_nome: "Supermercado Oliveira" }, filtroInformado: "Oliveira", filtroUsado: "Supermercado Oliveira" });
  assert.equal(nome.hipotese, 'Entendi "Oliveira" como Supermercado Oliveira.');
  assert.deepEqual(nome.ajustes, [], "the period was said and the name has one match: nothing to adjust");
  // The router may carry a period from the conversation as explicit dates: the hypothesis names it and the buttons never repeat it.
  const setembro = ajustesPara({ question: "Como está o faturamento?", tool: "faturamento", parameters: { periodo: "custom", data_inicio: "2026-09-01", data_fim: "2026-09-30" } });
  const passado = rotuloDeMesPassadoSeForSetembro();
  assert.equal(setembro.hipotese, `Considerei ${passado || "setembro de 2026"}.`);
  assert.deepEqual(setembro.ajustes.map(a => a.rotulo), ["este mês", "mês passado", "esta semana"].filter(r => r !== passado).slice(0, 2).concat("por cliente"));
  const vendas = ajustesPara({ question: "Me mostra as vendas", tool: "consultar_vendas", parameters: { periodo: "this_month", agrupar: "cliente" } });
  assert.equal(vendas.hipotese, "Considerei este mês; agrupei por cliente.");
  assert.deepEqual(vendas.ajustes.map(a => a.rotulo), ["mês passado", "esta semana", "por produto"]);
});

// September 2026 is "mês passado" only while the test runs in October 2026; afterwards it is a plain custom period.
const rotuloDeMesPassadoSeForSetembro = () => resolvePeriod({ preset: "last_month" }).startDate === "2026-09-01" ? "mês passado" : "";
const logs: number[] = [];
before(async () => { await ensureDemoCompany(); });
after(async () => { if (logs.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logs)); await pool.end(); });
const periodo = resolvePeriod({ preset: "this_month" });

test("an ambiguous name lists real options ordered by sales; one match is used and declared; exhausted rounds take the best match", async () => {
  const opts = { agrupar: "mes" as const, filtro_tipo: "cliente" as const, filtro_nome: "Comercial Litoral", limite: 12 };
  const erro = await salesQuery(periodo, opts).then(() => null, (e: unknown) => e);
  assert.ok(erro instanceof ClarificationNeeded, "several clients match");
  assert.ok(erro.opcoes.length > 1 && erro.opcoes.length <= MAX_OPCOES, `up to ${MAX_OPCOES} options`);
  const { rows } = await pool.query("SELECT cliente, SUM(valor_liquido) AS total FROM vw_vendas_itens WHERE position('comercial litoral' in lower(cliente))>0 AND data BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 4", [periodo.startDate, periodo.endDate]);
  assert.deepEqual(erro.opcoes, rows.map(r => r.cliente), "options exist in the data, largest sales first, none empty in the period");
  assert.match(erro.message, /Qual deles\?/);
  const unico = await salesQuery(periodo, { ...opts, filtro_nome: "Oliveira" });
  assert.equal(unico.rawResult.filtro, "Supermercado Oliveira"); assert.equal(unico.rawResult.filtroInformado, "Oliveira");
  const hipotese = await salesQuery(periodo, opts, { hipotese: true });
  assert.equal(hipotese.rawResult.filtro, erro.opcoes[0], "rounds exhausted: the first option, never another question");
  const exato = await salesQuery(periodo, { ...opts, filtro_nome: "Supermercado Oliveira" });
  assert.equal(exato.rawResult.filtroInformado, undefined, "an exact name is not a hypothesis");
});

test("the router may ask at most two rounds: the third doubt is re-routed once with the ceiling instruction and executed", async () => {
  const pergunta = (texto: string, campo: string, opcoes: string[]) => ({ type: "function_call", name: "responder", arguments: JSON.stringify({ tipo: "clarification", texto, dominio: "sistema", campo, opcoes, apresentacao: "normal" }) });
  const reforcos: Array<string | null> = [];
  const router: Router = async reforco => {
    reforcos.push(reforco);
    if (reforco) return { output: [{ type: "function_call", name: "faturamento", arguments: JSON.stringify({ periodo: "this_month", meses: null, dias: null, data_inicio: null, data_fim: null, comparar_com: null, apresentacao: "normal" }) }], usage: { input_tokens: 10, output_tokens: 5 } };
    return { output: [pergunta("Qual período: hoje, esta semana, este mês ou mês passado?", "periodo", ["hoje", "esta semana", "este mês", "mês passado", "outro"])], usage: { input_tokens: 10, output_tokens: 5 } };
  };
  const base = { freedomLevel: 1 as const, includeVoice: false };
  const r1 = await answerQuestion({ ...base, question: "Me mostra as vendas" }, null, Date.now(), { router, composer: null });
  logs.push(r1.id);
  assert.equal(r1.responseKind, "clarification");
  assert.deepEqual(r1.ajustes?.map(a => a.rotulo), ["hoje", "esta semana", "este mês", "mês passado"], "the options become buttons; 'outro' is not one");
  const s1 = stateFrom([{ parameters: r1.parameters }]);
  assert.equal(pendente(s1)?.rodadas, 1);
  const ctx = (r: typeof r1) => [{ logId: r.id, question: r.question, answer: r.answer, functionName: r.functionName, parameters: r.parameters }];
  const r2 = await answerQuestion({ ...base, question: "tanto faz" }, null, Date.now(), { router, composer: null, context: ctx(r1) });
  logs.push(r2.id);
  assert.equal(r2.responseKind, "clarification", "a second round is still allowed (the fake router insists)");
  assert.equal(stateFrom([{ parameters: r2.parameters }]).esclarecimento?.rodadas, 2);
  assert.deepEqual(reforcos, [null, null]);
  const r3 = await answerQuestion({ ...base, question: "o primeiro" }, null, Date.now(), { router, composer: null, context: ctx(r2) });
  logs.push(r3.id);
  assert.equal(reforcos.length, 4, "third doubt: one more routing call carrying the ceiling instruction");
  assert.equal(reforcos[2], null); assert.match(reforcos[3]!, /proibido usar responder com tipo clarification/);
  assert.equal(r3.responseKind, "erp", "executed with the hypothesis instead of a third question");
  assert.equal(r3.hipotese, "Considerei este mês.");
  assert.deepEqual(r3.ajustes?.map(a => a.rotulo), ["mês passado", "esta semana", "por cliente"]);
  assert.equal((r3.parameters as { _metrics: { chamadas: number; esclarecimentoReforcado?: boolean } })._metrics.chamadas, 2, "both routing calls are counted and priced");
  assert.equal((r3.parameters as { _metrics: { esclarecimentoReforcado?: boolean } })._metrics.esclarecimentoReforcado, true);
  assert.equal(stateFrom([{ parameters: r3.parameters }]).esclarecimento, null, "the request is closed");
  const r4 = await answerQuestion({ ...base, question: "Qual foi o faturamento de setembro de 2026?" }, null, Date.now(), { router: async () => ({ output: [{ type: "function_call", name: "faturamento", arguments: JSON.stringify({ periodo: "custom", meses: null, dias: null, data_inicio: "2026-09-01", data_fim: "2026-09-30", comparar_com: null, apresentacao: "normal" }) }], usage: { input_tokens: 1, output_tokens: 1 } }), composer: null });
  logs.push(r4.id);
  assert.equal(r4.hipotese, null); assert.deepEqual(r4.ajustes, [], "an unambiguous question gets no hypothesis and no buttons");
});
