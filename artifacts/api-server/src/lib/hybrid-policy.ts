import type { AssistantResponse } from "@workspace/api-zod";

// Conservative gate: Live never speaks a financial/researched/ambiguous result.
const protectedTopic = /(?:\d|r\$|us\$|€|%|\b(?:erp|fatura\w*|financ\w*|lucro\w*|receita\w*|despesa\w*|custo\w*|vend\w*|compra\w*|saldo\w*|preco\w*|valor\w*|cotacao|dolar|real|reais|euro\w*|dinheiro|pag\w*|vencid\w*|divida\w*|juros|percent\w*|cliente\w*|produto\w*|estoque|empresa|negocio|crescimento|queda|aumento|diminui\w*|export\w*|documento\w*|relatorio\w*|mes|meses|ano|anos|mil|milhao|milhoes|bilhao|bilhoes|zero|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent\w*|trezent\w*|quatrocent\w*|quinhent\w*|seiscent\w*|setecent\w*|oitocent\w*|novecent\w*)\b)/i;
const normalized = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
export const protectedSpeech = (text: string) => protectedTopic.test(normalized(text));
export function allowNativeSpeech(question: string, response: AssistantResponse, transcript: string): boolean {
  return response.responseKind === "general" && !response.metricResult &&
    !(response.metricResults?.length) && !(response.sources?.length) && !response.document &&
    transcript.trim().length > 0 && transcript.length <= 2000 &&
    !protectedSpeech([question, response.answer, transcript].join("\n"));
}
