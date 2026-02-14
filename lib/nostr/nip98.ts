import { finalizeEvent } from "nostr-tools/pure";

const KIND_HTTP_AUTH = 27235;

/**
 * Create a NIP-98 Authorization header value for HTTP requests.
 * Returns the full header string: "Nostr <base64-encoded-event>"
 */
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
