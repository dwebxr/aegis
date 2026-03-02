/**
 * @jest-environment jsdom
 */
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountSection } from "@/components/settings/AccountSection";

/* ---------- Mock variables ---------- */
let mockIsAuthenticated = true;
let mockPrincipalText = "abc-123-principal";
const mockLogin = jest.fn();
const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockAddNotification = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    principalText: mockPrincipalText,
    login: mockLogin,
    logout: mockLogout,
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

jest.mock("@/components/ui/NostrAccountLink", () => ({
  NostrAccountLink: () => <div data-testid="nostr-link">NostrAccountLink</div>,
}));

jest.mock("@/lib/apiKey/storage", () => ({
  clearUserApiKey: jest.fn(),
}));

beforeEach(() => {
  mockIsAuthenticated = true;
  mockPrincipalText = "abc-123-principal";
  mockLogin.mockClear();
  mockLogout.mockClear();
  mockAddNotification.mockClear();
});

describe("AccountSection — authenticated state", () => {
  it("shows Connected badge and principal text", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("Connected");
    expect(html).toContain("abc-123-principal");
    expect(html).toContain("Principal:");
  });

  it("shows Copy button", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("Copy");
  });

  it("shows Danger Zone when authenticated", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("Danger Zone");
    expect(html).toContain("Delete All Local Data");
  });
});

describe("AccountSection — unauthenticated state", () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    mockPrincipalText = "";
  });

  it("shows Not connected and login button", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("Not connected");
    expect(html).toContain("Login with Internet Identity");
  });

  it("does not show Danger Zone", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).not.toContain("Danger Zone");
  });

  it("does not show principal text", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).not.toContain("Principal:");
  });
});

describe("AccountSection — Nostr account", () => {
  it("renders NostrAccountLink when onLinkChange provided", () => {
    const html = renderToStaticMarkup(
      <AccountSection onLinkChange={jest.fn()} linkedAccount={null} />
    );
    expect(html).toContain("Nostr Account");
  });

  it("hides NostrAccountLink when onLinkChange not provided", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).not.toContain("Nostr Account");
  });
});

describe("AccountSection — About section", () => {
  it("shows AEGIS branding", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("AEGIS");
    expect(html).toContain("v3.0");
    expect(html).toContain("D2A Social Agent Platform");
  });

  it("shows GitHub link", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("https://github.com/dwebxr/aegis");
    expect(html).toContain("GitHub");
  });
});

describe("AccountSection — Danger Zone delete flow", () => {
  it("shows confirmation form when Delete button clicked", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    expect(screen.getByPlaceholderText(/DELETE/)).toBeTruthy();
    expect(screen.getByText("Confirm Delete")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("shows warning about IC data persisting", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    expect(screen.getByText(/Data stored on the Internet Computer/)).toBeTruthy();
    expect(screen.getByText(/will re-sync on next login/)).toBeTruthy();
  });

  it("Confirm Delete button is disabled until DELETE is typed", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const confirmBtn = screen.getByText("Confirm Delete") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it("Confirm Delete button enables when DELETE is typed", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByPlaceholderText(/DELETE/);
    fireEvent.change(input, { target: { value: "DELETE" } });
    const confirmBtn = screen.getByText("Confirm Delete") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  it("Cancel hides the confirmation form", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    expect(screen.getByPlaceholderText(/DELETE/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText(/DELETE/)).toBeNull();
    expect(screen.getByText("Delete All Local Data")).toBeTruthy();
  });

  it("rejects partial DELETE input", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByPlaceholderText(/DELETE/);
    fireEvent.change(input, { target: { value: "DELET" } });
    const confirmBtn = screen.getByText("Confirm Delete") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it("rejects lowercase delete input", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByPlaceholderText(/DELETE/);
    fireEvent.change(input, { target: { value: "delete" } });
    const confirmBtn = screen.getByText("Confirm Delete") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });
});

describe("AccountSection — mobile", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(<AccountSection mobile />);
    expect(html).toContain("Account");
    expect(html).toContain("AEGIS");
  });
});
