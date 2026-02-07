"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { AuthClient } from "@dfinity/auth-client";
import type { Identity } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { getInternetIdentityUrl } from "@/lib/ic/agent";

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
    }).catch((err) => {
      console.error("AuthClient.create() failed:", err);
      setIsLoading(false);
    });
  }, []);

  const login = useCallback(async () => {
    if (!authClient) return;
    await new Promise<void>((resolve, reject) => {
      authClient.login({
        identityProvider: getInternetIdentityUrl(),
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

  return (
    <AuthContext.Provider value={{ isAuthenticated, identity, principal, principalText, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
