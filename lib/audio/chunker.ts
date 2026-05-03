// Workaround for the WebKit bug where iOS Safari silently fails to fire onend for utterances
// longer than ~150 chars. Splits on Latin+Japanese sentence terminators (terminator stays with
// the preceding sentence for prosody), then commas, then whitespace; no chunk exceeds maxChars.

const DEFAULT_MAX_CHARS = 150;

const SENTENCE_SPLIT = /([.!?。！？]+["'\u201D\u2019\uFF02\uFF07]?)\s*/u;
const SOFT_SPLIT = /([,、，;；])\s*/u;

function splitWithDelimiter(text: string, delimiter: RegExp): string[] {
  // Split with a capturing group interleaves delimiters; re-attach each to the preceding segment.
  const parts = text.split(delimiter);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const combined = ((parts[i] ?? "") + (parts[i + 1] ?? "")).trim();
    if (combined.length > 0) out.push(combined);
  }
  return out;
}

function hardSplit(text: string, maxChars: number): string[] {
  // Last-resort: word boundaries; tokens > maxChars (e.g. long URLs) are forcibly cut.
  const out: string[] = [];
  let current = "";
  for (const token of text.split(/\s+/).filter(t => t.length > 0)) {
    if (token.length > maxChars) {
      if (current.length > 0) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < token.length; i += maxChars) {
        out.push(token.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current.length === 0 ? token : `${current} ${token}`;
    if (candidate.length > maxChars) {
      if (current.length > 0) out.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

function packGreedily(out: string[], current: string, piece: string, maxChars: number): string {
  const candidate = current.length === 0 ? piece : `${current} ${piece}`;
  if (candidate.length > maxChars) {
    if (current.length > 0) out.push(current);
    return piece;
  }
  return candidate;
}

function expandOversized(sentence: string, maxChars: number): string[] {
  const expanded: string[] = [];
  for (const part of splitWithDelimiter(sentence, SOFT_SPLIT)) {
    if (part.length > maxChars) expanded.push(...hardSplit(part, maxChars));
    else expanded.push(part);
  }
  return expanded;
}

function packSentences(sentences: string[], maxChars: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const pieces = sentence.length > maxChars ? expandOversized(sentence, maxChars) : [sentence];
    for (const piece of pieces) {
      current = packGreedily(out, current, piece, maxChars);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

// Empty/whitespace input returns []; callers should filter empty tracks before queuing.
export function chunkText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = splitWithDelimiter(trimmed, SENTENCE_SPLIT);
  return packSentences(sentences.length > 0 ? sentences : [trimmed], maxChars);
}
