const TOKEN_KEY = "envelope_budget_token";
const REFRESH_KEY = "envelope_budget_refresh";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        token?: string;
        refreshToken?: string;
      };
      if (typeof data.token !== "string" || typeof data.refreshToken !== "string") {
        return false;
      }
      setToken(data.token);
      setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const skipRefreshRetry =
    path === "/api/auth/refresh" ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/register";

  const run = async (): Promise<Response> => {
    const token = getToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    };
    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }
    return fetch(path, { ...options, headers });
  };

  let res = await run();
  if (res.status === 401 && !skipRefreshRetry) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      res = await run();
    }
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. an HTML 502 page from a reverse proxy);
      // fall through and surface the HTTP status instead of a parse error.
    }
  }
  if (!res.ok) {
    const errField = (data as { error?: unknown } | null)?.error;
    const msg = typeof errField === "string" ? errField : res.statusText;
    throw new Error(msg || "Request failed");
  }
  return data as T;
}
