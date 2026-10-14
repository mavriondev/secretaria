import type { AnswerSource } from "@workspace/api-zod";

/** Fixed marker of answers researched outside the ERP: the manager always knows this figure is public and was consulted now. */
export const MARCA_FONTE_PUBLICA = "Fonte pública, consultado agora";

/** Short name of a source: the site (without www.), or a known institution name. */
export function nomeDaFonte(source: Pick<AnswerSource, "title" | "url">): string | null {
  try {
    const host = new URL(source.url).hostname.replace(/^www\./, "");
    if (host) return host;
  } catch { /* not a URL: fall back to the title */ }
  const title = source.title?.trim();
  return title ? title.slice(0, 60) : null;
}

/**
 * Appends the public-origin sentence once: "Fonte pública, consultado agora — ibge.gov.br." The answer may already carry
 * the marker (for example a deterministic quote text); then nothing is added.
 */
export function publicAnswerWithOrigin(answer: string, sources: ReadonlyArray<Pick<AnswerSource, "title" | "url">>, explicitName?: string | null): string {
  const text = answer.trim();
  if (text.toLowerCase().includes(MARCA_FONTE_PUBLICA.toLowerCase())) return text;
  const names = explicitName ? [explicitName] : [...new Set(sources.map(nomeDaFonte).filter((n): n is string => Boolean(n)))].slice(0, 2);
  const marker = names.length ? `${MARCA_FONTE_PUBLICA} — ${names.join(" e ")}.` : `${MARCA_FONTE_PUBLICA}.`;
  return text ? `${text}${/[.!?]$/.test(text) ? "" : "."} ${marker}` : marker;
}
