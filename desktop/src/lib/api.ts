import { env } from "./env";
import { supabase } from "./supabase";

/** Error thrown for any failed API call, carrying the server's error code and field messages. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(env.apiUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function send(path: string, opts: RequestOptions, token: string | null) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "Can't reach the ODDLY server. Check your connection and that the API is running.");
  }
}

/** Calls the ODDLY API with the current Supabase access token, refreshing it once on 401. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let token = opts.anonymous ? null : await accessToken();
  let res = await send(path, opts, token);

  if (res.status === 401 && !opts.anonymous) {
    const { data } = await supabase.auth.refreshSession();
    token = data.session?.access_token ?? null;
    if (token) res = await send(path, opts, token);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "http_error",
      e?.message ?? `Request failed (${res.status}).`,
      e?.fields ?? {},
    );
  }
  return body as T;
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
