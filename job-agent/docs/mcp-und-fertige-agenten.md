# MCP selbst bauen? Gibt es fertige Agenten zu kaufen? Braucht man VS Code?

Deine drei Fragen, klar beantwortet.

## 1. „Können wir einen MCP selber bauen?" — Ja, und es passt perfekt.

Ein **MCP-Server** ist die Schnittstelle, über die ein KI-Agent (Claude) deine
eigenen Werkzeuge aufruft. Du hast das schon zweimal (ORBIT `mcp-worker.js`,
Cockpit `/mcp`) — wir bauen dasselbe Muster für den Job-Scan.

**Idee:** Der `job-agent`-Worker bekommt zusätzlich einen `/mcp`-Endpoint mit
Tools wie:

| Tool | Zweck |
|---|---|
| `scan_jobs` | Startet einen Scan (= dein „Button", nur per Sprache/Chat) |
| `list_matches` | Zeigt die Treffer des letzten Laufs |
| `get_match` | Details zu einer Stelle |
| `create_orbit_ticket` | Legt „Bewerben bei X" als ORBIT-Ticket an |

Dann kannst du in der **Claude-App** sagen: „Scanne meine Jobs" — und der Agent
rattert los. Das ist die eleganteste Form deines Buttons und braucht **kein**
eigenes Frontend. Einrichtung genau wie bei dir: Claude-App → Settings →
Connectors → benutzerdefinierter Connector → URL `…/mcp?key=<token>`.

> Baustein-Reihenfolge: erst der Scan + `/scan` (fertig, dieses Repo), dann der
> `/mcp`-Endpoint als kleiner Aufsatz. Beide teilen sich `src/pipeline.js`.

## 2. „Gibt es fertige Agenten zum Kaufen/Herunterladen?"

Kurz: **Für „automatisch bewerben" ja — aber davon würde ich abraten.** Für
„gut kuratierte, passende Stellen finden" ist ein schlanker eigener Agent klar
besser. Übersicht:

| Kategorie | Beispiele | Einschätzung |
|---|---|---|
| **Auto-Apply-Dienste** | LazyApply, Sonara, LoopCV, Massive, JobCopilot | Bewerben massenhaft automatisch. Brauchen deine Login-Daten, verstoßen oft gegen Börsen-AGB, Qualität/Spam-Risiko hoch. **Nicht empfohlen.** |
| **CV-/Match-Tools** | Jobscan, Teal, Careerflow | Gut zum Optimieren einzelner Bewerbungen, aber **kein** täglicher Multi-Börsen-Scanner mit deinem Profil. |
| **Job-APIs / Aggregatoren** | Bundesagentur-API, Adzuna, Jooble, Arbeitnow | **Genau unser Fundament.** Legal, kostenlos, sauber. |
| **Fertige Open-Source-Agenten** | diverse „job-scraper" auf GitHub | Meist fragile Scraper einzelner Börsen, schnell veraltet. Als Bausteine ok, als Gesamtlösung unzuverlässig. |

Fazit: Das Wertvolle — **dein Profil + die Passungs-Bewertung** — ist individuell
und lässt sich nicht „von der Stange" kaufen. Genau das macht dieser Agent, und
das „Schlau-Ranking" übernimmt Claude (den du ohnehin hast), statt es teuer
einzukaufen.

## 3. „Braucht man dafür Visual Studio Code?"

**Nein.** VS Code ist nur ein Editor — bequem, aber nicht nötig. Konkret:

- **Nur mit GitHub-Repos + Cloudflare arbeiten:** kein VS Code nötig. Code liegt
  im Repo, Deploy läuft über `wrangler` (bzw. GitHub-Integration). Der Button
  ruft den Worker — fertig.
- **Den lokalen Testlauf (`node scan.js --demo`) oder das Browser-Modul auf
  deinem Rechner** ausführen: du brauchst **Node** und ein **Terminal**. VS Code
  macht das komfortabler (integriertes Terminal, Git-Panel), ist aber ersetzbar.
- **Diese ganze Entwicklung hier** läuft über Claude Code im Browser/Repo — ganz
  ohne lokale Installation bei dir.

**Empfehlung für dich:** VS Code installieren lohnt sich, sobald du das
Browser-Modul lokal laufen lässt und dem Bot zuschauen willst. Für den reinen
API-Agenten mit Button reicht Repo + Cloudflare.
