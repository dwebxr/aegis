/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const mockClearUserApiKey = jest.fn();
jest.mock("@/lib/apiKey/storage", () => ({
  clearUserApiKey: (...args: unknown[]) => mockClearUserApiKey(...args),
}));

beforeEach(() => {
  mockIsAuthenticated = true;
  mockPrincipalText = "abc-123-principal";
  mockLogin.mockClear();
  mockLogout.mockClear().mockResolvedValue(undefined);
  mockAddNotification.mockClear();
  mockClearUserApiKey.mockClear();
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

describe("AccountSection — logout button", () => {
  it("shows Logout button when authenticated", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("Logout");
    expect(html).toContain("aegis-settings-logout");
  });

  it("calls logout when Logout button clicked", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-logout"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("does not show Logout when unauthenticated", () => {
    mockIsAuthenticated = false;
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).not.toContain("aegis-settings-logout");
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

  it("shows social links (Discord, Medium, X)", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    expect(html).toContain("discord.gg/85JVzJaatT");
    expect(html).toContain("medium.com/aegis-ai");
    expect(html).toContain("x.com/Coo_aiagent");
  });

  it("renders social links with target=_blank", () => {
    const html = renderToStaticMarkup(<AccountSection />);
    const mediumLink = html.match(/<a[^>]*medium\.com[^>]*>/)?.[0] || "";
    expect(mediumLink).toContain('target="_blank"');
    expect(mediumLink).toContain('rel="noopener noreferrer"');
  });
});

describe("AccountSection — Danger Zone delete flow", () => {
  it("shows confirmation form when Delete button clicked", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    expect(screen.getByPlaceholderText(/DELETE/)).toBeInTheDocument();
    expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows warning about IC data persisting", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    expect(screen.getByText(/Data stored on the Internet Computer/)).toBeInTheDocument();
    expect(screen.getByText(/will re-sync on next login/)).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText(/DELETE/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText(/DELETE/)).toBeNull();
    expect(screen.getByText("Delete All Local Data")).toBeInTheDocument();
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

describe("AccountSection — copy principal", () => {
  it("copies principal to clipboard", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-copy-principal"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("abc-123-principal");
    });
  });

  it("shows Copied after successful copy", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-copy-principal"));

    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("shows error notification on clipboard failure", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-copy-principal"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Failed to copy to clipboard", "error");
    });
  });
});

describe("AccountSection — login button", () => {
  it("calls login when login button clicked", () => {
    mockIsAuthenticated = false;
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-login"));
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });
});

describe("AccountSection — delete local data", () => {
  beforeEach(() => {
    // Set up localStorage with aegis keys
    localStorage.clear();
    localStorage.setItem("aegis-prefs", "test");
    localStorage.setItem("aegis-cache", "test");
    localStorage.setItem("other-key", "keep");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("does nothing if DELETE not typed", async () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByTestId("aegis-settings-delete-input");
    fireEvent.change(input, { target: { value: "DELET" } });
    fireEvent.click(screen.getByText("Confirm Delete"));

    // handleDeleteLocalData returns early when input !== "DELETE"
    // so logout should never be called — wait a tick to confirm no async side-effects
    await waitFor(() => {
      expect(mockLogout).not.toHaveBeenCalled();
    });
    expect(localStorage.getItem("aegis-prefs")).toBe("test");
  });

  it("deletes aegis localStorage keys and calls logout", async () => {
    // Mock indexedDB
    const mockDeleteDatabase = jest.fn().mockImplementation(() => {
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, error: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    });
    Object.defineProperty(window, "indexedDB", {
      value: { deleteDatabase: mockDeleteDatabase },
      writable: true,
      configurable: true,
    });

    // Mock window.location.reload
    const reloadMock = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByTestId("aegis-settings-delete-input");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByTestId("aegis-settings-delete-confirm"));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });

    // aegis keys removed, other keys preserved
    expect(localStorage.getItem("aegis-prefs")).toBeNull();
    expect(localStorage.getItem("aegis-cache")).toBeNull();
    expect(localStorage.getItem("other-key")).toBe("keep");
    expect(mockClearUserApiKey).toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith("All local data deleted", "success");
  });

  it("shows error notification when delete fails", async () => {
    // Mock logout to reject, triggering the catch block
    mockLogout.mockRejectedValueOnce(new Error("logout failed"));

    const mockDeleteDatabase = jest.fn().mockImplementation(() => {
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, error: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    });
    Object.defineProperty(window, "indexedDB", {
      value: { deleteDatabase: mockDeleteDatabase },
      writable: true,
      configurable: true,
    });

    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByTestId("aegis-settings-delete-input");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByTestId("aegis-settings-delete-confirm"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Failed to delete local data", "error");
    });
    // Should exit deleting state
    expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
  });

  it("shows Deleting... state on confirm button", async () => {
    const mockDeleteDatabase = jest.fn().mockImplementation(() => {
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, error: null };
      // Deliberately don't call onsuccess to keep in deleting state
      return req;
    });
    Object.defineProperty(window, "indexedDB", {
      value: { deleteDatabase: mockDeleteDatabase },
      writable: true,
      configurable: true,
    });
    // prevent reload from actually executing
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: jest.fn() },
      writable: true,
      configurable: true,
    });

    render(<AccountSection />);
    fireEvent.click(screen.getByText("Delete All Local Data"));
    const input = screen.getByTestId("aegis-settings-delete-input");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByTestId("aegis-settings-delete-confirm"));

    // The button should show "Deleting..."
    expect(screen.getByText("Deleting...")).toBeInTheDocument();
  });
});

describe("AccountSection — mobile", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(<AccountSection mobile />);
    expect(html).toContain("Account");
    expect(html).toContain("AEGIS");
  });
});
