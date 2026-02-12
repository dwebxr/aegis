import { POST } from "@/app/api/upload/image/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const originalFetch = global.fetch;

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
        const file = new Blob(["fake-image-data"], { type });
        const res = await POST(makeUploadRequest(file));
        expect(res.status).not.toBe(400);
      });
    }
  });

  describe("file size boundary", () => {
    it("accepts file at exactly 5MB", async () => {
      const data = new Uint8Array(5 * 1024 * 1024);
      const file = new Blob([data], { type: "image/jpeg" });
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
      const file = new Blob(["fake-jpeg"], { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe("https://nostr.build/i/abc123.jpg");
    });

    it("returns 502 when nostr.build returns non-OK", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
      const file = new Blob(["fake-png"], { type: "image/png" });
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
      const file = new Blob(["fake-gif"], { type: "image/gif" });
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
      const file = new Blob(["fake-webp"], { type: "image/webp" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("No URL");
    });

    it("returns 502 when fetch throws (host unreachable)", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));
      const file = new Blob(["fake"], { type: "image/jpeg" });
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
      const file = new Blob(["fake"], { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(502);
    });
  });

  describe("rate limiting", () => {
    it("allows 5 requests within window", async () => {
      const file = new Blob(["img"], { type: "image/jpeg" });
      for (let i = 0; i < 5; i++) {
        const res = await POST(makeUploadRequest(file));
        expect(res.status).not.toBe(429);
      }
    });

    it("returns 429 after exceeding 5 requests", async () => {
      const file = new Blob(["img"], { type: "image/jpeg" });
      for (let i = 0; i < 5; i++) {
        await POST(makeUploadRequest(file));
      }
      const res = await POST(makeUploadRequest(file));
      expect(res.status).toBe(429);
    });
  });
});
