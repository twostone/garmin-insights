# AGENTS.md

Anleitung für Coding-Agents und Mitwirkende. Kurz halten, bei Änderungen an Architektur oder Regeln mitpflegen.

## Projekt

Home-Assistant-App (früher „Add-on“), die die Daten der **Garmin Connect Personal API** jedes HA-Users lokal spiegelt und
auswertet. Drei Oberflächen auf derselben Datenbasis: **PWA** (Dashboards), **REST-API** und **MCP-Server** (Detailanalysen
durch LLMs). Pro HA-User ein eigener Garmin-Key, Daten strikt nach HA-User-ID getrennt. Grundsatz: **KISS und YAGNI**.
Nichts bauen, was nicht ausdrücklich gebraucht wird; etablierte Bibliotheken vor Eigenbau.

## Layout

```
repository.yaml          HA-App-Repository
README.md, LICENSE       Installation, Entwicklung (öffentlich); Apache-2.0
AGENTS.md                diese Datei
docs/                    garmin-api.md (Spike: Endpunkte, Limits), garmin-personal-api.openapi.json (Garmins Spec, Quelle für schema.d.ts)
release-please-config.json, .release-please-manifest.json   Release-Automatik (Version, Changelog)
.github/workflows/       ci.yml (Tests, Docker-Build, Smoke-Test), release.yml (Release Please, Image), lint-pr-title.yml
renovate.json            hält Actions, npm und Docker-Basisimage aktuell (gruppierte PRs)
garmin-insights/         die App (Docker-Build-Kontext); Ordnername ≠ Slug (`garmin_insights`, nie ändern)
  config.yaml            App-Konfiguration (Version pflegt Release Please); translations/{de,en}.yaml = Optionsnamen
  Dockerfile             zweistufig, node:24-alpine; DOCS.md = Anleitung in der HA-Oberfläche
  src/                   Backend: Hono + node:sqlite
    server.ts            Start: Optionen, DB, zwei Listener
    listeners/           ingress.ts (:8099), external.ts (:8100), shared.ts (Logging, Frontend + Kontext-Injection)
    auth/                ha-token.ts (HA-WebSocket auth/current_user), resource-metadata.ts, context.ts (UI-Kontext, CSP)
    api/                 REST (`@hono/zod-openapi`), Typ `AppType` für den Client des Frontends
    mcp/                 MCP-Server (/mcp, nur extern): server.ts, tools.ts, prompts.ts
    garmin/              client.ts (Token-Tausch, Requests, Retry), keys.ts, schema.d.ts (generiert aus docs/*.openapi.json)
    sync/worker.ts       Sync pro User, Backfill, Fortschritt
    fit/parse.ts         FIT -> Samples, Runden, Kraftsätze
    analytics/           reine Funktionen (Load, PMC, Zonen, Volumen, Best Efforts, …), kein DB- und kein Netzzugriff
    repo/                Datenzugriff; jede Methode nimmt `userId` als ersten Parameter
    ha/notify.ts         Benachrichtigungen über den Supervisor
    db.ts, crypto.ts, options.ts, log.ts
  web/                   Frontend: SvelteKit 2 (Svelte 5) als SPA, Hash-Router, Paraglide (messages/{de,en}.json)
  test/                  Tests (node:test)
```

## Befehle (in `garmin-insights/`)

```
npm ci
npm test                       # alle Tests (node:test, app.request, SDK-Client mit In-Memory-Transport)
npx tsc --noEmit               # Typprüfung Backend
npm run check                  # Paraglide-Compile + svelte-check Frontend
npm run build                  # Frontend nach dist/ (wird von den Listenern ausgeliefert)
npm run garmin:types           # schema.d.ts neu aus docs/garmin-personal-api.openapi.json erzeugen
DATA_DIR=./data INGRESS_ONLY_IP= npm start   # lokal; mit HA_EXTERNAL_URL + APP_EXTERNAL_URL auch der externe Listener
npm run dev:web                # Vite-Dev-Server, /api geht per Proxy an :8099
```

Vor jedem Commit: Tests, `tsc`, `check` und `build` müssen sauber durchlaufen (genau das prüft die CI).

## Architektur und bewusste Entscheidungen

- **Zwei Listener, der Port bestimmt den Modus** (nie Header). `:8099` ist `ingress_port`, nicht gemappt, IP-Sperre auf
  `172.30.32.2` (fail-closed, **nie lockern**); nur dort werden `X-Remote-User-*` und `X-Ingress-Path` gelesen. `:8100` ist
  gemappt (TLS-Reverse-Proxy davor), liest diese Header **nie** und verlangt für `/api` und `/mcp` ein HA-Bearer-Token.
  Listener setzen `c.var.access` und `c.var.user`; die gemeinsame App liest nur diese Variablen.
- **HA ist Authorization Server, die App Resource Server.** SPA: Authorization Code + PKCE direkt gegen HA, Access-Token nur im
  Speicher, Refresh-Token in `localStorage`. Server: Token per HA-WebSocket `auth/current_user` prüfen (Cache nach
  `sha256(token)`, ≤ 60 s und ≤ `exp`). **Jedes gültige HA-Token wird akzeptiert** (auch Long-Lived), die Audience wird nicht
  geprüft, weil HA-Tokens keine haben (dokumentiert in DOCS.md). System-User (ohne Credentials) werden abgelehnt. HA nicht
  erreichbar = 5xx, nie anonym.
- **Frontend**: SPA mit **Hash-Router** (`router.type: "hash"`), weil der Ingress-Pfad `/api/hassio_ingress/<token>/` wechselt.
  Hono macht SvelteKits root-absolute URLs relativ und injiziert `<base href>` und den Kontext als JSON-Script-Tag
  (`auth/context.ts`), damit die CSP ohne `unsafe-inline` auskommt (Inline-Start-Skripte per Hash). Service Worker und
  Manifest nur im Modus `external`; unter Ingress sind sie 404. Links im Frontend immer über `resolve()`/`#/…`, API-URLs relativ.
- **Daten**: lokaler Spiegel in SQLite (+ FIT-Dateien unter `/data/fit/<user>/`). Mandantentrennung: `user_id` ist erste
  Spalte jedes Schlüssels, jede Repo-Methode verlangt `userId`; Tests prüfen die Isolation.
- **Garmin-Key** wird in der UI eingegeben, sofort per Token-Tausch geprüft und mit AES-256-GCM verschlüsselt
  (Master-Key `/data/secret.key`, 0600, AAD = User-ID). Nie loggen, nie zurückgeben.
- **Analytics sind reine Funktionen** (Eingabe: Samples/Zahlen/Schwellen, Ausgabe: Zahlen); Referenzwerte stehen in den Tests.
- **MCP**: nur kuratierte Tools (kein SQL), zod-Schemas, strukturierte Outputs, `readOnlyHint` (außer `trigger_sync`), pro
  Request ein neuer Server (stateless), auf den User aus dem Token gescopt. Ausgaben englisch, metrische Einheiten.
  **Das MCP-SDK v2 ist exakt gepinnt** (`@modelcontextprotocol/server`/`hono`/`client`); Updates bewusst und einzeln.
- **SvelteKit bleibt auf 2.x**, solange `@vite-pwa/sveltekit` Kit 3 nicht unterstützt (adapter-static 3.x dazu).
- **TypeScript < 7** (svelte-check), `tsx` bleibt Runtime-Dependency (Container startet per `node --import tsx`).

## CI und Releases

- **Commits nach Conventional Commits:** `typ(bereich): Beschreibung`, deutscher Text. Nur `feat` (Minor), `fix` und `perf`
  (Patch) sowie `feat!:`/`BREAKING CHANGE:` lösen einen Release aus. `docs`, `ci`, `chore`, `refactor`, `test`, `build`
  erscheinen nicht im Changelog. Vor 1.0 erhöht ein Breaking Change nur die Minor-Version.
- **Release Please** (`release.yml`) sammelt die Commits in einem Release-PR („chore(main): release x.y.z“), der
  `garmin-insights/config.yaml` (Zeile mit `# x-release-please-version`), `package.json`, `package-lock.json` und `CHANGELOG.md`
  ändert. Mergen des PR ist der Release (Tag `vX.Y.Z`, GitHub-Release, dann Tests und Image-Build). **Version, Tag und Changelog
  nie von Hand ändern**, die Annotation in `config.yaml` nicht entfernen.
- **Actions nur mit vollem Commit-SHA pinnen** (Kommentar mit Version), Renovate aktualisiert sie. Rechte in Workflows minimal.
- **`image:` in `config.yaml`** steht ohne Tag (`ghcr.io/twostone/garmin-insights`), HA hängt `version` als Tag an.
- **Add-on-Build:** Kein `build.yaml`, kein `BUILD_FROM` (seit Supervisor 2026.04 obsolet). Das Frontend wird auf der
  Builder-Architektur gebaut (`--platform=$BUILDPLATFORM`).
- Der CI-Smoke-Test prüft beide Listener, `/mcp` ohne Token (401 mit `WWW-Authenticate`) und
  `/.well-known/oauth-protected-resource`.

## Regeln beim Ändern

- **Frontend-URLs immer relativ** (`api/...`, nie `/api/...`), Navigation per Hash-Router.
- **Datenbank nur über Migrationen:** in `src/db.ts` an `MIGRATIONS` **anhängen**, nie ändern oder umsortieren
  (`PRAGMA user_version`). Neue Migrationen mit Test gegen eine DB im alten Stand.
- **Nutzertrennung:** Jede neue Tabelle mit Nutzerdaten hat `user_id` im Schlüssel und `ON DELETE CASCADE` auf `users`; jede
  Repo-Methode nimmt `userId` zuerst; ein Isolationstest gehört dazu.
- **Das Rad nicht neu erfinden:** erst prüfen, ob eine etablierte, gepflegte Bibliothek es kann; Eigenbau mit Begründung im
  Kommentar (`log.ts`: kein Logger liefert logfmt mit Ortszeit/Offset und HA-Stufe; `ha-token.ts`: HA bietet nur den
  WebSocket-Weg). Neue Abhängigkeiten nur mit Grund (jede ändert `package-lock.json` und den Image-Build).
- **Clean Code** zusätzlich zu KISS/YAGNI: sprechende Namen, kleine Funktionen, benannte Konstanten statt Magic Numbers,
  Kommentare erklären das Warum, Fehler nie still verschlucken, ein Ort pro Zuständigkeit.
- **APIs vor der Nutzung gegen die aktuelle Dokumentation prüfen** (HA, Hono, SvelteKit, MCP-SDK, Garmin-Spec).
- **Logging** (`log.ts`): kein `console.*`, sondern `const log = logger("modul")`; `log.info("ereignis_snake_case", { feld: wert })`,
  logfmt, Stufe aus der App-Option `log_level`. **Nie ins Log:** Tokens, Garmin-Keys, vollständige URLs, Query-Strings,
  Namen/E-Mail/IDs aus den User-Headern oder Tokens, Aktivitätsnamen, GPS-Daten. Tests fangen Zeilen mit `setLogSink` ab.
- **UI-Texte nur über i18n** (`messages/de.json`, `messages/en.json`, Paraglide `m.…()`), keine Literale in Svelte-Dateien.
  Code und Kommentare englisch. MCP-Ausgaben englisch. Metrische Einheiten. Bedienelemente mindestens 44 px, echte
  `<button>`/`<a>`, natives `<dialog>`, kein `alert()`/`confirm()` (zweistufige Bestätigung im UI).
- **Tests** für neue Backend-Logik (`node:test`, `app.request`); Netzwerkcode gegen lokale Testserver, nie gegen das Internet.
  Analytics gegen Referenzwerte (TDD). FIT-Fixtures werden mit dem `Encoder` aus `@garmin/fitsdk` erzeugt.

## Stand und offene Punkte

Siehe `docs/garmin-api.md` (Garmin-Endpunkte, unbekannte Limits) und die Abschnitte „Offen“ in DOCS.md/README.md. Nicht am
echten System geprüft: HA-OAuth-Flow der SPA (CORS von `/auth/token`), Claude-Connector gegen HA (Spike 2b, manuell),
Garmin-Live-Daten (Limits, Tiefe der Historie, ob FIT-Dateien Felder wie VO2max enthalten).
