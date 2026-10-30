// The context the server injected into index.html (see src/auth/context.ts). Falls back to ingress mode in the Vite dev
// server, where no injection happens and the dev proxy talks to the ingress listener.
export type AppContext = {
  mode: "ingress" | "external";
  basePath: string;
  haUrl: string | null;
  clientId: string | null;
};

const FALLBACK: AppContext = { mode: "ingress", basePath: "/", haUrl: null, clientId: null };

export function readContext(doc: Pick<Document, "getElementById"> = document): AppContext {
  try {
    const raw = doc.getElementById("app-context")?.textContent;
    return raw ? { ...FALLBACK, ...(JSON.parse(raw) as Partial<AppContext>) } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
