/**
 * Strip HTML tags and collapse whitespace.
 *
 * Replaces every `<...>` run with a single space, then collapses any
 * whitespace sequence (including the spaces introduced by the first
 * pass) back to a single space, then trims. Used by the URL and RSS
 * fetch routes to turn article HTML into plain text suitable for
 * scoring.
 *
 * Note: this is intentionally a spartan stripper. It does NOT decode
 * HTML entities (e.g. `&amp;`, `&#8217;`) — callers downstream of the
 * scoring pipeline tolerate those because Claude handles entity-rich
 * input without issue. If you need entity decoding, layer it on top.
 */
export function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
