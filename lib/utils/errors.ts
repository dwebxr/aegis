export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Truncated error message safe for UI notifications (max 120 chars). */
export function errMsgShort(err: unknown): string {
  const msg = errMsg(err);
  return msg.length > 120 ? msg.slice(0, 117) + "..." : msg;
}

/** Detect IC delegation/signature expiry errors and fire session-expired event. Returns true if handled. */
export function handleICSessionError(err: unknown): boolean {
  const msg = errMsg(err);
  if (msg.includes("Invalid signature") || msg.includes("Invalid basic signature")) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aegis:session-expired"));
    }
    return true;
  }
  return false;
}
