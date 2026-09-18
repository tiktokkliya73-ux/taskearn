"use client";

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Client fetch wrapper — always relative paths, same-origin credentials.
 * Throws ApiClientError with the server's { error } message on non-2xx.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    credentials: "same-origin",
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-json */
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiClientError(message, res.status);
  }
  return data as T;
}
