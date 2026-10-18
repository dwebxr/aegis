// Clears the timer on settle (no leaked handles) and swallows late losing-side rejections.
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string | Error = "timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(message instanceof Error ? message : new Error(message)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
