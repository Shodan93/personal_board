/* ============================================================
   ORBIT — Cloudflare Worker (nur noch Claude-Proxy)
   Auth, Daten, Anhänge laufen jetzt über Supabase. Dieser Worker
   verifiziert das Supabase-Access-Token und ruft die Claude-API
   mit dem geheimen API-Key auf (der NICHT ins Frontend gehört).

   Endpunkte (Header  X-Supabase-Token: <access_token>):
     POST /housekeeper  {title, desc, note}  -> {title, desc, note}
     POST /focus        {heute, tickets}     -> {fokus}
     POST /report-all   {heute, tickets}     -> {report}   (nur erledigte Tickets)
     GET  /version                            -> {version, supabase}

   Cloudflare-Settings:
     - Secret  ANTHROPIC_API_KEY   (console.anthropic.com)
     - Variable SUPABASE_URL       (https://<projekt>.supabase.co)
     - Variable SUPABASE_ANON_KEY  (Supabase -> Project Settings -> API -> anon public)
     - Variable ALLOWED_ORIGINS    (optional, kommagetrennt)
   ============================================================ */

const MODEL = 'claude-haiku-4-5';
const MAXTOK = { housekeeper: 3000, focus: 250, report: 1500 };

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
  'Ergebnissen; zum Schluss ein Satz zur Gesamtbilanz. Sachlich, nichts erfinden, reiner Text ohne Markdown.';

const HK_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, desc: { type: 'string' }, note: { type: 'string' } }, required: ['title', 'desc', 'note'], additionalProperties: false };
const FOCUS_SCHEMA = { type: 'object', properties: { fokus: { type: 'string' } }, required: ['fokus'], additionalProperties: false };
const REPORT_SCHEMA = { type: 'object', properties: { report: { type: 'string' } }, required: ['report'], additionalProperties: false };

async function verifyToken(request, env) {
  const tok = request.headers.get('X-Supabase-Token');
  if (!tok || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + tok, apikey: env.SUPABASE_ANON_KEY },
    });
    return r.ok;
  } catch (e) { return false; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://orbit.mumelter.org,https://shodan93.github.io').split(',').map(s => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Supabase-Token',
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname;
    if (path.endsWith('/version')) return json({ version: 7, supabase: !!env.SUPABASE_URL });

    if (!(await verifyToken(request, env))) return json({ error: 'Nicht angemeldet' }, 401);
    if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);

    let system, schema, maxTokens;
    if (path.endsWith('/housekeeper')) { system = HOUSEKEEPER_SYSTEM; schema = HK_SCHEMA; maxTokens = MAXTOK.housekeeper; }
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
