/* ============================================================
   CLOUDFLARE WORKER — Control Panel Backend
   Auth, Cloud-Speicher (KV) und Claude-Anbindung in einem.

   Endpunkte (alle außer /login mit Header "X-Board-Key"):
     POST   /login        {key}                 -> Profil {user, statuses, done, focus, reportJF, reportAll, housekeeper}
     GET    /data                               -> Board-JSON (204 wenn leer)
     PUT    /data         Board-JSON            -> {ok, bytes}
     GET    /file/<id>                          -> {data, name, type}
     PUT    /file/<id>    {data, name, type}    -> {ok}
     DELETE /file/<id>                          -> {ok}
     GET    /usage                              -> {used, limit}
     POST   /housekeeper  {title, desc, note}   -> {title, desc, note}
     POST   /focus        {heute, tickets}      -> {fokus}
     POST   /report       {heute, tickets}      -> {report}   (JF-Report)
     POST   /report-all   {heute, tickets}      -> {report}   (Gesamt-Report)

   Einrichtung in Cloudflare:
   1. Storage & Databases -> KV -> Namespace "board" anlegen.
   2. Worker -> Settings -> Bindings -> Add -> KV Namespace,
      Variable name: BOARD_KV, Namespace: board.
   3. Worker -> Settings -> Variables and Secrets:
      - Secret  ANTHROPIC_API_KEY  (Key von console.anthropic.com)
      - Secret  USER_KEYS          (JSON: {"<schlüssel>":"david", ...})
      - Text    ALLOWED_ORIGINS    (optional, kommagetrennt)
   4. Diesen Code einfügen, Deploy.

   Nutzerprofile: beliebig viele Schlüssel möglich — unbekannte
   Nutzernamen bekommen das _default-Profil. Sonderfälle unten.
   ============================================================ */

// Bewusst das kleinste Modell — minimaler Tokenverbrauch, reicht für
// rudimentäre Rechtschreib-/Formatkorrektur und kurze Zusammenfassungen.
const MODEL = 'claude-haiku-4-5';
const MAXTOK = { housekeeper: 3000, focus: 250, report: 1200 };

const PROFILES = {
  valeska: {
    statuses: ['Themenspeicher', 'PRIO', 'Blocked / Wartend', 'In Arbeit', 'Erledigt'],
    done: ['Erledigt'],
    focus: false, reportJF: false, reportAll: true, housekeeper: true,
  },
  _default: { // david, svenja und alle weiteren
    statuses: ['Themenspeicher', 'Blocked / Wartend', 'In Arbeit', 'Erledigt JF', 'Erledigt'],
    done: ['Erledigt JF', 'Erledigt'],
    focus: true, reportJF: true, reportAll: true, housekeeper: true,
  },
};

// Speicherlimits — verhindern, dass zu viel Speicher verbraucht wird
const LIMIT_STATE = 2 * 1024 * 1024;   // 2 MB Board-Daten
const LIMIT_FILE  = 3 * 1024 * 1024;   // 3 MB pro Anhang
const LIMIT_TOTAL = 100 * 1024 * 1024; // 100 MB pro Nutzer gesamt

const HOUSEKEEPER_SYSTEM =
  'Korrigiere in den JSON-Feldern title, desc und note ausschließlich Rechtschreibung, Grammatik und ' +
  'Zeichensetzung (Deutsch). Inhalt, Satzbau, Struktur und alle HTML-Tags (insbesondere <img data-img-id>) ' +
  'unverändert lassen. Nichts hinzufügen, nichts weglassen, nichts umformulieren.';

const FOCUS_SYSTEM =
  'Du erhältst Tickets eines Aufgaben-Boards als JSON und das heutige Datum. Nenne in GENAU EINEM deutschen ' +
  'Satz das wichtigste Ticket (Reihenfolge: überfällig vor heute fällig vor naher Deadline vor Priorität Hoch; ' +
  '"Blocked / Wartend" nur, wenn der Nutzer die Blockade laut Beschreibung selbst lösen kann; "Erledigt JF" ' +
  'ignorieren), warum es jetzt dran ist, und den konkreten nächsten Schritt aus der Beschreibung.';

const REPORT_SYSTEM =
  'Du erhältst erledigte Tickets (Status "Erledigt JF") als JSON. Erstelle eine kurze, vortragsfertige ' +
  'Zusammenfassung fürs Jour-Fixe auf Deutsch, nach Themen/Kategorien gruppiert (Themenname als Zeile, ' +
  'darunter die Punkte): pro Ticket genau ein Stichpunkt "• Titel — Ergebnis in einem Halbsatz" aus ' +
  'Beschreibung und Verlauf. Sachlich, nichts erfinden, reiner Text ohne Markdown.';

const REPORT_ALL_SYSTEM =
  'Du erhältst alle erledigten Tickets eines Nutzers als JSON (inkl. offenTage = Tage von Anlage bis ' +
  'Erledigung). Fasse auf Deutsch kompakt zusammen, an welchen Themen der Nutzer gearbeitet hat: nach Themen ' +
  'gruppiert, je Thema 1–3 Sätze zu Umfang und Ergebnissen; zum Schluss ein Satz zur Gesamtbilanz ' +
  '(Anzahl, ggf. durchschnittliche Bearbeitungsdauer). Sachlich, nichts erfinden, reiner Text ohne Markdown.';

const HOUSEKEEPER_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, desc: { type: 'string' }, note: { type: 'string' } },
  required: ['title', 'desc', 'note'],
  additionalProperties: false,
};
const FOCUS_SCHEMA = {
  type: 'object', properties: { fokus: { type: 'string' } },
  required: ['fokus'], additionalProperties: false,
};
const REPORT_SCHEMA = {
  type: 'object', properties: { report: { type: 'string' } },
  required: ['report'], additionalProperties: false,
};

async function usedBytes(env, user) {
  let used = 0;
  const st = await env.BOARD_KV.getWithMetadata('state:' + user);
  used += (st && st.metadata && st.metadata.size) || 0;
  let cursor;
  do {
    const page = await env.BOARD_KV.list({ prefix: 'file:' + user + ':', cursor });
    for (const k of page.keys) used += (k.metadata && k.metadata.size) || 0;
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return used;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://shodan93.github.io')
      .split(',').map(s => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Board-Key',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname;
    let users = {};
    try { users = JSON.parse(env.USER_KEYS || '{}'); } catch (e) {}
    const profileFor = u => ({ user: u, ...(PROFILES[u] || PROFILES._default) });

    // Login: Schlüssel im Body, Profil zurück
    if (path.endsWith('/login') && request.method === 'POST') {
      const { key } = await request.json().catch(() => ({}));
      const user = users[key];
      if (!user) return json({ error: 'Ungültiger Schlüssel' }, 401);
      return json(profileFor(user));
    }

    // Alle anderen Endpunkte: Schlüssel im Header
    const user = users[request.headers.get('X-Board-Key')];
    if (!user) return json({ error: 'Nicht angemeldet' }, 401);
    const profile = profileFor(user);
    const needsKV = path.endsWith('/data') || path.endsWith('/usage') || /\/file\//.test(path);
    if (needsKV && !env.BOARD_KV)
      return json({ error: 'KV-Namespace BOARD_KV ist nicht gebunden (Worker-Settings -> Bindings)' }, 500);

    // Board-Daten
    if (path.endsWith('/data')) {
      const k = 'state:' + user;
      if (request.method === 'GET') {
        const v = await env.BOARD_KV.get(k);
        return v
          ? new Response(v, { headers: { 'Content-Type': 'application/json', ...cors } })
          : new Response(null, { status: 204, headers: cors });
      }
      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > LIMIT_STATE) return json({ error: 'Board-Daten zu groß (max. 2 MB) — alte Tickets löschen oder Anhänge reduzieren.' }, 413);
        await env.BOARD_KV.put(k, body, { metadata: { size: body.length } });
        return json({ ok: true, bytes: body.length });
      }
    }

    // Anhänge
    const mFile = path.match(/\/file\/([A-Za-z0-9]+)$/);
    if (mFile) {
      const k = 'file:' + user + ':' + mFile[1];
      if (request.method === 'GET') {
        const v = await env.BOARD_KV.get(k);
        return v
          ? new Response(v, { headers: { 'Content-Type': 'application/json', ...cors } })
          : json({ error: 'Nicht gefunden' }, 404);
      }
      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > LIMIT_FILE) return json({ error: 'Datei zu groß (max. 3 MB).' }, 413);
        const used = await usedBytes(env, user);
        if (used + body.length > LIMIT_TOTAL) return json({ error: 'Speicherlimit (100 MB) erreicht — Anhänge löschen.' }, 413);
        await env.BOARD_KV.put(k, body, { metadata: { size: body.length } });
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await env.BOARD_KV.delete(k);
        return json({ ok: true });
      }
    }

    if (path.endsWith('/usage') && request.method === 'GET') {
      return json({ used: await usedBytes(env, user), limit: LIMIT_TOTAL });
    }

    // Claude-Endpunkte (pro Profil freigeschaltet)
    if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);
    let system, schema, maxTokens;
    if (path.endsWith('/housekeeper') && profile.housekeeper) {
      system = HOUSEKEEPER_SYSTEM; schema = HOUSEKEEPER_SCHEMA; maxTokens = MAXTOK.housekeeper;
    } else if (path.endsWith('/focus') && profile.focus) {
      system = FOCUS_SYSTEM; schema = FOCUS_SCHEMA; maxTokens = MAXTOK.focus;
    } else if (path.endsWith('/report-all') && profile.reportAll) {
      system = REPORT_ALL_SYSTEM; schema = REPORT_SCHEMA; maxTokens = MAXTOK.report;
    } else if (path.endsWith('/report') && profile.reportJF) {
      system = REPORT_SYSTEM; schema = REPORT_SCHEMA; maxTokens = MAXTOK.report;
    } else {
      return json({ error: 'Endpunkt für dieses Profil nicht verfügbar' }, 403);
    }

    const body = await request.text();
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: body }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    });
    if (!apiRes.ok) return new Response('Claude-API-Fehler: ' + await apiRes.text(), { status: 502, headers: cors });
    const data = await apiRes.json();
    if (data.stop_reason === 'refusal') return json({ error: 'Anfrage wurde abgelehnt.' }, 422);
    const text = (data.content.find(b => b.type === 'text') || {}).text || '{}';
    return new Response(text, { headers: { 'Content-Type': 'application/json', ...cors } });
  },
};
