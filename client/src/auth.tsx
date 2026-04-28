import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
} from "./api";

export type Household = {
  id: number;
  name: string;
  invite_code: string;
  members: { id: number; username: string; is_admin: boolean }[];
};

export type User = {
  id: number;
  username: string;
  is_admin: boolean;
  household: Household;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const { user: u } = await api<{ user: User }>("/api/me");
    setUser(u);
  }, []);

  const refresh = useCallback(async () => {
    const t = getToken();
    const rt = getRefreshToken();
    if (!t && !rt) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      await refreshUser();
    } catch {
      setToken(null);
      setRefreshToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync auth state across browser tabs: a logout/login in one tab updates
  // localStorage, which fires `storage` in every other tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key && e.key !== "envelope_budget_token" && e.key !== "envelope_budget_refresh") {
        return;
      }
      const t = getToken();
      const rt = getRefreshToken();
      if (!t && !rt) {
        setUser(null);
        setLoading(false);
      } else {
        void refresh();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const { token, refreshToken, user: u } = await api<{
      token: string;
      refreshToken: string;
      user: User;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(token);
    setRefreshToken(refreshToken);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    const rt = getRefreshToken();
    void api("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify(rt ? { refreshToken: rt } : {}),
    }).catch(() => {
      /* ignore network errors on logout */
    });
    setToken(null);
    setRefreshToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      refreshUser,
      logout,
    }),
    [user, loading, login, refreshUser, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
