# job-agent

Durchsucht mehrere Jobplattformen **API-first** und liefert passende Stellen als
Bericht — ausgelöst per **Klick** (kein tägliches Auto-Login, keine gespeicherten
Passwörter). Läuft komplett aus GitHub-Repos + Cloudflare; **kein Supabase nötig**
(kommt erst später, wenn das Dashboard dran ist).

> Status: **v0.1 — lauffähig & getestet** (Demo-Modus). Isoliert im Ordner
> `job-agent/` innerhalb von `personal_board`; ORBIT selbst ist unberührt und das
> Modul lässt sich später 1:1 in ein eigenes Repo herauslösen.

## Sofort ausprobieren (offline, ohne Netz/Keys)

```bash
cd job-agent
node scan.js --demo
```

Das lädt gebündelte Testdaten aus `fixtures/`, durchläuft die **komplette**
Pipeline (Abruf → Dedup → Matching → Bericht) und schreibt
`reports/2026-…-demo.md`. Beispiel-Ausgabe: [`docs/beispiel-bericht.md`](docs/beispiel-bericht.md).

## Was der Agent tut (5 Bausteine)

```
profile → Quellen abrufen → Matching (Filter + Score) → Dedup → Bericht
```

1. **Profil** (`profile.json`) — Rollen, Orte, Gehalt, Muss/No-Go, Präferenzen.
2. **Quellen** (`src/sources/`) — je Börse ein Adapter, gemeinsames Format.
3. **Matching** (`src/match.js`) — harte Filter (Ausschluss) + transparentes
   Scoring 0–100 mit Begründung.
4. **Dedup** (`src/dedup.js`) — merkt gesehene Stellen in `data/seen.json`, damit
   der Bericht nur **neue** Treffer zeigt (kein Supabase).
5. **Bericht** (`src/report.js`) — Markdown, sortiert nach Score.

## Datenquellen

| Quelle | Key nötig? | Deckung |
|---|---|---|
| **Bundesagentur für Arbeit** (`arbeitsagentur`) | nein | ⭐ DE-Anker, >1 Mio. Stellen |
| **Arbeitnow** (`arbeitnow`) | nein | DE/Tech/Remote |
| **Adzuna** (`adzuna`) | ja (`ADZUNA_APP_ID`/`_KEY`, gratis) | Aggregator inkl. **Indeed** |
| **Jooble** (`jooble`) | ja (`JOOBLE_KEY`, gratis) | Aggregator inkl. **StepStone/Indeed** |

StepStone/Indeed/LinkedIn haben **keine** offene Such-API — über Adzuna/Jooble
sind ihre Inhalte aber **legal** mit dabei. Für **direkten** Indeed-Zugriff gibt
es ein optionales, lokal-sichtbares Modul (du loggst dich selbst ein, der Bot
scrollt sichtbar): **[`browser/`](browser/README.md)** (`node browser/scrape-indeed.mjs`).
Hintergrund/Grenzen: [`docs/browser-modul.md`](docs/browser-modul.md).

> **Wichtig:** Indeed/StepStone sind weder aus der Claude-Sandbox erreichbar
> (Netzwerk-Policy) noch kann Claude deinen lokalen Chrome fernsteuern. Direkter
> Zugriff auf diese Börsen läuft daher **auf deinem Rechner** über `browser/`.

## Echten Lauf einrichten (lokal)

1. Profil anlegen (privat, wird von `.gitignore` ausgeschlossen):
   ```bash
   cp profile.example.json profile.json      # dann mit deinen echten Daten füllen
   ```
2. Optionale Keys setzen (nur für Adzuna/Jooble):
   ```bash
   export ADZUNA_APP_ID=...  ADZUNA_APP_KEY=...  JOOBLE_KEY=...
   ```
3. Scannen:
   ```bash
   node scan.js                               # keyless: arbeitsagentur + arbeitnow
   node scan.js --source arbeitsagentur,adzuna,jooble,arbeitnow
   ```

> Wichtig: In der Claude-Code-Web-Sandbox sind externe Job-APIs per Netzwerk-
> Policy geblockt (403). Der **Live**-Lauf funktioniert daher auf deinem Rechner
> oder im Cloudflare Worker — der **Demo**-Lauf funktioniert überall.

## Als Button-Backend deployen (Cloudflare)

`worker.js` stellt `POST /scan` bereit — das ist der Backend-Teil deines
„Jobscan starten"-Buttons.

```bash
cd job-agent
npx wrangler deploy
npx wrangler secret put PROFILE_JSON     # dein Profil als JSON-String
npx wrangler secret put SCAN_TOKEN       # Passwort für den Button
# optional: ADZUNA_APP_ID / ADZUNA_APP_KEY / JOOBLE_KEY
```

Aufruf (so ruft später der ORBIT-Button an):
```bash
curl -X POST https://job-agent.<subdomain>.workers.dev/scan \
  -H "x-job-token: <SCAN_TOKEN>"
```
Antwort: JSON mit `stats`, `markdown` und `matches[]`.

Täglicher Automatik-Lauf später: in `wrangler.jsonc` den `crons`-Block
einkommentieren (`0 5 * * *` ≈ 07:00 Berlin).

## Roadmap (bewusst in kleinen, testbaren Schritten)

| Schritt | Status |
|---|---|
| Pipeline + Demo-Lauf + 4 Quellen | ✅ v0.1 (dieses Repo) |
| Echtes `profile.json` + Live-Keys | ⬜ du |
| Worker `POST /scan` deployen (Button-Backend) | ⬜ |
| `/mcp`-Endpoint → „Scanne meine Jobs" in der Claude-App | ⬜ (Skizze: [`docs/mcp-und-fertige-agenten.md`](docs/mcp-und-fertige-agenten.md)) |
| Zustellung als **ORBIT-Ticket** „Bewerben bei X" | ⬜ |
| Optionales Browser-Modul Indeed (sichtbar/lokal) | ✅ Skript da ([`browser/`](browser/README.md)) — läuft auf deinem Mac |
| Cron-Automatik + Cockpit-„Jobs"-Kachel + ORBIT-Button-UI | ⬜ ganz zum Schluss |

## Wichtige Fragen — Kurzantworten

- **Braucht man VS Code?** Nein. Repo + Cloudflare reicht; Node + Terminal nur für
  lokale Läufe/Browser-Modul. Details: [`docs/mcp-und-fertige-agenten.md`](docs/mcp-und-fertige-agenten.md).
- **Fertige Agenten kaufen?** Auto-Apply-Dienste (LazyApply & Co.) gibt es, sind
  aber AGB-/Spam-riskant. Der Wert liegt in *deinem* Profil + Ranking — das macht
  dieser Agent. Details ebenda.
- **Auto-Login bei Indeed?** Bewusst **nein** (AGB, Kontosperre, Passwort-Risiko).

## Dateien

```
job-agent/
├── scan.js                 CLI (Demo & Live)
├── worker.js               Cloudflare Worker: POST /scan  (Button-Backend)
├── wrangler.jsonc          Deploy-Konfig (Cron auskommentiert)
├── profile.example.json    Vorlage → nach profile.json kopieren (privat)
├── profile.demo.json       Demo-Profil für den Offline-Lauf
├── src/
│   ├── pipeline.js         Orchestrierung (CLI + Worker teilen sie)
│   ├── match.js            Filter + Scoring
│   ├── dedup.js            gesehene Stellen (data/seen.json)
│   ├── report.js           Markdown-Bericht
│   ├── normalize.js        einheitliches Job-Format + Hash
│   └── sources/            je Börse ein Adapter
├── fixtures/               Testdaten für den Demo-Modus
└── docs/                   Browser-Modul · MCP & fertige Agenten · Beispielbericht
```
