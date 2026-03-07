// src/lib/auth.ts
export type PublicUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
};

export type LoginResponse = {
  accessToken: string;
  expiresAt: string; // FastAPI serializes datetime -> ISO string
  user: PublicUser;
};

const TOKEN_KEY = "cenith_access_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();

  // IMPORTANT: backend returns accessToken
  localStorage.setItem("accessToken", data.accessToken);
  return data;
}

export async function me(): Promise<PublicUser> {
  const token = getToken();
  if (!token) throw new Error("No token");

  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Auth check failed (${res.status})`);
  }

  const data = await res.json();
  return data.user as PublicUser;
}