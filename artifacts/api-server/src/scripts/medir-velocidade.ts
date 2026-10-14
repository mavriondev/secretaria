import { mkdir, writeFile } from "node:fs/promises";

/**
 * Golden speed run: the same fixed questions, asked through the HTTP API of one installation, with the server-side
 * timings (`latencyMs` and `_metrics.etapas`) recorded per question. Used before and after a change to compare
 * speed AND answers (text, numbers, SQL, responseKind).
 *
 *   MEDIR_SENHA=... tsx src/scripts/medir-velocidade.ts --api https://host/tato/api --email gestor@teste.local --rotulo antes
 *
 * The account must be a manager (gestor) of the demonstration company. The password comes only from MEDIR_SENHA.
 * Output: generated-artifacts/velocidade/<rotulo>.json (answers included; no secrets).
 */
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : []).filter(p => p.length));
const api = (args.api ?? "").replace(/\/$/, "");
const email = args.email ?? "";
const senha = process.env.MEDIR_SENHA ?? "";
const rotulo = args.rotulo ?? new Date().toISOString().replace(/[:.]/g, "-");
if (!api || !email || !senha) { console.error("Uso: MEDIR_SENHA=... medir-velocidade --api <base> --email <gestor> [--rotulo antes]"); process.exit(1); }

/** The fixed set: shortcuts, free queries, public research, conversation/no-data, plus the four deviations of report 46. A `segue` item is a follow-up of the previous one. */
export const perguntas: Array<{ id: string; cenario: "atalho" | "livre" | "publica" | "conversa"; texto: string; segue?: boolean }> = [
  { id: "A1", cenario: "atalho", texto: "Qual foi o faturamento deste mês?" },
  { id: "A2", cenario: "atalho", texto: "Qual foi o faturamento nos últimos três meses?" },
  { id: "A3", cenario: "atalho", texto: "Quais foram os produtos mais vendidos este mês?" },
  { id: "A4", cenario: "atalho", texto: "Quanto temos de contas a receber vencidas hoje?" },
  { id: "A5", cenario: "atalho", texto: "Compare o faturamento deste mês com o mesmo período do ano passado." },
  { id: "A6", cenario: "atalho", texto: "E por vendedor?", segue: true },
  { id: "L1", cenario: "livre", texto: "Quantos clientes diferentes compraram em setembro de 2026?" },
  { id: "L2", cenario: "livre", texto: "Liste os cinco maiores clientes por valor comprado em setembro de 2026." },
  { id: "L3", cenario: "livre", texto: "Qual vendedor vendeu mais em agosto de 2026?" },
  { id: "P1", cenario: "publica", texto: "Qual a cotação do dólar hoje?" },
  { id: "P2", cenario: "publica", texto: "Qual é a taxa Selic atual?" },
  { id: "C1", cenario: "conversa", texto: "Qual foi o lucro líquido da empresa hoje?" },
  { id: "C2", cenario: "conversa", texto: "Bom dia, tudo bem?" },
  { id: "R1", cenario: "atalho", texto: "Qual foi o faturamento dos últimos 30 dias?" },
  { id: "R2", cenario: "atalho", texto: "Quais foram os 12 produtos mais vendidos em setembro de 2026?" },
  { id: "R3", cenario: "livre", texto: "Quantas unidades vendemos em setembro de 2026?" },
];

type Etapas = { roteamento: number; consultas: number; composicao: number; validacao: number; voz?: number };
type Resultado = {
  id: string; cenario: string; pergunta: string; ok: boolean; erro?: string;
  clienteMs: number; latencyMs: number; etapas: Etapas; antesDoRoteamentoMs: number; chamadas: number; cache?: number;
  inputTokens: number; outputTokens: number; custoUsd: number | null;
  responseKind: string; functionName: string | null; answer: string; sql: string[]; composicao: string; logId: number;
};

const cookies = new Map<string, string>();
const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (response: Response) => {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";"); const [k, v] = pair!.split("=");
    if (k && v !== undefined) cookies.set(k.trim(), v.trim());
  }
};
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init.headers ?? {}) } });
  keep(response);
  return response;
}
async function entrar() {
  const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, senha, manter: false }) });
  if (!login.ok) throw new Error(`Login recusado (${login.status}).`);
  const me = await login.json() as { role: string; trocarSenha?: boolean; companyId?: number | null };
  if (me.trocarSenha) {
    // First login of a temporary account: a new password is required; derive one so the run can proceed.
    const nova = `${senha}#Nova1`;
    const troca = await call("/auth/senha", { method: "POST", body: JSON.stringify({ senhaAtual: senha, novaSenha: nova }) });
    if (!troca.ok) throw new Error(`Troca de senha obrigatória falhou (${troca.status}).`);
  }
  return me;
}

async function main() {
  const me = await entrar();
  const resultados: Resultado[] = [];
  let anterior: number | undefined;
  for (const p of perguntas) {
    const inicio = Date.now();
    const body = { question: p.texto, freedomLevel: 1, includeVoice: false, ...(p.segue && anterior ? { referenceLogId: anterior } : {}) };
    let r: Resultado;
    try {
      const response = await call("/assistant/ask", { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      const clienteMs = Date.now() - inicio;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as Record<string, any>;
      const metrics = (data.parameters?._metrics ?? {}) as { etapas?: Etapas; chamadas?: number; composicao?: string; cache?: number };
      const etapas: Etapas = { roteamento: 0, consultas: 0, composicao: 0, validacao: 0, ...(metrics.etapas ?? {}) };
      const execs = (data.parameters?._executions ?? []) as Array<Record<string, unknown>>;
      r = {
        id: p.id, cenario: p.cenario, pergunta: p.texto, ok: true, clienteMs, latencyMs: data.latencyMs, etapas,
        antesDoRoteamentoMs: Math.max(0, data.latencyMs - etapas.roteamento - etapas.consultas - etapas.composicao - etapas.validacao - (etapas.voz ?? 0)),
        chamadas: metrics.chamadas ?? 0, ...(metrics.cache === undefined ? {} : { cache: metrics.cache }),
        inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0, custoUsd: null,
        responseKind: data.responseKind, functionName: data.functionName ?? null, answer: data.answer, sql: execs.map(e => e.sql).filter((s): s is string => typeof s === "string"),
        composicao: metrics.composicao ?? "", logId: data.id,
      };
      anterior = data.id;
    } catch (error) {
      r = { id: p.id, cenario: p.cenario, pergunta: p.texto, ok: false, erro: error instanceof Error ? error.message : "erro", clienteMs: Date.now() - inicio, latencyMs: 0,
        etapas: { roteamento: 0, consultas: 0, composicao: 0, validacao: 0 }, antesDoRoteamentoMs: 0, chamadas: 0, inputTokens: 0, outputTokens: 0, custoUsd: null,
        responseKind: "", functionName: null, answer: "", sql: [], composicao: "", logId: 0 };
    }
    resultados.push(r);
    console.log(`${r.id} ${r.ok ? `${r.latencyMs} ms (rot ${r.etapas.roteamento} / cons ${r.etapas.consultas} / comp ${r.etapas.composicao} / val ${r.etapas.validacao} / antes ${r.antesDoRoteamentoMs}) ${r.responseKind} tokens ${r.inputTokens}+${r.outputTokens}${r.cache === undefined ? "" : ` cache ${r.cache}`}` : `FALHOU ${r.erro}`}`);
  }
  const custos = await call("/uso?dias=1").then(r => r.ok ? r.json() : null).catch(() => null) as { resumo?: { custoTotalUsd?: number } } | null;
  const saida = new URL("../../../../generated-artifacts/velocidade/", import.meta.url);
  await mkdir(saida, { recursive: true });
  await writeFile(new URL(`${rotulo}.json`, saida), JSON.stringify({ rotulo, api: api.replace(/\/\/[^/]+/, "//<host>"), papel: me.role, data: new Date().toISOString(), resultados, usoHoje: custos?.resumo ?? null }, null, 2));
  const ok = resultados.filter(r => r.ok);
  const p = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]!) : 0; };
  for (const cenario of ["atalho", "livre", "publica", "conversa"]) {
    const xs = ok.filter(r => r.cenario === cenario);
    if (!xs.length) continue;
    console.log(`${cenario}: n=${xs.length} total p50=${p(xs.map(r => r.latencyMs), 0.5)} p95=${p(xs.map(r => r.latencyMs), 0.95)} | rot p50=${p(xs.map(r => r.etapas.roteamento), 0.5)} | cons p50=${p(xs.map(r => r.etapas.consultas), 0.5)} | comp p50=${p(xs.map(r => r.etapas.composicao), 0.5)} | antes p50=${p(xs.map(r => r.antesDoRoteamentoMs), 0.5)} | tokens in=${Math.round(xs.reduce((a, r) => a + r.inputTokens, 0) / xs.length)}`);
  }
  console.log(`Gravado em generated-artifacts/velocidade/${rotulo}.json`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "erro"); process.exit(1); });
