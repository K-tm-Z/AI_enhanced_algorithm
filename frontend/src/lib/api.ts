// src/lib/api.ts
import { getToken, clearToken } from "./auth";

export async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    clearToken();
  }

  return res;
}

export async function apiJson(input: RequestInfo, init: RequestInit = {}) {
  const res = await apiFetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text || `Request failed with ${res.status}`;
    try {
      const data = JSON.parse(text);
      message = data?.detail || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return text ? JSON.parse(text) : null;
}

export async function apiFormData(
  input: RequestInfo,
  options: { formData: FormData; init?: RequestInit } = { formData: new FormData() }
) {
  const { formData, init } = options;
  const res = await apiFetch(input, {
    ...(init || {}),
    method: init?.method || "POST",
    body: formData,
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text || `Request failed with ${res.status}`;
    try {
      const data = JSON.parse(text);
      message = data?.detail || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return text ? JSON.parse(text) : null;
}