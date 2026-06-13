import { readCappedText } from "@/lib/utils/httpBody.server";

const encoder = new TextEncoder();

function streamFromChunks(chunks: string[]): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
  return { body } as unknown as Response;
}

describe("readCappedText", () => {
  it("returns the full body when under the cap", async () => {
    const res = streamFromChunks(["<html>", "hello", "</html>"]);
    expect(await readCappedText(res, 1_000)).toBe("<html>hello</html>");
  });

  it("caps an oversized body AND stops reading the stream (DoS protection)", async () => {
    const chunk = "x".repeat(1_000);
    let chunksProduced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced++;
        if (chunksProduced > 10_000) return controller.close(); // test safety net
        controller.enqueue(encoder.encode(chunk));
      },
    });
    const res = { body } as unknown as Response;
    const out = await readCappedText(res, 5_000);
    expect(out.length).toBe(5_000);
    // The reader must stop near the cap, not drain the (effectively unbounded) stream.
    expect(chunksProduced).toBeLessThan(20);
  });

  it("falls back to a capped text() when there is no body stream", async () => {
    const res = { body: null, text: async () => "y".repeat(100) } as unknown as Response;
    expect(await readCappedText(res, 50)).toBe("y".repeat(50));
  });

  it("returns empty string for an empty stream", async () => {
    const res = streamFromChunks([]);
    expect(await readCappedText(res, 1_000)).toBe("");
  });
});
