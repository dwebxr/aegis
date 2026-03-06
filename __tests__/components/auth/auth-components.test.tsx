/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockLogin = jest.fn().mockResolvedValue(undefined);
const mockLogout = jest.fn().mockResolvedValue(undefined);
let mockAuthState: Record<string, unknown> = {
  isAuthenticated: false,
  isLoading: false,
  login: mockLogin,
  logout: mockLogout,
  principalText: "",
  principal: null,
  identity: null,
};

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

const mockAddNotification = jest.fn();
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

jest.mock("@/components/icons", () => ({
  ShieldIcon: ({ s }: { s: number }) => <span data-testid="shield-icon" data-size={s} />,
}));

import { LoginButton } from "@/components/auth/LoginButton";
import { UserBadge } from "@/components/auth/UserBadge";

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = {
    isAuthenticated: false,
    isLoading: false,
    login: mockLogin,
    logout: mockLogout,
    principalText: "",
    principal: null,
    identity: null,
  };
});

describe("LoginButton", () => {
  it("shows loading spinner when isLoading", () => {
    mockAuthState.isLoading = true;
    const { container } = render(<LoginButton />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows 'Login with Internet Identity' when not authenticated", () => {
    render(<LoginButton />);
    expect(screen.getByText("Login with Internet Identity")).toBeTruthy();
  });

  it("shows 'Login' (short) when compact", () => {
    render(<LoginButton compact />);
    expect(screen.getByText("Login")).toBeTruthy();
  });

  it("shows 'Logout' button when authenticated", () => {
    mockAuthState.isAuthenticated = true;
    render(<LoginButton />);
    expect(screen.getByText("Logout")).toBeTruthy();
  });

  it("calls login() on click when not authenticated", () => {
    render(<LoginButton />);
    fireEvent.click(screen.getByText("Login with Internet Identity"));
    expect(mockLogin).toHaveBeenCalled();
  });

  it("calls logout() on click when authenticated", () => {
    mockAuthState.isAuthenticated = true;
    render(<LoginButton />);
    fireEvent.click(screen.getByText("Logout"));
    expect(mockLogout).toHaveBeenCalled();
  });

  it("shows notification on login failure", async () => {
    mockLogin.mockRejectedValueOnce(new Error("auth failed"));
    render(<LoginButton />);
    fireEvent.click(screen.getByText("Login with Internet Identity"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Login failed. Please try again.", "error");
    });
  });

  it("shows notification on logout failure", async () => {
    mockAuthState.isAuthenticated = true;
    mockLogout.mockRejectedValueOnce(new Error("logout failed"));
    render(<LoginButton />);
    fireEvent.click(screen.getByText("Logout"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Logout failed. Please try again.", "error");
    });
  });

  it("renders shield icon with correct size", () => {
    render(<LoginButton />);
    expect(screen.getByTestId("shield-icon").getAttribute("data-size")).toBe("16");
  });

  it("renders smaller shield icon when compact", () => {
    render(<LoginButton compact />);
    expect(screen.getByTestId("shield-icon").getAttribute("data-size")).toBe("13");
  });
});

describe("UserBadge", () => {
  it("returns null when loading", () => {
    mockAuthState.isLoading = true;
    const { container } = render(<UserBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when not authenticated", () => {
    const { container } = render(<UserBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("shows truncated principal when > 12 chars", () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.principalText = "abcde12345fghij67890";
    render(<UserBadge />);
    expect(screen.getByText("abcde...67890")).toBeTruthy();
  });

  it("shows full principal when <= 12 chars", () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.principalText = "short-id";
    render(<UserBadge />);
    expect(screen.getByText("short-id")).toBeTruthy();
  });

  it("shows 'Connected' status", () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.principalText = "test-principal";
    render(<UserBadge />);
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("calls logout on button click", () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.principalText = "test-principal";
    render(<UserBadge />);
    fireEvent.click(screen.getByText("Logout"));
    expect(mockLogout).toHaveBeenCalled();
  });
});
