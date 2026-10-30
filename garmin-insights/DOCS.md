# Garmin Insights

Die App spiegelt die Daten deines Garmin-Kontos (Personal API) lokal in Home Assistant und wertet sie aus: Dashboards als
PWA, eine REST-API und ein MCP-Server, über den ein KI-Assistent (z. B. Claude) deine Trainings- und Gesundheitsdaten im Detail
analysieren kann. Jeder Home-Assistant-Benutzer hinterlegt seinen **eigenen** Garmin-Key; die Daten sind strikt nach
Benutzer getrennt.

Voraussetzung: **Home Assistant 2026.10.1 oder neuer** (OAuth mit PKCE, Client-ID-Metadaten und Loopback-Weiterleitungen).

## Zugänge

| Zugang | Wie | Anmeldung |
|---|---|---|
| **Seitenleiste** (Ingress) | Eintrag „Garmin Insights“ in Home Assistant | keine, Home Assistant hat dich schon angemeldet |
| **Eigene Domain** (Port 8100) | PWA im Browser, installierbar; MCP unter `/mcp` | Anmeldung bei Home Assistant (OAuth) |

Port 8100 ist nur aktiv, wenn beide Optionen `ha_external_url` und `app_external_url` gesetzt sind. Die App spricht auf Port 8100
reines HTTP: Setze **einen Reverse-Proxy mit TLS** davor (HTTPS ist für OAuth, den Service Worker und die Installation als
PWA Pflicht). Den Port 8099 (Ingress) erreicht nur der Supervisor.

## Einrichtung

1. App installieren, starten, „In Seitenleiste anzeigen“.
2. **Garmin-Key erzeugen:** in Garmin Connect (Browser) unter *Einstellungen → Personal API* einen Key anlegen, Laufzeit wählen
   (30 Tage bis 1 Jahr) und den Key sofort kopieren, er wird nur einmal angezeigt.
3. In der App unter *Einstellungen → Garmin-Key* einfügen. Die App prüft den Key sofort bei Garmin, speichert ihn
   AES-256-verschlüsselt (Schlüssel in `/data/secret.key`) und zeigt ihn nie wieder an. Optional das Ablaufdatum eintragen: sieben
   Tage vorher gibt es eine Meldung in der App und eine Benachrichtigung in Home Assistant.
4. Der erste Sync lädt die **komplette Historie**, neueste Daten zuerst. Der Fortschritt steht oben in der App. Das kann
   bei vielen tausend Aktivitäten eine Weile dauern (Garmins Limits sind nicht dokumentiert, die App bremst sich selbst).

Danach holt die App neue Daten beim Öffnen, im eingestellten Intervall (`sync_interval_minutes`, Standard 30) und auf Knopfdruck.

## Optionen

| Option | Bedeutung |
|---|---|
| `log_level` | `debug`, `info`, `warning`, `error` |
| `ha_external_url` | Öffentliche HTTPS-URL von Home Assistant, z. B. `https://ha.example.com` |
| `app_external_url` | Öffentliche HTTPS-URL, unter der der Reverse-Proxy Port 8100 anbietet, z. B. `https://garmin.example.com` |
| `sync_interval_minutes` | Sync-Intervall, 5 bis 1440 |

### Reverse-Proxy

Leite `app_external_url` unverändert (kein Unterpfad) an `http://<home-assistant>:8100` weiter, `Host` und `X-Forwarded-*`
durchreichen, WebSocket nicht nötig. Beispiel nginx:

```
server {
  listen 443 ssl;
  server_name garmin.example.com;
  location / { proxy_pass http://127.0.0.1:8100; proxy_set_header Host $host; proxy_buffering off; }
}
```

`proxy_buffering off` ist für MCP (Streamable HTTP, Server-Sent Events) wichtig.

Home Assistant muss unter `ha_external_url` aus dem Browser erreichbar sein und Anfragen der App-Domain an `/auth/token`
zulassen (CORS), sonst schlägt die Anmeldung der PWA im Browser fehl (siehe „Offen“).

## Auswertungen

Alle Sportarten werden erfasst, auch Krafttraining (Sätze, Wiederholungen, Gewicht aus den Garmin-Dateien).

- **Belastung:** TRIMP (Herzfrequenz, für alles), hrTSS, rTSS (Laufen, braucht die Schwellen-Pace), Power-TSS mit NP und IF (Rad,
  braucht die FTP). Die Schwellen kommen aus Garmin oder werden in den Einstellungen überschrieben und gelten **ab einem
  Datum**: vergangene Belastung wird nicht mit heutigen Schwellen neu gerechnet.
- **Fitness, Ermüdung, Form:** CTL (42 Tage), ATL (7 Tage), TSB = CTL − ATL von gestern.
- **Zeit in Zonen** (Puls, Pace, Leistung), **Umfang** je Woche/Monat und Sportart, **aerobe Entkopplung** (Pa:Hr),
  **Bestleistungen** (Laufen: Zeiten über Standarddistanzen, Rad: Leistungskurve), **Kraftvolumen** je Übung und Muskelgruppe,
  **Gesundheitstrends** (Ruhepuls, HRV, Schlaf gegen die Trainingslast).

## REST-API

Unter `/api` (Ingress: relativ zur App-URL, extern: `https://<app_external_url>/api`). Extern verlangt jede Route außer
`api/context` ein Bearer-Token von Home Assistant (`Authorization: Bearer …`). Die Routen: `context`, `me`, `garmin/key`, `sync`,
`activities` (+ `calendar`, `{id}`, `{id}/samples|laps|strength|analysis|fit`), `analytics/{pmc,zones,volume,trends,best-efforts,strength}`,
`health/{daily,sleep,hrv}`, `settings` (+ `language`, `athlete`), `data` (DELETE = alle Daten löschen, mit Bestätigung im Body).

## MCP-Server (für Claude & Co.)

Adresse: `https://<app_external_url>/mcp` (Streamable HTTP). Die Adresse und die Schritte zum Verbinden stehen auch in der App unter *Einstellungen → MCP-Server*. Die Anmeldung läuft über **Home Assistant als
Authorization Server**: Die App liefert unter `/.well-known/oauth-protected-resource` die Metadaten, die MCP-Clients zu Home
Assistant führen; dort meldest du dich an. Die Tokens holen sich die Clients selbst.

- **claude.ai:** *Einstellungen → Konnektoren → Benutzerdefinierten Konnektor hinzufügen*, URL eintragen.
- **Claude Code:** `claude mcp add --transport http garmin https://<app_external_url>/mcp`, danach `/mcp` und anmelden.

Tools (alle nur lesend, außer `trigger_sync`): `list_activities`, `get_activity`, `get_activity_samples`, `get_strength_sets`,
`compare_activities`, `get_training_load`, `get_zone_distribution`, `get_volume`, `get_best_efforts`, `get_health_trends`,
`get_athlete_settings`, `trigger_sync`. Prompts: `analyze_week`, `race_readiness`. Die Antworten sind englisch, mit
metrischen Einheiten, und beziehen sich immer auf den angemeldeten Benutzer. Es gibt bewusst kein SQL-Tool.

## Sicherheit und Datenschutz

- **Ingress:** nur der Supervisor (`172.30.32.2`) darf Port 8099 erreichen (fail-closed). Nur dort werden die
  `X-Remote-User-*`-Header gelesen.
- **Extern:** Identität nur über ein gültiges Home-Assistant-Token (Prüfung über die WebSocket-API von Home Assistant, kurz
  zwischengespeichert). Die Header des Ingress werden dort ignoriert, die CSP erlaubt keine Inline-Skripte.
- **Wichtig – die Zielgruppe (Audience) der Tokens wird nicht geprüft:** Home-Assistant-Tokens haben keine Audience. Die App
  akzeptiert **jedes** gültige Token eines echten Benutzers, auch Long-Lived Access Tokens, und ordnet es diesem Benutzer zu.
  Ein Client, dem du ein solches Token gibst, kann damit alles tun, was dieser Benutzer in dieser App darf (lesen und
  synchronisieren). Gib Home-Assistant-Tokens nur an Programme, denen du vertraust. System-Benutzer (z. B. andere Apps) werden abgelehnt.
- Der Garmin-Key liegt nur verschlüsselt auf der Platte. Anfragen gehen nur an Garmin und (im Browser) an den Kartenanbieter
  OpenFreeMap für Kartenkacheln. Der Master-Schlüssel `/data/secret.key` ist Teil von Home-Assistant-Backups; wer das Backup
  hat, kann die Keys entschlüsseln.
- „Alle Daten löschen“ (Einstellungen) entfernt alle synchronisierten Zeilen und FIT-Dateien des Benutzers. Den Key entfernen
  stoppt nur den Sync.

## Offen / noch nicht am echten System geprüft

- Der **OAuth-Ablauf der PWA** gegen Home Assistant: Falls `POST <ha>/auth/token` aus dem Browser wegen CORS scheitert, muss der
  Reverse-Proxy vor Home Assistant die CORS-Header für den App-Origin setzen.
- Der **Claude-Connector** gegen Home Assistant als Authorization Server (Prüfliste in `docs/garmin-api.md`, Spike 2b).
- **Garmin-Limits** (Rate-Limits, Tiefe der Historie) sind unbekannt; ob die FIT-Dateien der Personal API alle Felder (z. B.
  VO2max) enthalten, ebenso.
- Benachrichtigungen sind persistente Benachrichtigungen in Home Assistant (für alle Benutzer sichtbar), keine
  Push-Nachrichten an das Handy des Benutzers.
