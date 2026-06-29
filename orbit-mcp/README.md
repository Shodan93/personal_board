# Orbit MCP-Server

Gibt deinem Claude-Chat Werkzeuge, um **Orbit-Tickets** (gespeichert in Supabase)
zu **lesen und zu erstellen** — z. B. „lies meine offenen Tickets" oder
„leg ein Ticket ‚Steuer machen' in ‚In Arbeit' an".

## Wie es funktioniert

Orbit speichert ein Board als eine Zeile in der Tabelle `boards`; die Tickets
liegen als JSON-Array unter `data.tickets`. Der MCP-Server liest/schreibt diese
Zeile direkt über die Supabase-API (mit dem Service-Key, der serverseitig RLS
umgeht). Da Orbit im Browser per Realtime lauscht, erscheinen so erstellte oder
geänderte Tickets **sofort live** im offenen Board.

## Verfügbare Tools

| Tool | Zweck |
|------|-------|
| `list_boards` | Alle Boards (id + Titel) |
| `list_statuses` | Spalten/Status eines Boards in Reihenfolge |
| `list_tickets` | Tickets (Filter: `status`, `query`, `include_done`) |
| `get_ticket` | Einzelnes Ticket per `id` |
| `create_ticket` | Neues Ticket (`title`, optional `status`/`prio`/`deadline`/`desc`/`cats`) |
| `update_ticket` | Felder ändern (nur gesetzte) |
| `move_ticket` | In andere Spalte verschieben |
| `delete_ticket` | Ticket löschen |

Jedes Tool nimmt optional `board_id`; ohne Angabe wird `ORBIT_BOARD_ID` genutzt.

## Einrichtung

```bash
cd orbit-mcp
npm install
cp .env.example .env     # Werte eintragen (nur lokal!)
```

`SUPABASE_SERVICE_KEY` findest du im Supabase-Dashboard unter
**Project Settings → API → service_role / secret key**.
Die Board-UUID liefert dir das Tool `list_boards` (oder die `boards`-Tabelle).

### In Claude Desktop registrieren

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/zu/orbit-mcp/server.mjs"],
      "env": {
        "SUPABASE_URL": "https://eqrzazmdamiplqiizrat.supabase.co",
        "SUPABASE_SERVICE_KEY": "sb_secret_…",
        "ORBIT_BOARD_ID": "DEINE-BOARD-UUID"
      }
    }
  }
}
```

Claude Desktop neu starten — danach taucht „orbit" mit seinen Tools im Chat auf.
(Trägst du die Keys hier in `env` ein, brauchst du die `.env` nicht.)

## Sicherheit

- Der **Service-Key umgeht RLS** (Vollzugriff auf alle Boards). Er gehört
  **ausschließlich** in deine lokale Config bzw. `.env` — **niemals** ins Repo,
  ins Frontend oder in geteilte Logs. `.env` ist per `.gitignore` ausgeschlossen.
- Der Server läuft lokal über stdio; es wird kein Port geöffnet.
- Möchtest du keinen Vollzugriff, kannst du in Supabase eine eingeschränkte
  Variante über RPCs/Policies bauen und einen anwenderspezifischen Key nutzen —
  für den persönlichen Einsatz reicht der lokale Service-Key.

## Schnelltest (ohne Claude)

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node server.mjs
```
Der Server wartet dann auf MCP-Anfragen über stdio (Strg+C zum Beenden).
Zum interaktiven Ausprobieren eignet sich der MCP-Inspector:
`npx @modelcontextprotocol/inspector node server.mjs`.
