/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabErrorBoundary } from "@/components/ui/TabErrorBoundary";

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Tab crash");
  return <div>Content OK</div>;
}

describe("TabErrorBoundary", () => {
  const originalConsoleError = console.error;
  beforeAll(() => { console.error = jest.fn(); });
  afterAll(() => { console.error = originalConsoleError; });

  it("renders children when no error", () => {
    render(
      <TabErrorBoundary tabName="Home">
        <div>Hello</div>
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("shows error UI with tab name when child throws", () => {
    render(
      <TabErrorBoundary tabName="Dashboard">
        <ThrowingChild shouldThrow />
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Dashboard encountered an error")).toBeTruthy();
    expect(screen.getByText("Tab crash")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("reports error to Sentry with tab name", () => {
    const Sentry = require("@sentry/nextjs");
    render(
      <TabErrorBoundary tabName="Sources">
        <ThrowingChild shouldThrow />
      </TabErrorBoundary>,
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Tab crash" }),
      expect.objectContaining({ extra: expect.objectContaining({ tab: "Sources" }) }),
    );
  });

  it("recovers when Retry is clicked and error condition resolves", () => {
    let shouldThrow = true;
    function ConditionalChild() {
      if (shouldThrow) throw new Error("Tab crash");
      return <div>Content OK</div>;
    }

    render(
      <TabErrorBoundary tabName="Settings">
        <ConditionalChild />
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Settings encountered an error")).toBeTruthy();

    // Resolve the error condition before retrying
    shouldThrow = false;
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByText("Content OK")).toBeTruthy();
  });

  it("isolates errors — siblings remain unaffected", () => {
    render(
      <div>
        <TabErrorBoundary tabName="Broken">
          <ThrowingChild shouldThrow />
        </TabErrorBoundary>
        <div>Sibling OK</div>
      </div>,
    );
    expect(screen.getByText("Broken encountered an error")).toBeTruthy();
    expect(screen.getByText("Sibling OK")).toBeTruthy();
  });
});
