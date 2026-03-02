"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { AuthClient } from "@dfinity/auth-client";
import type { Identity } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { getInternetIdentityUrl, getDerivationOrigin } from "@/lib/ic/agent";
import { useNotify } from "./NotificationContext";
import { errMsg } from "@/lib/utils/errors";

interface DelegationChain {
  delegations: Array<{ delegation: { expiration: bigint } }>;
}

interface IdentityWithDelegation extends Identity {
  getDelegation(): DelegationChain;
}

function hasDelegation(id: Identity): id is IdentityWithDelegation {
  return typeof (id as IdentityWithDelegation).getDelegation === "function";
}

/** Check if a DelegationIdentity's chain is still valid (not expired). */
function isDelegationFresh(identity: Identity): boolean {
  if (!hasDelegation(identity)) return true;
  try {
    const chain = identity.getDelegation();
    const nowNs = BigInt(Date.now()) * BigInt(1_000_000);
    for (const { delegation } of chain.delegations) {
      if (delegation.expiration < nowNs) return false;
    }
    return true;
  } catch (err) {
    console.warn("[auth] Failed to check delegation freshness, treating as expired:", err);
    return false;
  }
}

interface AuthState {
  isAuthenticated: boolean;
  identity: Identity | null;
  principal: Principal | null;
  principalText: string;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  identity: null,
  principal: null,
  principalText: "",
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotify();
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Test-only mock: allows E2E tests to simulate auth without real II.
  // Dead-code eliminated in production builds via NODE_ENV check.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as Window & { __AEGIS_MOCK_AUTH?: boolean; __AEGIS_MOCK_PRINCIPAL?: string };
    if (process.env.NODE_ENV !== "production" && w.__AEGIS_MOCK_AUTH !== undefined) {
      const isAuth = !!w.__AEGIS_MOCK_AUTH;
      setIsAuthenticated(isAuth);
      if (isAuth) {
        const mockPrincipalText = w.__AEGIS_MOCK_PRINCIPAL || "2vxsx-fae";
        setPrincipal(Principal.fromText(mockPrincipalText));
      }
      setIsLoading(false);
      return;
    }

    AuthClient.create().then(async (client) => {
      setAuthClient(client);
      const authed = await client.isAuthenticated();
      if (authed) {
        const id = client.getIdentity();
        if (!isDelegationFresh(id)) {
          console.warn("[auth] Delegation expired — logging out");
          await client.logout();
          setIsAuthenticated(false);
          addNotification("Session expired — please log in again", "error");
        } else {
          setIsAuthenticated(true);
          setIdentity(id);
          setPrincipal(id.getPrincipal());
        }
      } else {
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    }).catch((err: unknown) => {
      console.error("[auth] Initialization failed:", errMsg(err));
      addNotification("Authentication system failed to initialize", "error");
      setIsLoading(false);
    });
  }, [addNotification]);

  const login = useCallback(async () => {
    if (!authClient) return;
    await new Promise<void>((resolve, reject) => {
      authClient.login({
        identityProvider: getInternetIdentityUrl(),
        derivationOrigin: getDerivationOrigin(),
        maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1_000_000_000),
        onSuccess: () => {
          const id = authClient.getIdentity();
          setIdentity(id);
          setPrincipal(id.getPrincipal());
          setIsAuthenticated(true);
          resolve();
        },
        onError: (err) => {
          reject(new Error(err));
        },
      });
    });
  }, [authClient]);

  // Listen for session-expired events from IC call handlers in other contexts
  useEffect(() => {
    const handler = () => {
      if (!authClient) return;
      authClient.logout().then(() => {
        setIdentity(null);
        setPrincipal(null);
        setIsAuthenticated(false);
        addNotification("Session expired — please log in again", "error");
      }).catch((err: unknown) => {
        console.warn("[auth] Session logout failed:", errMsg(err));
      });
    };
    window.addEventListener("aegis:session-expired", handler);
    return () => window.removeEventListener("aegis:session-expired", handler);
  }, [authClient, addNotification]);

  const logout = useCallback(async () => {
    if (!authClient) return;
    await authClient.logout();
    setIdentity(null);
    setPrincipal(null);
    setIsAuthenticated(false);
  }, [authClient]);

  const principalText = principal ? principal.toText() : "";

  const value = useMemo(() => ({
    isAuthenticated, identity, principal, principalText, isLoading, login, logout,
  }), [isAuthenticated, identity, principal, principalText, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
