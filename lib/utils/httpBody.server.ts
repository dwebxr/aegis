import "server-only";

// Reads a fetch Response body as UTF-8 text, hard-capped at maxBytes, canceling
// the stream once the cap is reached. Unlike res.text(), this never buffers an
// unbounded body: a server returning a huge chunked response (no Content-Length,
// so a Content-Length pre-check is useless) cannot exhaust function memory.
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No readable stream (a synthetic/empty Response). Real fetch responses —
    // including the unbounded chunked ones this guards against — always expose a
    // body stream, so this branch only sees small/empty bodies. Still cap it.
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    // Free the connection; we have what we need (or hit the cap).
    await reader.cancel().catch(() => {});
  }
  const capped = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= capped.length) break;
    const take = Math.min(chunk.length, capped.length - offset);
    capped.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  // fatal:false: a multibyte char may straddle the byte cap; tolerate the partial.
  return new TextDecoder("utf-8", { fatal: false }).decode(capped);
}
