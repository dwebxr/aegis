/**
 * Race a promise against a timeout. Clears the timer when the promise
 * settles first, preventing leaked handles that keep the event loop alive.
 * Attaches a no-op catch to the original promise so a late rejection after
 * timeout does not become an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Prevent unhandled rejection if the original promise rejects after timeout wins
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
