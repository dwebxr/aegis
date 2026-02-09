"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { AuthClient } from "@dfinity/auth-client";
import type { Identity } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { getInternetIdentityUrl, getDerivationOrigin } from "@/lib/ic/agent";
import { useNotify } from "./NotificationContext";

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

  useEffect(() => {
    AuthClient.create().then(async (client) => {
      setAuthClient(client);
      const authed = await client.isAuthenticated();
      setIsAuthenticated(authed);
      if (authed) {
        const id = client.getIdentity();
        setIdentity(id);
        setPrincipal(id.getPrincipal());
      }
      setIsLoading(false);
    }).catch((err: unknown) => {
      console.error("[auth] Initialization failed:", err instanceof Error ? err.message : "unknown");
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
