export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Truncated error message safe for UI notifications (max 120 chars). */
export function errMsgShort(err: unknown): string {
  const msg = errMsg(err);
  return msg.length > 120 ? msg.slice(0, 117) + "..." : msg;
}
