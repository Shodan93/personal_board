# Job-Agent — Konzept & Anleitung

**Ziel:** Ein Agent, der jeden Morgen automatisch mehrere Jobplattformen nach
Stellen durchsucht, die zu Daves Profil passen, und einen ausführlichen Bericht
liefert. Auslösung später per Knopfdruck in **ORBIT**; vorerst als testbares
Konstrukt, das auf einen Klick durchläuft.

Stand: 2026-07-23 · Branch: `claude/job-agent-daily-scan-dp4j0x`

---

## 1. Die zentrale Wahrheit vorweg: „Scannen" heißt API, nicht Browser

Die großen Börsen (**Indeed, StepStone, LinkedIn, Xing**) haben **keine offene
Such-API** und untersagen automatisiertes Auslesen in ihren AGB. Sie erkennen
Bots (Cloudflare-Challenge, „Bestätige, dass du ein Mensch bist"), verlangen
Login und zeigen Captchas.

Ob eine Börse „im Chrome" oder „als App" vorliegt, ist deshalb **zweitrangig**.
Entscheidend ist nur: **Gibt es eine API oder einen Feed?**

- **Ja** → robust, sauber, dauerhaft wartbar.
- **Nein** → Browser-Automat als letztes Mittel, mit ständigem Wartungsaufwand
  und AGB-Risiko.

Strategie deshalb: **API-first.** Für den deutschen Markt gibt es exzellente,
kostenlose, offizielle Quellen (siehe §3).

### 1a. Zur konkreten Frage „Chrome öffnen, bei Indeed einloggen, durchscrollen"

Technisch *wäre* das möglich (Chromium + Playwright sind in Agent-Umgebungen
vorhanden). **Empfohlen wird es ausdrücklich nicht**, aus vier Gründen:

1. **Login-Automatisierung verstößt gegen Indeeds Nutzungsbedingungen** und kann
   zur **Sperrung deines persönlichen Kontos** führen.
2. **Zugangsdaten:** Ein täglicher Auto-Login bräuchte dein Indeed-Passwort
   dauerhaft gespeichert. Das ist ein echtes Sicherheitsrisiko und sollte
   vermieden werden — ein Agent sollte **nie** dein Klartext-Passwort halten.
3. **Bot-Abwehr:** Indeed setzt Cloudflare-Bot-Management + Captchas ein.
   Automatisiertes Scrollen/Suchen wird regelmäßig blockiert; der Scraper bricht
   bei jeder Layout-Änderung.
4. **Fragilität:** Ein Browser-Automat ist der wartungsintensivste Teil und
   fällt am häufigsten aus — genau das Gegenteil von „läuft jeden Morgen
   zuverlässig".

**Bessere Alternativen für Indeed-Inhalte, ohne Login und ohne Scraping:**
- **Aggregator-APIs** (Adzuna, Jooble) bündeln u. a. Indeed-Stellen legal.
- **Bundesagentur-für-Arbeit-API** deckt den deutschen Markt sehr breit ab.
- Falls eine *bestimmte* Börse ohne API dir wirklich wichtig ist: Browser-Automat
  nur für **öffentliche Suchseiten ohne Login** — und mit der Erwartung, dass er
  gelegentlich nachjustiert werden muss.

**Fazit:** Wir bauen den Agenten API-first. Kein Auto-Login in dein Indeed-Konto.

---

## 2. Aufbau — die 5 Bausteine

Unabhängig vom technischen Weg besteht der Agent immer aus denselben Teilen:

1. **Profil** — deine Daten strukturiert (`profile.yaml`, §4).
2. **Fetch** — aus dem Profil werden Suchanfragen gebaut, die APIs abgefragt.
3. **Matching** — jede Stelle wird bewertet: harte Filter (Ort, Gehalt, Muss-
   Kriterien) + semantische Passung (übernimmt ein LLM = Claude).
4. **Dedup** — schon gesehene Stellen werden per Hash gemerkt; der Morgen-
   Bericht zeigt **nur neue** Treffer.
5. **Report + Zustellung** — Ranking als Bericht → Orbit-Ticket + Cockpit-Kachel.

```
profile.yaml ─▶ Fetch (APIs) ─▶ Matching (Claude) ─▶ Dedup ─▶ Report
                   │                                    │
             Bundesagentur                        gesehene-Hashes
             Adzuna, Arbeitnow …                  (Supabase)
```

---

## 3. Datenquellen (API-first)

| Quelle | Was | Kosten / Auth | Deckung |
|---|---|---|---|
| **Bundesagentur für Arbeit — Jobsuche-API** | offiziell, >1 Mio. Stellen, JSON | kostenlos, statischer API-Key-Header | ⭐ Anker DE |
| **Adzuna API** | Aggregator (bündelt viele Börsen inkl. Indeed) | kostenlos, `app_id`+`app_key` | breit, inkl. DE |
| **Arbeitnow API** | Tech/Remote, DE | kostenlos, kein Key | Tech/Remote |
| **Jooble API** | Aggregator | kostenlos, Key (POST) | ergänzend |
| **The Muse / Remotive / RemoteOK** | Remote-fokussiert | kostenlos, JSON | Remote |
| ~~Indeed / StepStone / LinkedIn / Xing~~ | keine offene Such-API | — | nur via Aggregator |

**Bundesagentur-API (Anker), Beispiel-Request:**
```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs
    ?was=<Jobtitel>&wo=<Ort>&umkreis=50&size=25&page=1
Header: X-API-Key: jobboerse-jobsuche
```

> **Wichtiger Umgebungs-Befund (2026-07-23):** Aus der aktuellen Claude-Code-
> Sandbox sind diese externen APIs **per Netzwerk-Policy geblockt** (Proxy
> antwortet mit `403` auf `rest.arbeitsagentur.de` und `arbeitnow.com`). Das ist
> **keine** Eigenschaft der APIs, sondern der restriktiven Netzwerk-Policy dieser
> Umgebung. Konsequenz für die Architektur:
> - **Weg B (Cloudflare Worker)** läuft auf Cloudflares Netz → **keine
>   Blockade**, freier Egress zu allen Job-APIs. ✅
> - **Weg A (Claude-Routine)** braucht eine Umgebung mit **offener bzw. auf diese
>   Hosts erlaubter Netzwerk-Policy**, sonst greifen dieselben 403.
>
> Das ist ein starkes Argument, den produktiven Agenten als **Cloudflare Worker**
> zu bauen (siehe §7) — passt ohnehin zu deinem bestehenden `orbit-api`.

---

## 4. Profil-Schema (`profile.yaml`) — das Herzstück

Die Qualität der Treffer steht und fällt mit diesem Profil. Vorlage:

```yaml
# Wonach gesucht wird
rollen:
  - "Dentaltechniker"
  - "CAD/CAM Zahntechnik"
  - "Anwendungsberater Dental"
keywords_boost: ["CEREC", "exocad", "Implantatprothetik"]  # erhöht Score
senioritaet: "mid"            # junior | mid | senior | lead

# Wo
orte: ["München", "Rosenheim"]
umkreis_km: 50
remote_ok: true               # Remote-Stellen ebenfalls einschließen

# Harte Filter (Stelle fliegt raus, wenn verletzt)
gehalt_min_eur: 48000
sprache_muss: ["Deutsch"]
no_go:
  - "Zeitarbeit"
  - "Schichtdienst"
  - "reiner Außendienst"

# Weiche Präferenzen (fließen ins Ranking, kein Ausschluss)
praeferenzen:
  - "unbefristet"
  - "familienfreundlich / Gleitzeit"
  - "kleines bis mittelständisches Unternehmen"

# Kontext fürs semantische Matching (frei formuliert)
kurzprofil: >
  X Jahre Erfahrung in ... . Stärken: ... . Suche eine Rolle mit ... .
  Nicht interessiert an ... .

# Zustellung
report:
  ziele: ["orbit-ticket", "cockpit-kachel"]
  max_treffer_pro_tag: 10
  uhrzeit: "07:00"
  zeitzone: "Europe/Berlin"
```

> Diese Datei enthält persönliche Daten → sie gehört **nicht** ins öffentliche
> Repo-Frontend. Ablage: privat (z. B. als Supabase-Zeile pro Nutzer, analog zu
> `cockpit_prefs`, oder als Worker-Secret/KV). Im Repo bleibt nur diese
> anonyme **Vorlage**.

---

## 5. Matching & Ranking

Zweistufig, damit es schnell **und** klug ist:

1. **Harte Filter (Code, billig):** Ort/Umkreis, Gehaltsuntergrenze, No-Gos,
   Sprache. Was durchfällt, wird gar nicht erst bewertet.
2. **Semantische Passung (Claude, für die Überlebenden):** Claude bekommt
   Kurzprofil + Stellentext und gibt je Stelle:
   - `score` 0–100,
   - `begruendung` (2–3 Sätze: warum passt / passt nicht),
   - `red_flags` (z. B. „verlangt 5 J. Erfahrung, du hast 2").

   Das ist der große Vorteil eines LLM-Agenten: „passt zu meinem Profil" ist
   eine Bedeutungs-, keine Stichwortfrage — genau das kann Claude.

Ausgabe: sortierte Liste, Top-N (`max_treffer_pro_tag`) landen im Bericht.

---

## 6. Dedup — nur neue Stellen morgens

Ohne Dedup bekommst du jeden Morgen dieselben Stellen. Lösung:

- Pro Stelle ein stabiler **Hash** (`quelle + externe_id`, ersatzweise Hash aus
  `titel + firma + ort`).
- Tabelle `job_seen (hash, first_seen, score, url)` in Supabase.
- Beim Scan: bekannte Hashes rausfiltern → Bericht zeigt nur **neu erschienene**
  Treffer. (Optional wöchentliche „Top offen"-Übersicht separat.)

---

## 7. Zwei Architektur-Wege

### Weg A — Claude-Code-Routine (schnell, wenig Code)
Eine terminierte Routine feuert morgens, liest das Profil, ruft die APIs per
Web-Fetch ab, Claude rankt, Bericht raus.
- **Pro:** in ~1 Tag lauffähig, Matching sofort „schlau", kaum Infrastruktur.
- **Contra:** hängt an Claude-Code-Kontingent; **braucht offene Netzwerk-Policy**
  (in der aktuellen Sandbox 403, siehe §3); kein Teil deiner mumelter.org-Infra;
  ein „Button in ORBIT" ist damit nur indirekt umsetzbar.

### Weg B — Cloudflare Worker `job-api` (empfohlen)
Neuer Worker analog `orbit-api`, mit **zwei Auslösern**:
- **Cron Trigger** (`"triggers": { "crons": ["0 5 * * *"] }` in `wrangler.jsonc`,
  05:00 UTC ≈ 07:00 Berlin) für den täglichen Automatik-Lauf.
- **HTTP-Endpoint `POST /scan`** (Token-geschützt) für den **manuellen
  Knopfdruck** — genau das, was du in ORBIT willst.

Ablauf im Worker: Profil aus Supabase/KV → Job-APIs (freier Egress) → Claude-
Ranking über deinen bestehenden API-Proxy → Dedup gegen `job_seen` → Ergebnisse
nach Supabase → Zustellung (Orbit-Ticket + Cockpit-Kachel).

- **Pro:** läuft autark, **kein Netzwerk-Block**, gehört zu deiner Infra,
  liefert den ORBIT-Button „gratis" über `/scan`, integriert sauber ins Cockpit.
- **Contra:** mehr Code (~1–2 Tage), Matching-Aufruf selbst verdrahten.

**Empfehlung:** **Weg B.** Er löst gleichzeitig (a) den Netzwerk-Block, (b)
deinen Wunsch nach dem ORBIT-Button und (c) die dauerhafte, session-unabhängige
Automatik. Der Profil-Aufbau und die API-Logik sind identisch — ein späterer
Umstieg von A nach B wäre reine Doppelarbeit.

---

## 8. Der ORBIT-Button (dein Wunsch)

Ziel: In ORBIT ein Button „Jobscan starten" → Agent rattert los → Ergebnisse
erscheinen als Tickets/Kachel.

Umsetzung mit Weg B:
1. `job-api`-Worker stellt `POST /scan` bereit, geschützt mit demselben
   `X-Supabase-Token`-Muster wie `orbit-api`/`cockpit-api` (Token → `user_id`).
2. ORBIT-Frontend bekommt einen Button, der `POST /scan` aufruft und einen
   Lauf-Status anzeigt („läuft… / fertig, N neue Treffer").
3. Derselbe Worker-Code läuft per Cron automatisch morgens — **ein** Codepfad,
   zwei Auslöser (Button + Cron).

> Da dein Dashboard noch nicht fertig ist: Wir bauen zuerst den Worker + die
> Automatik + die Zustellung als Orbit-Tickets **ohne** Frontend-Umbau. Der
> Button ist ein kleiner, isolierter Nachtrag, sobald du so weit bist.

---

## 9. Zustellung (deine Wahl: Orbit-Ticket + Cockpit-Kachel)

- **Orbit-Ticket:** Pro Top-Treffer ein Ticket „Bewerben: <Rolle> @ <Firma>"
  in einer Spalte „Jobs/Inbox", mit Score, Begründung, Link, Deadline im
  Beschreibungsfeld. Nutzt die bestehenden MCP-/RPC-Wege — **ohne** das
  ORBIT-Frontend anzufassen (`create_ticket`).
- **Cockpit-Kachel:** Eine „Jobs"-Kachel liest `job_matches` (neue Tabelle,
  Präfix-Muster wie `cockpit_*`) und zeigt die neuen Treffer des Tages — fügt
  sich in dein Integrations-/Kachel-Muster ein.

Optional zusätzlich später: E-Mail-Zusammenfassung (Resend/MailChannels aus dem
Worker).

---

## 10. Sicherheit & Recht (Kurz)

- **Keine** Automatisierung von Logins in deine persönlichen Börsen-Konten.
- **Keine** Klartext-Passwörter im Agenten/Repo. API-Keys nur als Worker-Secrets.
- `profile.yaml` mit echten Daten **nicht** ins öffentliche Repo — nur die
  anonyme Vorlage. (Passt zu eurer bestehenden „keine persönlichen IDs"-Regel.)
- API-Nutzung im Rahmen der jeweiligen Nutzungsbedingungen (offizielle APIs =
  ausdrücklich erlaubt).

---

## 11. Fahrplan (empfohlen)

| Schritt | Ergebnis |
|---|---|
| 1. `profile.yaml` real ausfüllen (privat) | Suchgrundlage steht |
| 2. Worker `job-api` + `POST /scan` + Bundesagentur-Quelle | erster echter Testlauf auf Klick |
| 3. Matching (Claude) + Dedup (`job_seen`) | nur neue, passende Treffer |
| 4. Zustellung: Orbit-Tickets | Ergebnisse landen auf dem Board |
| 5. Cron `0 5 * * *` scharf | tägliche Automatik |
| 6. Quellen erweitern (Adzuna, Arbeitnow, …) | breitere Abdeckung |
| 7. Cockpit-„Jobs"-Kachel + ORBIT-Button | volle Integration |

**Offene Punkte, die ich von dir brauche, bevor Schritt 2 losgeht:**
- Deine echten Zielrollen / Keywords / Ort / Gehaltsuntergrenze (für `profile.yaml`).
- Adzuna-Zugang anlegen (kostenlos: developer.adzuna.com) → `app_id` + `app_key`,
  wenn wir den Aggregator mitnehmen wollen.
- Bestätigung, dass der Agent auf deiner Cloudflare/Supabase-Infra bauen darf
  (Weg B).
