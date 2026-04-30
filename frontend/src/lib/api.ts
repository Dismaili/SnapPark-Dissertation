import { tokenStore } from "./auth";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message || `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

const buildHeaders = (init: HeadersInit | undefined, auth: boolean) => {
  const headers = new Headers(init);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = tokenStore.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

export async function apiFetch<T = unknown>(
  path: string,
  { body, auth = true, headers, ...rest }: FetchOptions = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: buildHeaders(headers, auth),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data,
      (data as { error?: string })?.error || `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export async function apiUploadImage<T = unknown>(
  path: string,
  file: File,
): Promise<T> {
  const form = new FormData();
  form.append("image", file);

  const headers = new Headers();
  const token = tokenStore.getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data,
      (data as { error?: string })?.error || `Upload failed (${res.status})`,
    );
  }
  return data as T;
}

const safeJsonParse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
