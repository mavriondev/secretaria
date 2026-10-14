/**
 * Per-person pace limit on the routes that spend money (model, voice, transcription): a sliding window of one minute
 * kept in memory. It does not replace the ceilings; it only stops a loop or a stuck button from burning the day's budget in seconds.
 */
/** Under the Node test runner the limit is generous by default: the suite fires dozens of calls per minute from one fake user and nothing is paid; the pace test lowers it explicitly. */
const emTeste = Boolean(process.env.NODE_TEST_CONTEXT);
export const RITMO_POR_MINUTO = Math.max(1, Number(process.env.RITMO_POR_MINUTO ?? (emTeste ? 1000 : 20)));
let limiteAtual = RITMO_POR_MINUTO;
const JANELA_MS = 60_000;
const janelas = new Map<string, number[]>();

/** Routes that reach a paid provider; everything else (favourites, lists, inbox, settings) is never paced. */
const PAGAS: Array<[RegExp, string]> = [
  [/^POST \/assistant\/(ask|audio)$/, "texto"],
  [/^POST \/favoritos\/preparar$/, "texto"],
  [/^POST \/testes\/execucoes$/, "texto"],
  [/^POST \/plataforma\/empresas\/\d+\/implantacao\/analisar$/, "texto"],
];
export const categoriaPaga = (method: string, path: string): string | null => PAGAS.find(([rule]) => rule.test(`${method.toUpperCase()} ${path}`))?.[1] ?? null;

/** True when the call may proceed; false when the person already made the allowed number of calls in the last minute. */
export function permitirRitmo(userId: number, categoria: string, now = Date.now(), limite = limiteAtual): boolean {
  const chave = `${userId}:${categoria}`;
  const recentes = (janelas.get(chave) ?? []).filter(t => now - t < JANELA_MS);
  if (recentes.length >= limite) { janelas.set(chave, recentes); return false; }
  recentes.push(now); janelas.set(chave, recentes);
  if (janelas.size > 10_000) for (const [k, v] of janelas) if (!v.some(t => now - t < JANELA_MS)) janelas.delete(k);
  return true;
}
export const MENSAGEM_RITMO = "Muitas perguntas em sequência. Aguarde um minuto e tente de novo.";
export const _limparRitmo = () => janelas.clear();
/** Tests only: the suite runs with a generous limit (RITMO_POR_MINUTO) and lowers it to exercise the refusal. */
export const _definirRitmo = (n: number | null) => { limiteAtual = n ?? RITMO_POR_MINUTO; };
