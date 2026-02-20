import { POST } from "@/app/api/upload/image/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const originalFetch = global.fetch;

// Magic byte headers for each image type
const MAGIC: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF, 0xE0],
  "image/png":  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  "image/gif":  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
};

function makeImageBlob(type: string, sizeBytes?: number): Blob {
  const header = MAGIC[type] ?? [];
  const total = sizeBytes ?? (header.length + 64);
  const buf = new Uint8Array(total);
  buf.set(header);
  return new Blob([buf], { type });
}

function makeUploadRequest(file?: Blob, fieldName = "file"): NextRequest {
  const formData = new FormData();
  if (file) formData.append(fieldName, file);
  return new NextRequest("http://localhost:3000/api/upload/image", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/upload/image", () => {
  beforeEach(() => {
    _resetRateLimits();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("input validation", () => {
    it("returns 400 when no file is provided", async () => {
      const formData = new FormData();
      const req = new NextRequest("http://localhost:3000/api/upload/image", {
        method: "POST",
        body: formData,
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("No file");
    });

    it("returns 400 for non-form-data body", async () => {
      const req = new NextRequest("http://localhost:3000/api/upload/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "not-a-file" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for unsupported file type (text/plain)", async () => {
      const file = new Blob(["hello"], { type: "text/plain" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Unsupported file type");
    });

    it("returns 400 for unsupported file type (application/pdf)", async () => {
      const file = new Blob(["pdf-data"], { type: "application/pdf" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Unsupported");
    });

    it("returns 400 for SVG files", async () => {
      const file = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
    });

    it("returns 400 for spoofed MIME with wrong magic bytes", async () => {
      const file = new Blob(["not-an-image"], { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("does not match");
    });

    it("returns 400 for file exceeding 5MB", async () => {
      const bigData = new Uint8Array(5 * 1024 * 1024 + 1);
      const file = new Blob([bigData], { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("too large");
      expect(data.error).toContain("5MB");
    });

    it("error message shows actual file size", async () => {
      const bigData = new Uint8Array(6 * 1024 * 1024);
      const file = new Blob([bigData], { type: "image/png" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/6\.0MB/);
    });
  });

  describe("accepted file types", () => {
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    for (const type of validTypes) {
      it(`accepts ${type} files (passes validation)`, async () => {
        const file = makeImageBlob(type);
        const res = await POST(makeUploadRequest(file));
        expect(res.status).not.toBe(400);
      });
    }
  });

  describe("file size boundary", () => {
    it("accepts file at exactly 5MB", async () => {
      const file = makeImageBlob("image/jpeg", 5 * 1024 * 1024);
      const res = await POST(makeUploadRequest(file));
      expect(res.status).not.toBe(400);
    }, 15000);

    it("rejects file at 5MB + 1 byte", async () => {
      const data = new Uint8Array(5 * 1024 * 1024 + 1);
      const file = new Blob([data], { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(400);
    }, 15000);
  });

  describe("nostr.build interaction", () => {
    it("returns URL on successful upload", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "success", data: [{ url: "https://nostr.build/i/abc123.jpg" }] }),
      });
      const file = makeImageBlob("image/jpeg");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe("https://nostr.build/i/abc123.jpg");
    });

    it("forwards Authorization header to nostr.build", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "success", data: [{ url: "https://nostr.build/i/authed.jpg" }] }),
      });
      const file = makeImageBlob("image/jpeg");
      const formData = new FormData();
      formData.append("file", file);
      const req = new NextRequest("http://localhost:3000/api/upload/image", {
        method: "POST",
        headers: { Authorization: "Nostr eyJraW5kIjoyNzIzNX0=" },
        body: formData,
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[1].headers).toHaveProperty("Authorization", "Nostr eyJraW5kIjoyNzIzNX0=");
    });

    it("does not send Authorization header when none provided", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "success", data: [{ url: "https://nostr.build/i/noauth.jpg" }] }),
      });
      const file = makeImageBlob("image/jpeg");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(200);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[1].headers).not.toHaveProperty("Authorization");
    });

    it("returns 502 when nostr.build returns non-OK", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
      const file = makeImageBlob("image/png");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Image host error");
    });

    it("returns 502 when nostr.build returns invalid JSON", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Unexpected token")),
      });
      const file = makeImageBlob("image/gif");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Invalid response");
    });

    it("returns 502 when response has no URL in data", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "success", data: [] }),
      });
      const file = makeImageBlob("image/webp");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("No URL");
    });

    it("returns 502 when fetch throws (host unreachable)", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));
      const file = makeImageBlob("image/jpeg");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("unreachable");
    });

    it("returns 502 when response data has null URL", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: null }] }),
      });
      const file = makeImageBlob("image/jpeg");
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
    });
  });

  describe("rate limiting", () => {
    it("allows 10 requests within window", async () => {
      const file = makeImageBlob("image/jpeg");
      for (let i = 0; i < 10; i++) {
        const res = await POST(makeUploadRequest(file));
        expect(res.status).not.toBe(429);
      }
    });

    it("returns 429 after exceeding 10 requests", async () => {
      const file = makeImageBlob("image/jpeg");
      for (let i = 0; i < 10; i++) {
        await POST(makeUploadRequest(file));
      }
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(429);
    });
  });
});
