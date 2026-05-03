// Tags-only stripper: does NOT decode HTML entities (&amp; etc). Layer decoding on top if needed.
export function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
