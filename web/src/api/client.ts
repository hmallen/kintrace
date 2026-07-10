import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage?: string;

  constructor(status: number, serverMessage: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

// Single source of truth for the backend base URL (empty = same origin).
// Consumed here and by media/thumbnail/upload URL builders elsewhere.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (init?.body != null && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let serverMessage: string | undefined;
    try {
      const body: unknown = await res.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'string'
      ) {
        serverMessage = (body as { error: string }).error;
      }
    } catch {
      // body was not JSON; fall back to the generic message
    }
    throw new ApiError(res.status, serverMessage, serverMessage ?? `HTTP ${res.status}`);
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await request(path, init);
  return schema.parse(await res.json());
}

export async function apiSend(path: string, init?: RequestInit): Promise<void> {
  await request(path, init);
}
