/**
 * Compile-time Sentry type compatibility test.
 *
 * The main engine.test.ts mocks @sentry/nextjs entirely so the
 * production code can be exercised without a real Sentry client. That
 * approach verifies call shape but does NOT catch SDK API regressions
 * — a minor version bump that renames `startSpan` options or moves
 * `Span.setAttribute` would pass the mocked tests but crash at
 * runtime in production.
 *
 * This test imports the REAL Sentry types and asserts that the engine
 * code's usage patterns are structurally compatible. It runs as a
 * normal jest test but the assertions are primarily compile-time:
 * if the real @sentry/nextjs types don't match, the file won't
 * compile and the test will fail at the TypeScript stage.
 *
 * No @sentry/nextjs initialization happens here; we only import types.
 */

import type { Span, StartSpanOptions } from "@sentry/nextjs";
import * as Sentry from "@sentry/nextjs";

describe("Sentry API compatibility (real SDK types)", () => {
  it("exports startSpan / captureException as callable functions", () => {
    expect(typeof Sentry.startSpan).toBe("function");
    expect(typeof Sentry.captureException).toBe("function");
  });

  it("StartSpanOptions accepts name + op + attributes", () => {
    // This is a compile-time assertion — if the real SDK type changes
    // the shape of StartSpanOptions, TypeScript will reject this file
    // before the test runs. The actual runtime assertion just sanity-
    // checks that the shape is a plain object.
    const opts: StartSpanOptions = {
      name: "translate.content",
      op: "translate",
      attributes: {
        "translate.backend": "auto",
        "translate.target": "ja",
      },
    };
    expect(opts.name).toBe("translate.content");
    expect(opts.op).toBe("translate");
    expect(opts.attributes?.["translate.backend"]).toBe("auto");
  });

  it("Span type has a setAttribute method in its signature", () => {
    // Compile-time: assign a function with the engine's usage pattern
    // to a Span consumer. If Sentry drops or renames setAttribute, the
    // assignment won't typecheck.
    const useSpan = (span: Span): void => {
      span.setAttribute("translate.result", "ok");
      span.setAttribute("translate.backend", "ollama");
    };
    expect(typeof useSpan).toBe("function");
  });

  it("startSpan accepts a callback that receives the Span", () => {
    // Compile-time: the callback signature from engine.ts
    // (`async (span) => translateContentInner(opts, span)`) must match
    // the SDK's expected shape. Construct a dummy callback with the
    // same parameter positioning to lock the contract in place.
    const cb: Parameters<typeof Sentry.startSpan>[1] = (span) => {
      span.setAttribute("test.key", "value");
      return "result";
    };
    expect(typeof cb).toBe("function");
  });

  it("captureException accepts an Error plus tags + contexts", () => {
    // Compile-time: if the CaptureContext shape changes (e.g. tags
    // moves out, contexts gets renamed), the object literal won't
    // typecheck.
    const error = new Error("test");
    const captureContext = {
      tags: {
        "translate.result": "infra-error",
        "translate.target": "ja",
      },
      contexts: {
        translate: {
          failures: [{ name: "ollama", reason: "Load failed" }],
          attempts: 1,
        },
      },
    };
    // Can't actually call captureException without initializing Sentry
    // — but the type of the literal has to match the parameter type.
    type ExpectedArg = Parameters<typeof Sentry.captureException>[1];
    const _typed: ExpectedArg = captureContext;
    expect(_typed).toBe(captureContext);
    expect(error).toBeInstanceOf(Error);
  });
});
