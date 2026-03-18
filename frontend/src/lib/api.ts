export function getStoredToken() {
  return (
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getStoredToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response;
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await authFetch(url);
  return response.json();
}

export async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return response.json();
}

export async function sendFormData<T>(url: string, method: string, formData: FormData): Promise<T> {
  const response = await authFetch(url, {
    method,
    body: formData,
  });

  return response.json();
}
