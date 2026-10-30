import { challengeFor, randomToken } from "./pkce.ts";

// OAuth 2.0 authorization code flow with PKCE (S256) directly against Home Assistant. HA is the authorization server, this
// app a public client: client_id is the app's own URL (`<app_external_url>/`), the redirect target `<app_external_url>/auth/callback`
// lives on the same host, so HA does not need to fetch the client_id document. The access token lives in memory only
// (session.svelte.ts), the refresh token in localStorage (strict CSP: no inline scripts, no third-party origins).

const REFRESH_KEY = "gi.refresh_token";
const PENDING_KEY = "gi.oauth_pending";
export const CALLBACK_PATH = "auth/callback";

export type Tokens = { accessToken: string; expiresAt: number; refreshToken: string | null };
export type OAuthConfig = { haUrl: string; clientId: string; appUrl: string };
export class AuthError extends Error {
  constructor(
    readonly reason: "network" | "denied" | "state" | "rejected",
    message?: string,
  ) {
    super(message ?? reason);
  }
}

export const appUrlOf = (clientId: string) => clientId.replace(/\/$/, "");
export const redirectUri = (clientId: string) => `${appUrlOf(clientId)}/${CALLBACK_PATH}`;

const store = (area: "localStorage" | "sessionStorage") => {
  try {
    return globalThis[area];
  } catch {
    return undefined; // blocked storage: the session simply does not survive a reload
  }
};

export const storedRefreshToken = () => store("localStorage")?.getItem(REFRESH_KEY) ?? null;
export const saveRefreshToken = (token: string) => store("localStorage")?.setItem(REFRESH_KEY, token);
export const clearRefreshToken = () => store("localStorage")?.removeItem(REFRESH_KEY);

/** Redirects to Home Assistant. `returnTo` is the hash route to open afterwards. */
export async function startLogin(cfg: OAuthConfig, returnTo = "#/"): Promise<string> {
  const verifier = randomToken();
  const state = randomToken(24);
  store("sessionStorage")?.setItem(PENDING_KEY, JSON.stringify({ state, verifier, returnTo }));
  const url = new URL("auth/authorize", `${cfg.haUrl}/`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(cfg.clientId),
    response_type: "code",
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function tokenRequest(cfg: OAuthConfig, body: Record<string, string>, now: number): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetch(new URL("auth/token", `${cfg.haUrl}/`), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
    });
  } catch {
    // Also what a missing CORS header looks like to the page.
    throw new AuthError("network");
  }
  if (!res.ok) throw new AuthError("rejected", String(res.status));
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token) throw new AuthError("rejected", "no access_token");
  return {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 1800) * 1000,
    refreshToken: json.refresh_token ?? null,
  };
}

/** Handles `…/auth/callback?code&state`. Returns the hash route to open next. */
export async function finishLogin(cfg: OAuthConfig, search: string, now = Date.now()): Promise<{ tokens: Tokens; returnTo: string }> {
  const params = new URLSearchParams(search);
  const area = store("sessionStorage");
  const pending = JSON.parse(area?.getItem(PENDING_KEY) ?? "null") as { state: string; verifier: string; returnTo: string } | null;
  area?.removeItem(PENDING_KEY);
  if (params.get("error")) throw new AuthError("denied");
  const code = params.get("code");
  if (!pending || !code || params.get("state") !== pending.state) throw new AuthError("state");
  const tokens = await tokenRequest(cfg, { grant_type: "authorization_code", code, code_verifier: pending.verifier }, now);
  if (tokens.refreshToken) saveRefreshToken(tokens.refreshToken);
  return { tokens, returnTo: pending.returnTo };
}

export async function refresh(cfg: OAuthConfig, refreshToken: string, now = Date.now()): Promise<Tokens> {
  const tokens = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, now);
  // HA keeps the refresh token across refreshes; it only returns a new one on a code exchange.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export async function revoke(cfg: OAuthConfig, refreshToken: string): Promise<void> {
  try {
    await fetch(new URL("auth/revoke", `${cfg.haUrl}/`), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, action: "revoke" }),
    });
  } catch {
    // best effort: the token is dropped locally either way
  }
}
