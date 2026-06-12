/* ============================================================
   CLOUDFLARE WORKER — Claude-Anbindung für das Control Panel
   Endpunkte:
     POST /housekeeper  {title, desc, note}  -> {title, desc, note}
     POST /focus        {heute, tickets:[…]} -> {fokus}

   Einrichtung (siehe README/Chat):
   1. Worker in Cloudflare anlegen, diesen Code einfügen, deployen.
   2. Secret ANTHROPIC_API_KEY setzen (Key von console.anthropic.com).
   3. Optional: Variable ALLOWED_ORIGINS (kommagetrennt) setzen.
   4. Worker-URL in index.html unter CLAUDE_WORKER_URL eintragen.

   Hinweis: bewusst ohne npm-Abhängigkeiten (rohes fetch zur
   Claude-API), damit der Code direkt im Cloudflare-Dashboard
   eingefügt werden kann — kein Build-Schritt nötig.
   ============================================================ */

const MODEL = 'claude-opus-4-8';

const HOUSEKEEPER_SYSTEM =
  'Du bist ein Housekeeper für ein persönliches Ticket-Board (Sprache: Deutsch). ' +
  'Du erhältst ein Ticket als JSON mit den Feldern title, desc (HTML) und note (HTML, Verlauf). ' +
  'Deine Aufgabe: Rechtschreibung, Grammatik und Zeichensetzung korrigieren und die Formatierung ' +
  'nach Best Practices aufräumen — prägnanter Titel ohne Punkt am Ende, Beschreibung klar strukturiert, ' +
  'Aufzählungen als <ul>/<ol> statt Spiegelstrich-Text, sinnvolle Absätze. ' +
  'Strenge Regeln: Den inhaltlichen Sinn NIEMALS verändern, nichts hinzudichten, nichts weglassen. ' +
  'Erlaubte HTML-Tags: b, strong, i, em, u, br, div, p, span, ul, ol, li. ' +
  '<img data-img-id="…">-Tags exakt unverändert an ihrer Position belassen. ' +
  'Datumszeilen im Verlauf (z.B. "— 12.06.2026:") unverändert lassen, nur den Text dahinter korrigieren.';

const FOCUS_SYSTEM =
  'Du bist ein Priorisierungs-Coach für ein persönliches Aufgaben-Board (Sprache: Deutsch). ' +
  'Du erhältst das heutige Datum und die aktiven Tickets als JSON (titel, status, prio, deadline, ' +
  'ueberfaellig, heuteFaellig, kategorien, beschreibung). ' +
  'Bestimme das EINE Ticket, um das sich der Nutzer jetzt kümmern soll. Priorisiere so: ' +
  '1) Überfällige Tickets schlagen alles — bei mehreren das mit der ältesten Deadline, bei Gleichstand die höhere Priorität. ' +
  '2) Danach heute fällige, 3) dann nahende Deadlines, 4) dann Priorität Hoch. ' +
  '5) Tickets im Status "Blocked / Wartend" nur empfehlen, wenn die Beschreibung nahelegt, dass der Nutzer ' +
  'die Blockade selbst lösen kann — dann lautet die Empfehlung, genau das zu tun. ' +
  '6) Status "Erledigt JF" ignorieren. ' +
  'Antworte mit GENAU EINEM Satz, der drei Dinge enthält: das Ticket beim Titel genannt, ' +
  'den Grund warum es jetzt dran ist (z.B. "seit 3 Tagen überfällig"), und den konkreten nächsten ' +
  'Schritt, abgeleitet aus der Beschreibung. Der Satz muss so konkret sein, dass der Nutzer sofort ' +
  'loslegen kann, ohne das Ticket zu öffnen. Kein Vorgeplänkel, keine Aufzählung, keine Alternativen.';

const REPORT_SYSTEM =
  'Du bist ein Assistent, der für den Jour Fixe (JF) zusammenfasst, was erledigt wurde (Sprache: Deutsch). ' +
  'Du erhältst ausschließlich Tickets im Status "Erledigt JF" als JSON (titel, prio, kategorien, deadline, ' +
  'beschreibung, verlauf) sowie das heutige Datum. ' +
  'Erstelle eine vortragsfertige Zusammenfassung für das Meeting: ein einleitender Satz mit der Anzahl der ' +
  'erledigten Themen, danach pro Ticket genau ein Stichpunkt im Format "• Titel — was erreicht wurde, in einem ' +
  'Halbsatz, abgeleitet aus Beschreibung und Verlauf". Gruppiere nach Kategorie, wenn es mehrere Kategorien gibt. ' +
  'Sachlich und konkret, nichts erfinden, keine Floskeln. Reiner Text mit "•"-Aufzählung, keine HTML- oder Markdown-Syntax.';

const REPORT_SCHEMA = {
  type: 'object',
  properties: { report: { type: 'string' } },
  required: ['report'],
  additionalProperties: false,
};

const HOUSEKEEPER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    desc: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['title', 'desc', 'note'],
  additionalProperties: false,
};

const FOCUS_SCHEMA = {
  type: 'object',
  properties: { fokus: { type: 'string' } },
  required: ['fokus'],
  additionalProperties: false,
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://shodan93.github.io')
      .split(',').map(s => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('Nur POST erlaubt', { status: 405, headers: cors });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response('Ungültiges JSON', { status: 400, headers: cors }); }

    const path = new URL(request.url).pathname;
    let system, schema;
    if (path.endsWith('/housekeeper')) {
      system = HOUSEKEEPER_SYSTEM; schema = HOUSEKEEPER_SCHEMA;
    } else if (path.endsWith('/focus')) {
      system = FOCUS_SYSTEM; schema = FOCUS_SCHEMA;
    } else if (path.endsWith('/report')) {
      system = REPORT_SYSTEM; schema = REPORT_SCHEMA;
    } else {
      return new Response('Unbekannter Endpunkt', { status: 404, headers: cors });
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(body) }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      return new Response('Claude-API-Fehler: ' + err, { status: 502, headers: cors });
    }
    const data = await apiRes.json();
    if (data.stop_reason === 'refusal') {
      return new Response(JSON.stringify({ error: 'Anfrage wurde abgelehnt.' }),
        { status: 422, headers: { 'Content-Type': 'application/json', ...cors } });
    }
    const text = (data.content.find(b => b.type === 'text') || {}).text || '{}';
    return new Response(text, {
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  },
};
