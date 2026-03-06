export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errMsgShort(err: unknown): string {
  const msg = errMsg(err);
  return msg.length > 120 ? msg.slice(0, 117) + "..." : msg;
}

export function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

/** Detect IC delegation/signature expiry errors and fire session-expired event. Returns true if handled. */
export function handleICSessionError(err: unknown): boolean {
  const msg = errMsg(err);
  if (
    msg.includes("Invalid signature") ||
    msg.includes("Invalid basic signature") ||
    msg.includes("Signature verification failed") ||
    msg.includes("Invalid delegations") ||
    msg.includes("Certificate is signed more than")
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aegis:session-expired"));
    }
    return true;
  }
  return false;
}
