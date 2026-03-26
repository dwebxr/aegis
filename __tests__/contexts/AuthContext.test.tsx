/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, act, waitFor } from "@testing-library/react";

// ── Mock @dfinity/auth-client ──
const mockIsAuthenticated = jest.fn<Promise<boolean>, []>();
const mockGetIdentity = jest.fn();
const mockLogin = jest.fn();
const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockAuthClientCreate = jest.fn<Promise<{
  isAuthenticated: () => Promise<boolean>;
  getIdentity: () => unknown;
  login: (opts: unknown) => void;
  logout: () => Promise<void>;
}>, []>();

jest.mock("@dfinity/auth-client", () => ({
  AuthClient: {
    create: () => mockAuthClientCreate(),
  },
}));

// ── Mock @dfinity/agent ──
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { createSync: jest.fn() },
}));

// ── Mock @dfinity/principal (real enough for .isAnonymous()) ──
const realPrincipalModule = jest.requireActual("@dfinity/principal") as { Principal: { fromText: (t: string) => { toText: () => string; isAnonymous: () => boolean } } };
jest.mock("@dfinity/principal", () => realPrincipalModule);
const { Principal } = realPrincipalModule;

// ── Mock IC config ──
jest.mock("@/lib/ic/agent", () => ({
  getInternetIdentityUrl: () => "https://identity.ic0.app",
  getDerivationOrigin: () => "https://test.icp0.io",
}));

// ── Mock Sentry ──
const mockSetUser = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  setUser: (...args: unknown[]) => mockSetUser(...args),
}));

// ── Mock NotificationContext ──
const mockAddNotification = jest.fn();
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

// ── Mock errMsg ──
jest.mock("@/lib/utils/errors", () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function makeClient() {
  const client = {
    isAuthenticated: mockIsAuthenticated,
    getIdentity: mockGetIdentity,
    login: mockLogin,
    logout: mockLogout,
  };
  mockAuthClientCreate.mockResolvedValue(client);
  return client;
}

function makeDelegationIdentity(principalText: string, expirationNs: bigint) {
  const principal = Principal.fromText(principalText);
  return {
    getPrincipal: () => principal,
    getDelegation: () => ({
      delegations: [{ delegation: { expiration: expirationNs } }],
    }),
  };
}

function makeSimpleIdentity(principalText: string) {
  const principal = Principal.fromText(principalText);
  return {
    getPrincipal: () => principal,
  };
}

// Test consumer that exposes auth state
function AuthConsumer({ onState }: { onState: (s: ReturnType<typeof useAuth>) => void }) {
  const state = useAuth();
  React.useEffect(() => { onState(state); });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AuthProvider — initialization", () => {
  it("sets isAuthenticated=true when client reports authenticated with valid delegation", async () => {
    const client = makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    // Expiration far in the future
    const futureNs = BigInt(Date.now() + 3_600_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity(
      "rwlgt-iiaaa-aaaaa-aaaaa-cai", futureNs
    );
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(true);
      expect(captured?.isLoading).toBe(false);
    });
    expect(mockSetUser).toHaveBeenCalledWith({ id: expect.any(String) });
    expect(client.logout).not.toHaveBeenCalled();
  });

  it("logs out and sets isAuthenticated=false when principal is anonymous (2vxsx-fae)", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    // Anonymous principal — should be detected and rejected
    const identity = makeSimpleIdentity("2vxsx-fae");
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
      expect(captured?.isLoading).toBe(false);
    });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it("logs out when delegation is expired", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    // Expiration in the past
    const pastNs = BigInt(Date.now() - 3_600_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity(
      "rwlgt-iiaaa-aaaaa-aaaaa-cai", pastNs
    );
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
    });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith(
      "Session expired — please log in again", "error"
    );
  });

  it("sets isAuthenticated=false when client reports not authenticated", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(false);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
      expect(captured?.isLoading).toBe(false);
    });
  });

  it("handles AuthClient.create() failure with error notification", async () => {
    mockAuthClientCreate.mockRejectedValue(new Error("Crypto not available"));

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isLoading).toBe(false);
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      "Authentication system failed to initialize", "error"
    );
  });

  it("accepts identity without getDelegation (e.g. Ed25519KeyIdentity)", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    // Identity without getDelegation method — should be treated as fresh
    const identity = makeSimpleIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(true);
    });
  });
});

describe("AuthProvider — login flow", () => {
  it("rejects login with anonymous principal in onSuccess", async () => {
    const client = makeClient();
    mockIsAuthenticated.mockResolvedValue(false);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    // Simulate login: capture the onSuccess/onError callbacks
    mockLogin.mockImplementation((opts: { onSuccess: () => void; onError: (e: unknown) => void }) => {
      // Set identity to anonymous before calling onSuccess
      const anonIdentity = makeSimpleIdentity("2vxsx-fae");
      client.getIdentity = jest.fn().mockReturnValue(anonIdentity);
      opts.onSuccess();
    });

    await act(async () => {
      try {
        await captured?.login();
      } catch (e) {
        expect((e as Error).message).toContain("anonymous principal");
      }
    });

    expect(mockAddNotification).toHaveBeenCalledWith(
      "Login failed: received anonymous identity", "error"
    );
  });

  it("sets auth state on successful login with valid principal", async () => {
    const client = makeClient();
    mockIsAuthenticated.mockResolvedValue(false);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => expect(captured?.isLoading).toBe(false));

    mockLogin.mockImplementation((opts: { onSuccess: () => void }) => {
      const validIdentity = makeSimpleIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai");
      client.getIdentity = jest.fn().mockReturnValue(validIdentity);
      opts.onSuccess();
    });

    await act(async () => {
      await captured?.login();
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(true);
      expect(captured?.principalText).toBeTruthy();
    });
    expect(mockSetUser).toHaveBeenCalledWith({ id: expect.any(String) });
  });

  it("shows error notification on login failure (onError callback)", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(false);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => expect(captured?.isLoading).toBe(false));

    mockLogin.mockImplementation((opts: { onError: (e: string) => void }) => {
      opts.onError("UserInterrupt: User cancelled");
    });

    await act(async () => {
      try {
        await captured?.login();
      } catch {
        // expected
      }
    });

    expect(mockAddNotification).toHaveBeenCalledWith(
      "Login failed: UserInterrupt: User cancelled", "error"
    );
  });
});

describe("AuthProvider — logout flow", () => {
  it("clears all auth state on logout", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    const futureNs = BigInt(Date.now() + 3_600_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai", futureNs);
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => expect(captured?.isAuthenticated).toBe(true));

    await act(async () => {
      await captured?.logout();
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
      expect(captured?.principalText).toBe("");
    });
    expect(mockSetUser).toHaveBeenLastCalledWith(null);
  });
});

describe("AuthProvider — delegation edge cases", () => {
  it("handles multiple delegations — expires if ANY delegation is expired", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);

    const futureNs = BigInt(Date.now() + 3_600_000) * BigInt(1_000_000);
    const pastNs = BigInt(Date.now() - 1_000) * BigInt(1_000_000);
    const principal = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    const identity = {
      getPrincipal: () => principal,
      getDelegation: () => ({
        delegations: [
          { delegation: { expiration: futureNs } },
          { delegation: { expiration: pastNs } }, // This one is expired
        ],
      }),
    };
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
    });
    expect(mockLogout).toHaveBeenCalled();
  });

  it("handles getDelegation() throwing an exception", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);

    const principal = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    const identity = {
      getPrincipal: () => principal,
      getDelegation: () => { throw new Error("corrupted delegation"); },
    };
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    // isDelegationFresh catches the error and returns false → logout
    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
    });
    expect(mockLogout).toHaveBeenCalled();
  });

  it("treats delegation expiring in the past as expired", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);

    // Expiration 1 second in the past — reliably expired
    const pastNs = BigInt(Date.now() - 1_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai", pastNs);
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
    });
    expect(mockLogout).toHaveBeenCalled();
  });

  it("treats delegation expiring far in the future as valid", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);

    // Expiration 1 hour in the future — reliably valid
    const futureNs = BigInt(Date.now() + 3_600_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai", futureNs);
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(true);
    });
  });
});

describe("AuthProvider — session-expired event", () => {
  it("logs out on aegis:session-expired custom event", async () => {
    makeClient();
    mockIsAuthenticated.mockResolvedValue(true);
    const futureNs = BigInt(Date.now() + 3_600_000) * BigInt(1_000_000);
    const identity = makeDelegationIdentity("rwlgt-iiaaa-aaaaa-aaaaa-cai", futureNs);
    mockGetIdentity.mockReturnValue(identity);

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onState={(s) => { captured = s; }} />
        </AuthProvider>
      );
    });

    await waitFor(() => expect(captured?.isAuthenticated).toBe(true));

    await act(async () => {
      window.dispatchEvent(new Event("aegis:session-expired"));
    });

    await waitFor(() => {
      expect(captured?.isAuthenticated).toBe(false);
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      "Session expired — please log in again", "error"
    );
  });
});
