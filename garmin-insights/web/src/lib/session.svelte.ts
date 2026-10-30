import { AuthError, CALLBACK_PATH, clearRefreshToken, finishLogin, refresh, revoke, startLogin, storedRefreshToken, type OAuthConfig, type Tokens } from "./auth.ts";
import { readContext, type AppContext } from "./context.ts";

// Reactive sign-in state. Ingress mode needs no sign-in (Home Assistant already did it). External mode: OAuth against HA,
// access token in memory only, refreshed shortly before the 30 minute expiry.

const REFRESH_MARGIN_MS = 60_000;

type Status = "loading" | "anonymous" | "authenticated";

class Session {
  context: AppContext = $state(readContext());
  status: Status = $state("loading");
  error: AuthError["reason"] | null = $state(null);
  private tokens: Tokens | null = null;
  private refreshing: Promise<Tokens | null> | null = null;

  get external() {
    return this.context.mode === "external";
  }
  private get config(): OAuthConfig | null {
    const { haUrl, clientId } = this.context;
    return haUrl && clientId ? { haUrl, clientId, appUrl: clientId.replace(/\/$/, "") } : null;
  }

  /** Called once by the root layout. */
  async init(): Promise<void> {
    if (!this.external) return void (this.status = "authenticated");
    const cfg = this.config;
    if (!cfg) return void (this.status = "anonymous");
    try {
      if (location.pathname.endsWith(`/${CALLBACK_PATH}`)) {
        const { returnTo } = await finishLogin(cfg, location.search);
        // Reload at the app root instead of routing client-side: SvelteKit derived its base from /auth/callback ("/auth"),
        // so every link and goto would point below /auth. The refresh token is stored; init() renews it after the reload.
        location.replace(new URL(`./${returnTo}`, document.baseURI).href);
        return;
      }
      const stored = storedRefreshToken();
      this.status = stored && (await this.renew(stored)) ? "authenticated" : "anonymous";
    } catch (e) {
      this.error = e instanceof AuthError ? e.reason : "network";
      history.replaceState(null, "", new URL("./", document.baseURI));
      this.status = "anonymous";
    }
  }

  async login(): Promise<void> {
    const cfg = this.config;
    if (cfg) location.assign(await startLogin(cfg, location.hash || "#/"));
  }

  async logout(): Promise<void> {
    const cfg = this.config;
    const token = this.tokens?.refreshToken ?? storedRefreshToken();
    this.tokens = null;
    clearRefreshToken();
    this.status = "anonymous";
    // The offline copies hold this user's data: gone with the sign-out.
    try {
      await Promise.all(["gi-api", "gi-pages"].map((name) => caches.delete(name)));
    } catch {
      // no Cache API: nothing to clear
    }
    if (cfg && token) await revoke(cfg, token);
  }

  private async renew(refreshToken: string): Promise<Tokens | null> {
    const cfg = this.config;
    if (!cfg) return null;
    this.refreshing ??= refresh(cfg, refreshToken)
      .then((t) => (this.tokens = t))
      .catch((e) => {
        // A rejected refresh token is gone for good; a network error may be temporary and keeps it.
        if (e instanceof AuthError && e.reason === "rejected") clearRefreshToken();
        this.tokens = null;
        return null;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** Bearer token for an API call (external mode); null in ingress mode or when signed out. */
  async accessToken(): Promise<string | null> {
    if (!this.external) return null;
    const t = this.tokens;
    if (t && t.expiresAt - Date.now() > REFRESH_MARGIN_MS) return t.accessToken;
    const renewed = await this.renew(t?.refreshToken ?? storedRefreshToken() ?? "");
    if (!renewed) this.status = "anonymous";
    return renewed?.accessToken ?? null;
  }
}

export const session = new Session();
