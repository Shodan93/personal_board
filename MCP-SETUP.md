# Orbit Remote-MCP (Handy/Web tauglich)

`mcp-worker.js` läuft im selben Cloudflare-Worker wie die Seite (`orbit`) und
stellt unter **`/mcp`** einen Remote-MCP-Server bereit. Damit kannst du aus
Claude (Web **und** Handy) deine Tickets lesen und anlegen.

**Streng pro Person beschränkt:** Jedes Token gehört genau einer Person. Der Server
löst Token → Owner-UUID auf und filtert jeden Datenbankzugriff serverseitig auf
`owner = <diese UUID>`. Jede/r sieht also ausschließlich die **eigenen** Boards —
nie die anderer Nutzer, selbst wenn eine fremde `board_id` übergeben würde.

## 1) Secrets im Worker setzen (einmalig)

Cloudflare-Dashboard → Workers & Pages → **orbit** → **Settings → Variables and
Secrets** → jeweils als **Secret** (encrypted) hinzufügen:

| Name | Wert |
|------|------|
| `SUPABASE_URL` | `https://eqrzazmdamiplqiizrat.supabase.co` |
| `SUPABASE_SERVICE_KEY` | dein Supabase **service_role / secret** Key |

Dazu die **Zugänge** — pro Person ein Token. Zwei Wege, kombinierbar:

**a) Einzelzugang (Alt/kompatibel, weiterhin gültig):**

| Name | Wert |
|------|------|
| `ORBIT_OWNER_ID` | Auth-User-UUID der Person |
| `MCP_TOKEN` | ein langes, frei erfundenes Geheimnis |

**b) Mehrere Personen über EINEN JSON-Secret** (empfohlen, sobald >1 Zugang):

| Name | Wert |
|------|------|
| `MCP_USERS` | JSON-Map `{"<token>":"<owner-uuid>", …}` |

Beispiel (David + Svenja):

```json
{
  "orbit_david_…":  "310705ff-fd41-4ad1-a940-877178191730",
  "orbit_svenja_1f1483b7c9b940c8b02a5563729bd1dc": "345534e7-89bf-4d07-951c-8f08b17a079d"
}
```

> Beide Wege dürfen gleichzeitig gesetzt sein; bei gleichem Token gewinnt `MCP_USERS`.
> Wer nur `MCP_USERS` nutzt, kann `MCP_TOKEN`/`ORBIT_OWNER_ID` weglassen.
> Alternativ per CLI: `npx wrangler secret put MCP_USERS` usw.
> Die Secrets bleiben über Deployments hinweg erhalten.

Owner-UUIDs findest du in Supabase → Authentication → Users (Spalte „User UID").

### Ein Token auf EINZELNE Boards beschränken (z. B. Arbeits-Zugang)

Statt einer Owner-UUID als String kann ein Token-Wert ein **Objekt** sein:

```json
{
  "orbit_david_…": "310705ff-fd41-4ad1-a940-877178191730",
  "orbit_work_fca8783830fd2320ab60cf86d1ff954d": {
    "owner": "310705ff-fd41-4ad1-a940-877178191730",
    "boards": ["9f32fbac-0a59-4609-88a5-63d1f1ffc005"]
  }
}
```

Dieses Token gehört zwar demselben Konto (David), sieht aber **ausschließlich** die
gelisteten Board-IDs — ideal für einen Arbeits-Connector, der nur „dental bauer"
braucht. Weitere Boards freigeben = weitere IDs ins Array. Board-IDs holst du aus
`list_boards` oder aus Supabase (`public.boards`).

## 2) Deployen

Passiert automatisch beim Push (Workers Builds baut `orbit` neu).
`wrangler.jsonc` bindet den Worker (`main`) ein und liefert sonst weiter die
statische Seite (`assets`). Die normale Website ändert sich dadurch nicht.

## 3) In Claude als Connector eintragen

„Benutzerdefinierten Connector hinzufügen" — **jede Person trägt ihr EIGENES
Token ein** (David sein Token, Svenja ihres):

- **Name:** Orbit
- **Remote MCP Server URL:**
  ```
  https://orbit.mumelter.org/mcp?key=DEIN_PERSÖNLICHES_TOKEN
  ```
  Svenja z. B.:
  ```
  https://orbit.mumelter.org/mcp?key=orbit_svenja_1f1483b7c9b940c8b02a5563729bd1dc
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
