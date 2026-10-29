"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, type SessionUser } from "./api";

const TOKEN_KEY = "counterfeit-ledger-token";

type SessionContextValue = {
  ready: boolean;
  token: string | null;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    const savedToken = window.localStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      setReady(true);
      return () => {
        active = false;
      };
    }

    void apiRequest<SessionUser>("/auth/me", savedToken)
      .then((profile) => {
        if (active) {
          setToken(savedToken);
          setUser(profile);
        }
      })
      .catch(() => window.localStorage.removeItem(TOKEN_KEY))
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  async function login(email: string, password: string) {
    const result = await apiRequest<{
      access_token: string;
      user: SessionUser;
    }>("/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    window.localStorage.setItem(TOKEN_KEY, result.access_token);
    setToken(result.access_token);
    setUser(result.user);
  }

  function logout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  return (
    <SessionContext.Provider value={{ ready, token, user, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}