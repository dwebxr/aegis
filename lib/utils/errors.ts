/** Extract a human-readable message from an unknown caught error. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
