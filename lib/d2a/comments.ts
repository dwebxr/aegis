const STORAGE_KEY = "aegis-d2a-comments";
const MAX_COMMENTS = 500;
const DEFAULT_MAX_AGE_DAYS = 30;

export interface StoredComment {
  id: string;
  contentHash: string;
  senderPk: string;
  comment: string;
  timestamp: number;
  direction: "sent" | "received";
}

function readStore(): StoredComment[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[d2a-comments] Failed to parse stored comments:", err);
    return [];
  }
}

function writeStore(comments: StoredComment[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch (err) {
    console.warn("[d2a-comments] Failed to persist comments:", err);
  }
}

export function loadComments(): StoredComment[] {
  return readStore();
}

export function saveComment(comment: StoredComment): void {
  const comments = readStore();
  comments.push(comment);
  // Enforce max limit: drop oldest first
  if (comments.length > MAX_COMMENTS) {
    comments.sort((a, b) => a.timestamp - b.timestamp);
    comments.splice(0, comments.length - MAX_COMMENTS);
  }
  writeStore(comments);
}

export function getCommentsForContent(contentHash: string): StoredComment[] {
  return readStore().filter(c => c.contentHash === contentHash);
}

export function clearOldComments(maxAgeDays = DEFAULT_MAX_AGE_DAYS): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const comments = readStore().filter(c => c.timestamp >= cutoff);
  writeStore(comments);
}
