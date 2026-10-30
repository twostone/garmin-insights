import { readFileSync } from "node:fs";

// Version from package.json (Release Please bumps it together with config.yaml).
export const APP_VERSION: string | undefined = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
})();
