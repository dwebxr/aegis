import { finalizeEvent } from "nostr-tools/pure";

const KIND_HTTP_AUTH = 27235;

/** NIP-98: "Nostr <base64-event>" authorization header. */
export function createNIP98AuthHeader(
  sk: Uint8Array,
  url: string,
  method: string,
): string {
  const event = finalizeEvent(
    {
      kind: KIND_HTTP_AUTH,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method.toUpperCase()],
      ],
      content: "",
    },
    sk,
  );

  const encoded = btoa(JSON.stringify(event));
  return `Nostr ${encoded}`;
}
