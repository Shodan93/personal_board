# Orbit Remote-MCP (Handy/Web tauglich)

`mcp-worker.js` läuft im selben Cloudflare-Worker wie die Seite (`orbit`) und
stellt unter **`/mcp`** einen Remote-MCP-Server bereit. Damit kannst du aus
Claude (Web **und** Handy) deine Tickets lesen und anlegen.

**Streng auf dein Board beschränkt:** Jeder Datenbankzugriff filtert serverseitig
`owner = ORBIT_OWNER_ID`. Du siehst also ausschließlich **deine** Boards — nie die
anderer Nutzer, selbst wenn eine fremde `board_id` übergeben würde.

## 1) Secrets im Worker setzen (einmalig)

Cloudflare-Dashboard → Workers & Pages → **orbit** → **Settings → Variables and
Secrets** → jeweils als **Secret** (encrypted) hinzufügen:

| Name | Wert |
|------|------|
| `SUPABASE_URL` | `https://eqrzazmdamiplqiizrat.supabase.co` |
| `SUPABASE_SERVICE_KEY` | dein Supabase **service_role / secret** Key |
| `ORBIT_OWNER_ID` | deine **Auth-User-UUID** (Supabase → Authentication → Users → deine Zeile → „User UID") |
| `MCP_TOKEN` | ein langes, frei erfundenes Geheimnis (z. B. 32+ Zeichen) |

> Alternativ per CLI: `npx wrangler secret put SUPABASE_SERVICE_KEY` usw.
> Die Secrets bleiben über Deployments hinweg erhalten.

## 2) Deployen

Passiert automatisch beim Push (Workers Builds baut `orbit` neu).
`wrangler.jsonc` bindet den Worker (`main`) ein und liefert sonst weiter die
statische Seite (`assets`). Die normale Website ändert sich dadurch nicht.

## 3) In Claude als Connector eintragen

„Benutzerdefinierten Connector hinzufügen":

- **Name:** Orbit
- **Remote MCP Server URL:**
  ```
  https://orbit.mumelter.org/mcp?key=DEIN_MCP_TOKEN
  ```
- **OAuth-Felder leer lassen.** (Die Absicherung läuft über das Token in der URL.)

Fertig → die Tools tauchen im Chat auf:
`list_boards`, `list_statuses`, `list_tickets`, `get_ticket`,
`create_ticket`, `update_ticket`, `move_ticket`, `delete_ticket`.
Da Orbit per Realtime lauscht, erscheinen Änderungen sofort live im Board.

## Schnelltest

```bash
# Healthcheck (sollte {"ok":true,...} liefern):
curl "https://orbit.mumelter.org/mcp?key=DEIN_MCP_TOKEN"

# Tools auflisten:
curl -X POST "https://orbit.mumelter.org/mcp?key=DEIN_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Sicherheit

- Die **URL enthält das Token** — behandle sie wie ein Passwort (nicht teilen,
  nicht in Screenshots). Token jederzeit über das Secret `MCP_TOKEN` neu setzen,
  dann wird die alte URL ungültig.
- Der **Service-Key** liegt nur als Worker-Secret vor, nie im Repo/Frontend.
- Ohne korrektes Token antwortet `/mcp` mit **403** (kein OAuth-Flow).
