import { hc } from "hono/client";
import type { AppType } from "$server/api/index.ts";
import { session } from "./session.svelte.ts";

// Typed API client (Hono RPC) with a relative base: the app lives under a changing ingress prefix, so the URL is resolved
// against <base href>. In external mode every call carries the Home Assistant access token; a 401 triggers one refresh.
async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = async () => {
    const headers = new Headers(init?.headers);
    const token = await session.accessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const res = await send();
  if (res.status !== 401 || !session.external) return res;
  return send(); // accessToken() renewed the token if it was the cause; if not, the caller sees the 401
}

export const api = hc<AppType>(new URL("api/", document.baseURI).href, { fetch: authedFetch });

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`${status} ${code}`);
  }
}

/** Parsed JSON of a successful response; throws ApiError (with the server's error code) otherwise. */
export async function unwrap<T>(promise: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): Promise<T> {
  const res = await promise;
  if (res.ok) return (await res.json()) as T;
  let code = "error";
  try {
    code = ((await res.json()) as { error?: string }).error ?? code;
  } catch {
    // body was not JSON
  }
  throw new ApiError(res.status, code);
}
