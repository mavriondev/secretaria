/** Pure state rules for the on-screen options under an answer (clarification choices and hypothesis adjustments). */
export type Opcao = { rotulo: string; pergunta: string };
export const MAX_OPCOES = 4;
export const MAX_HIPOTESES = 3;

/** Real options only, deduplicated by question text, capped (4 for a clarification, 3 for adjustments). */
export function limitarOpcoes(opcoes: readonly Opcao[], pergunta: boolean): Opcao[] {
  const vistos = new Set<string>();
  const unicas = opcoes.filter(o => o.rotulo && o.pergunta && !vistos.has(o.pergunta) && !!vistos.add(o.pergunta));
  return unicas.slice(0, pergunta ? MAX_OPCOES : MAX_HIPOTESES);
}

/**
 * Options stay active during a voice conversation. They lock only while a request is in flight: an HTTP ask, a voice
 * connection being set up, or a voice turn being processed whose answer has not arrived yet (the answer can land
 * before the "processing" status clears, so a new answer id releases them).
 */
export function opcoesBloqueadas(e: { askPendente: boolean; estadoVoz: string; idResposta: number | null; idBase: number | null | undefined }): boolean {
  if (e.askPendente || e.estadoVoz === 'connecting') return true;
  if (e.estadoVoz === 'processing') return e.idBase === undefined || e.idResposta === e.idBase;
  return false;
}

/** `emCurso`: a reply was sent and its answer is pending. `finalizada`: the last answer was final, so the path is history. */
export type Trilha = { passos: string[]; emCurso: boolean; finalizada: boolean };
export const TRILHA_VAZIA: Trilha = { passos: [], emCurso: false, finalizada: false };
export const MAX_PALAVRAS_RESPOSTA_CURTA = 8;
export const respostaCurta = (texto: string) => { const p = texto.trim().split(/\s+/).filter(Boolean).length; return p > 0 && p <= MAX_PALAVRAS_RESPOSTA_CURTA; };

/** A choice was tapped: it joins the trail (a trail already closed by a final answer starts over). */
export const escolher = (t: Trilha, rotulo: string): Trilha => ({ passos: [...(t.finalizada ? [] : t.passos), rotulo], emCurso: true, finalizada: false });
/**
 * The person answered by speaking or typing. The chain continues (no step added) only when the current answer is a
 * clarification and the reply is short (`curta`); anything else is a fresh request and clears the trail.
 */
export const respostaLivre = (t: Trilha, e: { clarificacao: boolean; curta: boolean }): Trilha =>
  (e.clarificacao && e.curta && !t.finalizada ? { ...t, emCurso: true } : TRILHA_VAZIA);
/** A new answer arrived: a pending chain keeps its path (open while it is a question, history once final); otherwise it clears. */
export const novaResposta = (t: Trilha, pergunta: boolean): Trilha =>
  (t.emCurso && t.passos.length ? { passos: t.passos, emCurso: false, finalizada: !pergunta } : TRILHA_VAZIA);
export const cancelar = (): Trilha => TRILHA_VAZIA;

export const textoDaTrilha = (t: Trilha) => t.passos.join(' \u2192 ');
