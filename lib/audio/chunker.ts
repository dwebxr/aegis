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
 *   2. Otherwise split on sentence terminators that exist in both Latin
 *      and Japanese: `.`, `!`, `?`, `。`, `！`, `？`. Keep the terminator
 *      attached to the preceding sentence so the TTS engine renders the
 *      correct prosody.
 *   3. Greedily pack sentences into chunks no larger than `maxChars`.
 *   4. If a single sentence is itself longer than `maxChars`, fall back to
 *      a soft split on commas (`,`, `、`) and finally on whitespace, so
 *      that no chunk ever exceeds the hard limit.
 *
 * The function never produces empty chunks and always preserves the
 * original character order; concatenating the result with no separator
 * yields the input modulo collapsed runs of whitespace at chunk boundaries.
 */

const DEFAULT_MAX_CHARS = 150;

/** Sentence-terminator regex covering ASCII and full-width forms. */
const SENTENCE_SPLIT = /([.!?。！？]+["'\u201D\u2019\uFF02\uFF07]?)\s*/u;

/** Soft-split candidates within a long sentence. */
const SOFT_SPLIT = /([,、，;；])\s*/u;

function splitKeepingDelimiter(text: string, delimiterRegex: RegExp): string[] {
  // Use a global form so that `String.split` returns the matched delimiter
  // alongside the surrounding text. We then re-attach the delimiter to the
  // *preceding* segment so prosody is preserved.
  const flags = delimiterRegex.flags.includes("g")
    ? delimiterRegex.flags
    : `${delimiterRegex.flags}g`;
  const re = new RegExp(delimiterRegex.source, flags);
  const parts = text.split(re);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const delim = parts[i + 1] ?? "";
    const combined = (body + delim).trim();
    if (combined.length > 0) out.push(combined);
  }
  return out;
}

function hardSplit(text: string, maxChars: number): string[] {
  // Last-resort whitespace-based split for sentences without commas. This
  // walks the string and emits chunks at word boundaries that fit within
  // maxChars. If a single token exceeds maxChars (e.g. a long URL), the
  // token is forcibly split at maxChars to guarantee the invariant.
  const out: string[] = [];
  const tokens = text.split(/\s+/).filter(t => t.length > 0);
  let current = "";
  for (const token of tokens) {
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

function packSentences(sentences: string[], maxChars: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    // If even a single sentence is too long, soft-split it then hard-split
    // any remaining oversized fragments. The resulting fragments are
    // packed back into the same flow as if they were independent sentences.
    if (sentence.length > maxChars) {
      if (current.length > 0) {
        out.push(current);
        current = "";
      }
      const softParts = splitKeepingDelimiter(sentence, SOFT_SPLIT);
      const expanded: string[] = [];
      for (const part of softParts) {
        if (part.length > maxChars) {
          expanded.push(...hardSplit(part, maxChars));
        } else {
          expanded.push(part);
        }
      }
      // Re-pack the expanded fragments greedily.
      for (const fragment of expanded) {
        const candidate = current.length === 0 ? fragment : `${current} ${fragment}`;
        if (candidate.length > maxChars) {
          if (current.length > 0) out.push(current);
          current = fragment;
        } else {
          current = candidate;
        }
      }
      continue;
    }

    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (candidate.length > maxChars) {
      out.push(current);
      current = sentence;
    } else {
      current = candidate;
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

  const sentences = splitKeepingDelimiter(trimmed, SENTENCE_SPLIT);
  // If sentence splitting failed to produce multiple parts (e.g. text with no
  // terminators at all), packSentences will fall through to soft+hard split.
  return packSentences(sentences.length > 0 ? sentences : [trimmed], maxChars);
}
