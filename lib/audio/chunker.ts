/**
 * Chunk text into utterance-safe segments for the Web Speech API.
 *
 * Why this exists:
 *   iOS Safari's `SpeechSynthesisUtterance` silently fails to fire `onend`
 *   for utterances longer than ~150 characters, leaving the player stuck.
 *   This is a long-standing WebKit bug. The reliable workaround used by
 *   nearly every production Web Speech app is to split text into shorter
 *   utterances and queue them sequentially.
 *
 * Algorithm:
 *   1. If the input is already short enough, return it as a single chunk.
 *   2. Split on sentence terminators that exist in both Latin and Japanese:
 *      `.`, `!`, `?`, `。`, `！`, `？`. The terminator stays attached to
 *      the preceding sentence so prosody is preserved.
 *   3. Greedily pack sentences into chunks ≤ maxChars.
 *   4. If a single sentence is itself too long, soft-split on commas
 *      (`,`, `、`, `;`) and finally on whitespace, so no chunk ever
 *      exceeds the hard limit.
 */

const DEFAULT_MAX_CHARS = 150;

const SENTENCE_SPLIT = /([.!?。！？]+["'\u201D\u2019\uFF02\uFF07]?)\s*/u;
const SOFT_SPLIT = /([,、，;；])\s*/u;

function splitWithDelimiter(text: string, delimiter: RegExp): string[] {
  // String.split with a capturing-group regex returns the matched delimiters
  // interleaved with the surrounding text. We re-attach each delimiter to the
  // *preceding* segment so the speech engine renders the correct prosody.
  const parts = text.split(delimiter);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const combined = ((parts[i] ?? "") + (parts[i + 1] ?? "")).trim();
    if (combined.length > 0) out.push(combined);
  }
  return out;
}

function hardSplit(text: string, maxChars: number): string[] {
  // Last-resort whitespace-based split. Walks the string and emits chunks at
  // word boundaries that fit within maxChars. Tokens larger than maxChars
  // (e.g. long URLs) are forcibly cut to guarantee the invariant.
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

/**
 * Greedy packer step. Returns the new value of `current`; pushes onto `out`
 * when the candidate exceeds the limit and a non-empty `current` must flush.
 */
function packGreedily(out: string[], current: string, piece: string, maxChars: number): string {
  const candidate = current.length === 0 ? piece : `${current} ${piece}`;
  if (candidate.length > maxChars) {
    if (current.length > 0) out.push(current);
    return piece;
  }
  return candidate;
}

/** Soft-split + hard-split a sentence that is itself longer than maxChars. */
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

/**
 * Split `text` into a list of utterance-safe chunks, each ≤ maxChars.
 *
 * Empty / whitespace-only input returns an empty array (callers should
 * filter empty tracks before queuing them).
 */
export function chunkText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = splitWithDelimiter(trimmed, SENTENCE_SPLIT);
  return packSentences(sentences.length > 0 ? sentences : [trimmed], maxChars);
}
