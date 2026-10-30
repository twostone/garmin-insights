# Garmin Connect Personal API: Spike 2a

Stand: 30.10.2026. Quellen: die Swagger-Seite (`developer.garmin.com/gc-developer-program/personal/swagger-docs/`) und Garmins
Python-Client `github.com/garmin/connect-personal-api-python` (Apache-2.0).

## So kam die Spec an

Die Swagger-Seite rendert per JavaScript (Gatsby + Swagger-UI), eine separate `swagger.json`/`openapi.json` gibt es nicht
(alle naheliegenden URLs: 404). Die vollständige **OpenAPI-3.0.1-Spec ist aber als `JSON.parse('…')`-Literal im JS-Bundle der Seite
eingebettet** (`component---src-pages-gc-developer-program-personal-swagger-docs-*.js`). Sie wurde ausgeschnitten und liegt als
`docs/garmin-personal-api.openapi.json` im Repo (26 Pfade, 109 Schemas, Titel „Garmin Connect Personal API“, Version 1.0.0,
Server `https://personal.connectapi.garmin.com` und `.cn`). Daraus entsteht `garmin-insights/src/garmin/schema.d.ts`
(`npm run garmin:types`, `openapi-typescript`). Aktualisieren: Bundle neu laden, Literal wie oben extrahieren.

Die Spec hat **keine** Angaben zu Rate-Limits, Fehler-Bodies oder Historientiefe (siehe „Unbekannt“).

## Authentifizierung

- Key erzeugen: `https://connect.garmin.com/app/settings/personalApiToken` (Gültigkeit bei der Erstellung wählbar; **der Key sagt
  seine Ablaufzeit nicht selbst**, die App fragt das Ablaufdatum deshalb optional beim Nutzer ab).
- Token-Tausch: `POST /personalapitoken-service/personal-api/personal-api-key/token`, Header `Authorization: ApiKey <key>`,
  `Accept: */*`. Die Antwort ist der **reine Text** des Bearer-Tokens (ein JWT mit `exp`, 24 h gültig), kein JSON.
- Datenabrufe: `GET`, `Authorization: Bearer <token>`, `Accept: application/json`.
- Garmins Referenzclient erneuert ein gecachtes Token, wenn weniger als 1 h Restlaufzeit bleibt, und wiederholt bei 401 nicht.
  Die App macht es genauso (Erneuerung 1 h vor Ablauf) und holt bei einem 401 genau einmal ein neues Token.

## Endpunkte, die die App nutzt (v1)

Alle Pfade relativ zur Basis-URL. Datumsformat überall `YYYY-MM-DD` (Kalendertag des Nutzers).

| Zweck | Request | Fenster / Hinweis |
|---|---|---|
| Aktivitätsliste | `GET /activitylist-service/activities/search/activities?start&limit&startDate&endDate&sortOrder&…` | `limit` Standard 99; `startDate`/`endDate` inklusive, lokale Startzeit; Antwort: Array `SummarizedActivityDTO` |
| Aktivität (Detail) | `GET /activity-service/activity/{id}` | `ActivitySummaryDTO` mit `summaryDTO`, `splitSummaries`; v1 nutzt die FIT-Datei statt dessen |
| Aktivitätsdatei | `GET /download-service/files/activity/{id}` | **ZIP** (`application/x-zip-compressed`) mit der FIT-Datei; ganze Datei im Speicher |
| Tageswerte | `GET /usersummary-service/v2/dailysummaries?startDate&endDate` | **bis 1 Jahr** je Anfrage; `{ data: UserDailySummaryV2DTO[] }` (Ruhepuls in `heartRate.restingValue`, Schritte in `movement.steps`, Stress, Body Battery) |
| Schlaf | `GET /sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate` | **bis 31 Tage**; `DailySleepDTO[]` (`sleepTimeSeconds`, Phasen, `sleepScores`, SpO2, Atmung) |
| HRV | `GET /hrv-service/hrv/daily/{from}/{to}` | Limit nicht dokumentiert, die App nutzt 28 Tage; `{ hrvSummaries: HrvSummaryDTO[] }`; 204 = keine Daten |
| HF-Zonen | `GET /biometric-service/heartRateZones/v2` | `HeartRateZonesDTO[]` je Sportart (`zone1Floor`…`zone5Floor`, `maxHeartRateUsed`, `restingHeartRateUsed`, `lactateThresholdHeartRateUsed`) |
| Profil | `GET /userprofile-service/userprofile/settings` | Zeitzone, Maßsystem (nur Info) |

Nicht in v1 (vorhanden): Stress/Schritte/Hydration/Body Battery als eigene Bereiche (stecken zum Teil in den Tageswerten),
Gewicht, Ernährung, SpO2, Herzfrequenz-Tagesverlauf, Fitness Age, Zyklusdaten (Women's Health), `wellnessactivity`-Zusammenfassungen.

## Für die Analysen nützliche Felder von `SummarizedActivityDTO`

`activityId`, `activityType.typeKey`, `startTimeGMT`/`startTimeLocal`, `distance` (m), `duration`/`movingDuration` (s),
`elevationGain`, `averageHR`/`maxHR`, `avgPower`/`normPower`/`maxAvgPower_<s>` (Mean-Max-Fenster 1…18000 s),
`hrTimeInZone_1..5`, `powerTimeInZone_1..7`, `fastestSplit_<m>` (1000, 1609, 5000, 10000, 21098, 42195, …),
`vO2MaxValue`, `aerobicTrainingEffect`/`anaerobicTrainingEffect`, `activityTrainingLoad`, `trainingStressScore`,
`intensityFactor`, `lactateThresholdBpm`, `avgGradeAdjustedSpeed`, `summarizedExerciseSets` (Kraft), `totalSets`/`totalReps`,
`hasPolyline`, `startLatitude`/`startLongitude`. Die FIT-Datei liefert die Sekundenreihen (Records), Runden und Kraftsätze.

## Unbekannt (muss am echten Konto geklärt werden)

- **Rate-Limits** (pro Minute/Tag, `429`-Verhalten, `Retry-After`): nirgends dokumentiert. Die App drosselt konservativ
  (Mindestabstand 1 s zwischen Anfragen, Backoff bei 429/5xx, `Retry-After` wird beachtet) und macht den Wert über eine
  Konstante in `src/garmin/client.ts` änderbar.
- **Tiefe der Historie** (wie weit zurück Aktivitäten, Schlaf, HRV abrufbar sind) und ob sehr alte Zeiträume Fehler liefern.
- **Fehlerformat** bei 4xx/5xx (Spec zeigt nur Statuscodes ohne Body-Schema).
- Ob die FIT-Dateien der Personal API **alle** Felder enthalten (z. B. VO2max, Developer-Fields, Kraftsätze mit Übungsnamen)
  oder Garmin etwas entfernt. Die App liest, was da ist, und fällt auf die JSON-Zusammenfassung zurück.
- Maximales Zeitfenster der Aktivitätssuche und ob `start`+`limit` bei vielen tausend Treffern stabil bleiben (die App fenstert
  deshalb nach Datum, 90 Tage pro Fenster, und blättert nur innerhalb eines Fensters).
- Gültigkeitsdauer der Keys: 30 Tage bis 1 Jahr laut Anbieter; abgelaufene Keys liefern beim Token-Tausch vermutlich 401/403.

## Spike 2b (manuell): Claude-Connector gegen HA-OAuth

Nicht automatisierbar, hier nur als Prüfliste (auf echtem HA ≥ 2026.10.1 mit öffentlicher Domain):

1. `https://<app>/.well-known/oauth-protected-resource/mcp` öffnen: `authorization_servers` zeigt auf die HA-URL.
2. `https://<ha>/.well-known/oauth-authorization-server` öffnen: `code_challenge_methods_supported` enthält `S256`,
   `token_endpoint_auth_methods_supported` enthält `none`, `client_id_metadata_document_supported` ist `true`.
3. In claude.ai einen benutzerdefinierten Connector mit `https://<app>/mcp` anlegen. Erwartung: Weiterleitung zum HA-Login,
   danach Verbindung; `get_training_load` im Chat aufrufen.
4. Claude Code: `claude mcp add --transport http garmin https://<app>/mcp`, dann `/mcp` und anmelden.
5. SPA im Browser: Anmeldung über `https://<app>/`; prüfen, ob `POST <ha>/auth/token` per CORS vom App-Origin erlaubt ist
   (sonst schlägt der Code-Tausch im Browser fehl; Gegenmaßnahme siehe DOCS.md „Offen“).
