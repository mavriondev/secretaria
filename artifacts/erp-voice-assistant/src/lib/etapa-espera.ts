/**
 * Discreet progress text while a typed question is being answered. The server works in a fixed order
 * (understand the question → consult → write the answer), but the HTTP answer arrives whole, so the label follows
 * the measured typical timing of each stage (routing ≈ 3 s, query < 0.1 s, composition ≈ 3 s). It is a visual
 * hint only: nothing here reads or changes the answer.
 */
export const ETAPAS_ESPERA: Array<{ aPartirDeMs: number; texto: string }> = [
  { aPartirDeMs: 0, texto: 'Entendendo a pergunta…' },
  { aPartirDeMs: 2500, texto: 'Consultando…' },
  { aPartirDeMs: 5000, texto: 'Montando a resposta…' },
  { aPartirDeMs: 12000, texto: 'Quase pronto…' },
];

export const etapaPara = (decorridoMs: number) => [...ETAPAS_ESPERA].reverse().find(e => decorridoMs >= e.aPartirDeMs)?.texto ?? ETAPAS_ESPERA[0]!.texto;
