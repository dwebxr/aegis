/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
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
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("shows error UI with tab name when child throws", () => {
    render(
      <TabErrorBoundary tabName="Dashboard">
        <ThrowingChild shouldThrow />
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Dashboard encountered an error")).toBeInTheDocument();
    expect(screen.getByText("Tab crash")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
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
    expect(screen.getByText("Settings encountered an error")).toBeInTheDocument();

    // Resolve the error condition before retrying
    shouldThrow = false;
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByText("Content OK")).toBeInTheDocument();
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
    expect(screen.getByText("Broken encountered an error")).toBeInTheDocument();
    expect(screen.getByText("Sibling OK")).toBeInTheDocument();
  });

  it("re-catches error when Retry is clicked but error persists", () => {
    render(
      <TabErrorBoundary tabName="Stuck">
        <ThrowingChild shouldThrow />
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Stuck encountered an error")).toBeInTheDocument();

    // Click Retry — error still throws, boundary should re-catch
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByText("Stuck encountered an error")).toBeInTheDocument();
    expect(screen.getByText("Tab crash")).toBeInTheDocument();
  });

  it("handles error with empty message gracefully", () => {
    function EmptyErrorChild(): React.ReactElement {
      throw new Error("");
    }
    render(
      <TabErrorBoundary tabName="Empty">
        <EmptyErrorChild />
      </TabErrorBoundary>,
    );
    expect(screen.getByText("Empty encountered an error")).toBeInTheDocument();
  });
});
