/**
 * The screen renders answers as plain text and the voice reads them aloud: Markdown written by the model
 * (bold, headings, bullet lists, links) must not reach either. Applied to every answer regardless of origin.
 */

/** Plain text for the screen: emphasis, headings, code ticks, rules and link syntax removed; list lines and URLs kept readable. */
export function limparMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)\s]+\)/g, "$1") // [title](url) → title
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "") // headings
    .replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, "") // horizontal rules
    .replace(/^[ \t]*[*+][ \t]+/gm, "- ") // bullet variants → one readable marker
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text for speech: no list markers, no URLs, no leftover Markdown; one line of prose. */
export function limparMarkdownParaFala(text: string): string {
  return limparMarkdown(text)
    .replace(/^[ \t]*(?:[-•][ \t]+|\d{1,2}[.)][ \t]+)/gm, "")
    .replace(/\(?\bhttps?:\/\/\S+\)?/g, "")
    .replace(/\([ \t]*\)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
