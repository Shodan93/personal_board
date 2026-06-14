/* ============================================================
   ORBIT — Cloudflare Worker (Auth + Cloud-Speicher + Claude)
   E-Mail/Passwort-Login, generalisierte Boards (Säulen im Board
   gespeichert, nicht im Worker).

   Endpunkte:
     POST   /login        {email, password}          -> {email, name, focus, reportAll, housekeeper}
     GET    /version                                  -> {version, usersConfigured}
   Mit Header  X-Auth: base64("email:password")  auf allen folgenden:
     GET    /data                                     -> Board-JSON (204 wenn leer)
     PUT    /data         Board-JSON                  -> {ok, bytes}
     GET    /file/<id>                                -> {data, name, type}
     PUT    /file/<id>    {data, name, type}          -> {ok}
     DELETE /file/<id>                                -> {ok}
     GET    /usage                                    -> {used, limit}
     POST   /housekeeper  {title, desc, note}         -> {title, desc, note}
     POST   /focus        {heute, tickets}            -> {fokus}
     POST   /report-all   {heute, tickets}            -> {report}   (nur erledigte Tickets)

   Einrichtung in Cloudflare:
   1. KV-Namespace "board" anlegen, als Binding BOARD_KV an den Worker.
   2. Settings -> Variables and Secrets:
      - Secret  ANTHROPIC_API_KEY  (Key von console.anthropic.com)
      - Secret  USERS  (JSON, z.B.):
        {"anna@example.com":{"password":"geheim1","name":"Anna"},
         "ben@example.com":{"password":"geheim2","name":"Ben"}}
      - Text    ALLOWED_ORIGINS    (optional, kommagetrennt)
   3. Mehrere Personen mit denselben Zugangsdaten teilen sich automatisch
      ein Board (gemeinsamer Datenraum pro E-Mail).
   ============================================================ */

const MODEL = 'claude-haiku-4-5';
const MAXTOK = { housekeeper: 3000, focus: 250, report: 1500 };

// Funktionen sind jetzt für alle Nutzer gleich (keine Individualisierung mehr)
const FEATURES = { focus: true, reportAll: true, housekeeper: true };

const LIMIT_STATE = 2 * 1024 * 1024;
const LIMIT_FILE  = 3 * 1024 * 1024;
const LIMIT_TOTAL = 100 * 1024 * 1024;

const HOUSEKEEPER_SYSTEM =
  'Korrigiere in den JSON-Feldern title, desc und note ausschließlich Rechtschreibung, Grammatik und ' +
  'Zeichensetzung (Deutsch). Inhalt, Satzbau, Struktur und alle HTML-Tags (insbesondere <img data-img-id>) ' +
  'unverändert lassen. Nichts hinzufügen, nichts weglassen, nichts umformulieren.';

const FOCUS_SYSTEM =
  'Du erhältst Tickets eines Aufgaben-Boards als JSON und das heutige Datum. Nenne in GENAU EINEM deutschen ' +
  'Satz das wichtigste Ticket (Reihenfolge: überfällig vor heute fällig vor naher Deadline vor Priorität Hoch; ' +
  'Tickets, deren Status auf "blockiert/wartend" hindeutet, nur empfehlen, wenn der Nutzer die Blockade laut ' +
  'Beschreibung selbst lösen kann), warum es jetzt dran ist, und den konkreten nächsten Schritt aus der Beschreibung.';

const REPORT_ALL_SYSTEM =
  'Du erhältst ausschließlich ERLEDIGTE Tickets eines Nutzers als JSON (inkl. offenTage = Tage von Anlage bis ' +
  'Erledigung). Fasse auf Deutsch kompakt zusammen, an welchen Themen der Nutzer gearbeitet hat: nach Themen/' +
  'Kategorien gruppiert (Themenname als Zeile, darunter die Punkte), je Thema 1–3 Sätze zu Umfang und ' +
  'Ergebnissen; zum Schluss ein Satz zur Gesamtbilanz (Anzahl, ggf. durchschnittliche Bearbeitungsdauer). ' +
  'Sachlich, nichts erfinden, reiner Text ohne Markdown.';

const HOUSEKEEPER_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, desc: { type: 'string' }, note: { type: 'string' } },
  required: ['title', 'desc', 'note'], additionalProperties: false,
};
const FOCUS_SCHEMA = { type: 'object', properties: { fokus: { type: 'string' } }, required: ['fokus'], additionalProperties: false };
const REPORT_SCHEMA = { type: 'object', properties: { report: { type: 'string' } }, required: ['report'], additionalProperties: false };

const b64decode = s => { try { return atob(s); } catch (e) { return ''; } };
const keyOf = email => 'state:' + email.replace(/[^a-z0-9]/gi, '_');
const fileKeyOf = (email, id) => 'file:' + email.replace(/[^a-z0-9]/gi, '_') + ':' + id;

function parseUsers(env) {
  try {
    const raw = JSON.parse(env.USERS || '{}');
    const out = {};
    for (const [email, v] of Object.entries(raw)) out[String(email).trim().toLowerCase()] = v;
    return { users: out, error: null };
  } catch (e) { return { users: {}, error: 'USERS ist kein gültiges JSON — Secret prüfen.' }; }
}
function authEmail(request, users) {
  const h = request.headers.get('X-Auth');
  if (!h) return null;
  const dec = b64decode(h);
  const i = dec.indexOf(':');
  if (i < 0) return null;
  const email = dec.slice(0, i).trim().toLowerCase(), pass = dec.slice(i + 1);
  const u = users[email];
  return (u && String(u.password) === pass) ? email : null;
}

async function usedBytes(env, email) {
  let used = 0;
  const st = await env.BOARD_KV.getWithMetadata(keyOf(email));
  used += (st && st.metadata && st.metadata.size) || 0;
  const prefix = fileKeyOf(email, '');
  let cursor;
  do {
    const page = await env.BOARD_KV.list({ prefix, cursor });
    for (const k of page.keys) used += (k.metadata && k.metadata.size) || 0;
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return used;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://shodan93.github.io').split(',').map(s => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname;
    const { users, error: usersErr } = parseUsers(env);

    if (path.endsWith('/version')) return json({ version: 6, usersConfigured: Object.keys(users).length, usersError: usersErr });

    if (path.endsWith('/login') && request.method === 'POST') {
      if (usersErr) return json({ error: usersErr }, 500);
      if (!Object.keys(users).length) return json({ error: 'Keine Nutzer konfiguriert — Secret USERS anlegen.' }, 500);
      const { email, password } = await request.json().catch(() => ({}));
      const e = String(email || '').trim().toLowerCase();
      const u = users[e];
      if (!u || String(u.password) !== String(password || '')) return json({ error: 'E-Mail oder Passwort falsch' }, 401);
      return json({ email: e, name: u.name || e, ...FEATURES });
    }

    const email = authEmail(request, users);
    if (!email) return json({ error: 'Nicht angemeldet' }, 401);

    const needsKV = path.endsWith('/data') || path.endsWith('/usage') || /\/file\//.test(path);
    if (needsKV && !env.BOARD_KV) return json({ error: 'KV-Namespace BOARD_KV nicht gebunden.' }, 500);

    if (path.endsWith('/data')) {
      const k = keyOf(email);
      if (request.method === 'GET') {
        const v = await env.BOARD_KV.get(k);
        return v ? new Response(v, { headers: { 'Content-Type': 'application/json', ...cors } })
                 : new Response(null, { status: 204, headers: cors });
      }
      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > LIMIT_STATE) return json({ error: 'Board-Daten zu groß (max. 2 MB).' }, 413);
        await env.BOARD_KV.put(k, body, { metadata: { size: body.length } });
        return json({ ok: true, bytes: body.length });
      }
    }

    const mFile = path.match(/\/file\/([A-Za-z0-9]+)$/);
    if (mFile) {
      const k = fileKeyOf(email, mFile[1]);
      if (request.method === 'GET') {
        const v = await env.BOARD_KV.get(k);
        return v ? new Response(v, { headers: { 'Content-Type': 'application/json', ...cors } }) : json({ error: 'Nicht gefunden' }, 404);
      }
      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > LIMIT_FILE) return json({ error: 'Datei zu groß (max. 3 MB).' }, 413);
        if ((await usedBytes(env, email)) + body.length > LIMIT_TOTAL) return json({ error: 'Speicherlimit (100 MB) erreicht.' }, 413);
        await env.BOARD_KV.put(k, body, { metadata: { size: body.length } });
        return json({ ok: true });
      }
      if (request.method === 'DELETE') { await env.BOARD_KV.delete(k); return json({ ok: true }); }
    }

    if (path.endsWith('/usage') && request.method === 'GET') return json({ used: await usedBytes(env, email), limit: LIMIT_TOTAL });

    if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);
    let system, schema, maxTokens;
    if (path.endsWith('/housekeeper')) { system = HOUSEKEEPER_SYSTEM; schema = HOUSEKEEPER_SCHEMA; maxTokens = MAXTOK.housekeeper; }
    else if (path.endsWith('/focus')) { system = FOCUS_SYSTEM; schema = FOCUS_SCHEMA; maxTokens = MAXTOK.focus; }
    else if (path.endsWith('/report-all')) { system = REPORT_ALL_SYSTEM; schema = REPORT_SCHEMA; maxTokens = MAXTOK.report; }
    else return json({ error: 'Unbekannter Endpunkt' }, 404);

    const body = await request.text();
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: body }], output_config: { format: { type: 'json_schema', schema } } }),
    });
    if (!apiRes.ok) return new Response('Claude-API-Fehler: ' + await apiRes.text(), { status: 502, headers: cors });
    const data = await apiRes.json();
    if (data.stop_reason === 'refusal') return json({ error: 'Anfrage wurde abgelehnt.' }, 422);
    const text = (data.content.find(b => b.type === 'text') || {}).text || '{}';
    return new Response(text, { headers: { 'Content-Type': 'application/json', ...cors } });
  },
};
