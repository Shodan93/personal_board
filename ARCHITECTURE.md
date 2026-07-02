# Orbit — Architektur & Entscheidungen

## Ist-Zustand (v2)

| Schicht | Technik | Begründung |
|---|---|---|
| Frontend | **Eine `index.html`** (CSS+JS inline, kein Build-Step) | Deploy = Datei kopieren; kein Toolchain-Risiko; Testsuite parst die Datei direkt |
| Hosting | Cloudflare Worker (`orbit`) mit Static Assets | `/mcp` → MCP-Server, alles andere → statische Seite |
| KI-Proxy | separater Worker `orbit-api.mumelter.org` (`worker.js`) | Claude-Aufrufe (Housekeeper), API-Key bleibt serverseitig |
| Backend | Supabase: Auth + Postgres (JSONB-Board) + RLS + Storage + Realtime | Managed, Row-Level-Security statt eigenem Server |
| Integration | `mcp-worker.js` (Remote-MCP, Token + Owner-Scope) | Claude-Chat kann Tickets lesen/anlegen |

## Entscheidung: Architektur beibehalten, gezielt professionalisieren

Geprüft am 2026-07-02 gegen die v2-Anforderungen (Rollen-Sharing, Prio-System,
Inline-Liste, Deep-Links, Konto-Verwaltung, UI-Overhaul):

**Beibehalten**, weil (1) kein Feature einen Build-Step oder ein Framework
erzwingt, (2) das Single-File-Deployment das robusteste Glied der Kette ist
(kein CI-Bruch möglich außer Syntax), (3) die Testsuite (vm-basiert, 95 Tests)
direkt an der Datei hängt.

**Professionalisiert wurde stattdessen die Datenschicht** — dort lag das echte
Risiko für ein Langzeit-/Team-Projekt:
- Sharing mit **Rollen** (`viewer`/`editor`), RLS erzwingt Schreibrechte serverseitig.
- **Teilen-Codes in eigener Tabelle `board_codes`** mit Owner-only-RLS — ein
  Mitglied kann den Bearbeiten-Code nicht auslesen (keine Selbst-Hochstufung).
- Alle Verwaltungswege über SECURITY-DEFINER-RPCs mit fixiertem `search_path`.

## Bekannte Grenzen & empfohlene nächste Schritte

1. **Dateigröße** (~4.700 Zeilen): funktioniert, aber nahe der Wartbarkeits-
   grenze. Nächster sinnvoller Schritt, sobald ein zweiter Entwickler dazukommt:
   CSS/JS in `orbit.css`/`orbit.js` auslagern (weiterhin ohne Build-Step;
   Tests auf `orbit.js` umstellen).
2. **JSONB-Board = ein Dokument**: Letzter Schreiber gewinnt pro Feld-Merge
   (Realtime-Konvergenz vorhanden). Für >5 gleichzeitige Editoren wäre eine
   `tickets`-Tabelle (Zeile pro Ticket) der nächste Schritt — Migration ist
   dank RPC-Kapselung machbar, ohne das Frontend umzubauen.
3. **E-Mail-Versand** (Passwort-Reset, E-Mail-Wechsel) hängt an den
   Supabase-Auth-SMTP-Einstellungen (Dashboard, nicht im Code).

## Wiederherstellung

Der Stand vor dem v2-Umbau liegt unverändert auf dem Branch
**`backup/v1-stable`** (GitHub). Rollback = diesen Branch deployen.
