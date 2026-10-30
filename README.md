# Garmin Insights – Home-Assistant-App

<img src="garmin-insights/web/static/favicon.svg" alt="Garmin Insights" width="96" align="right">

[![CI](https://github.com/twostone/garmin-insights/actions/workflows/ci.yml/badge.svg)](https://github.com/twostone/garmin-insights/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/twostone/garmin-insights.svg)](https://github.com/twostone/garmin-insights/releases)
[![License](https://img.shields.io/github/license/twostone/garmin-insights.svg)](LICENSE)

Spiegelt die Daten der **Garmin Connect Personal API** jedes Home-Assistant-Benutzers lokal und wertet sie aus. Dazu gibt es
dreierlei, alles auf derselben Datenbasis:

- **PWA** mit Dashboards: Fitness/Ermüdung/Form, Wochenumfang, Aktivitäten mit Karte, Zeitreihen, Zonen, Runden und
  Kraftsätzen, Trends, Gesundheit (Ruhepuls, HRV, Schlaf). Deutsch und Englisch. Erreichbar über die Seitenleiste von Home
  Assistant (Ingress) und über eine eigene Domain (installierbar).
- **REST-API** unter `/api`.
- **MCP-Server** unter `/mcp`, mit dem ein KI-Assistent wie Claude die Daten im Detail analysiert (kuratierte, schreibgeschützte Tools).

Jeder Benutzer hinterlegt seinen eigenen Garmin-Key; die Daten sind nach Home-Assistant-Benutzer getrennt. Die Anleitung für
Anwender steht in [`garmin-insights/DOCS.md`](garmin-insights/DOCS.md), Hinweise für Entwickler in [`AGENTS.md`](AGENTS.md).

## Installation

Voraussetzung: Home Assistant **2026.10.1 oder neuer** mit App-Store (Home Assistant OS oder Supervised), amd64 oder arm64.

1. In Home Assistant: *Einstellungen → Apps → App-Store → ⋮ → Repositories* und eintragen:

   ```
   https://github.com/twostone/garmin-insights
   ```

2. „Garmin Insights“ installieren und starten, danach „In Seitenleiste anzeigen“.
3. In der App den Garmin-Key eintragen (siehe DOCS.md). Für den Zugang von außen die Optionen `ha_external_url` und
   `app_external_url` setzen und einen TLS-Reverse-Proxy vor Port 8100 stellen.

Home Assistant lädt ein fertiges Image von `ghcr.io/twostone/garmin-insights`; die Daten liegen in `/data` und sind in
Backups enthalten.

## Entwicklung

Node 24 (CI und Image) oder neuer, npm 11. Alles im Ordner `garmin-insights/`:

```
npm ci
npm test                 # Backend- und Analytics-Tests (node:test)
npx tsc --noEmit         # Typprüfung
npm run check            # svelte-check
npm run build            # Frontend nach dist/

# lokal mit Demo-Daten, ohne Garmin-Konto und ohne Home Assistant:
DATA_DIR=./data/demo npm run seed:demo
DATA_DIR=./data/demo INGRESS_ONLY_IP= DEV_USER_ID=demo npm start     # http://localhost:8099
```

Aufbau, Konventionen (Conventional Commits auf Deutsch, Logging, i18n, Migrationen) und bewusste Entscheidungen stehen in
[`AGENTS.md`](AGENTS.md). Die Garmin-Endpunkte und offene Fragen zur API dokumentiert [`docs/garmin-api.md`](docs/garmin-api.md).

## Lizenz

Apache-2.0, siehe [`LICENSE`](LICENSE).
