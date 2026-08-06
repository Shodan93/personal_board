// Cloudflare Worker — Backend für den "Jobscan starten"-Button.
// Läuft auf Cloudflares Netz => FREIER Zugriff auf die Job-APIs (kein Sandbox-Block).
// Ein Codepfad (src/pipeline.js) für Button (POST /scan) und später Cron.
//
// Deploy: siehe README §"Als Button-Backend deployen". Kein Supabase nötig:
// v0.1 läuft ohne Dedup-Speicher (jeder Klick zeigt die aktuellen Treffer).
import { runScan } from './src/pipeline.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-job-token',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/scan' && request.method === 'POST') {
      // Einfacher Token-Schutz (Secret SCAN_TOKEN im Worker setzen).
      if (env.SCAN_TOKEN && request.headers.get('x-job-token') !== env.SCAN_TOKEN) {
        return json({ error: 'unauthorized' }, 401);
      }
      let profile;
      try {
        profile = JSON.parse(env.PROFILE_JSON || '{}');
      } catch {
        return json({ error: 'PROFILE_JSON (Secret) fehlt oder ist kein JSON' }, 500);
      }
      const today = new Date().toISOString().slice(0, 10);
      const sources = (env.SOURCES || 'arbeitsagentur,arbeitnow')
        .split(',').map((s) => s.trim()).filter(Boolean);

      const { scored, stats, markdown, errors } = await runScan({
        profile, demo: false, sources, env, seen: {}, today,
      });
      return json({
        date: today,
        stats,
        errors,
        markdown,
        matches: scored.map((s) => ({ ...s.job, score: s.match.score, reasons: s.match.reasons })),
      });
    }

    if (url.pathname === '/' ) {
      return new Response(
        'job-agent Worker aktiv. POST /scan (Header x-job-token) startet einen Scan.',
        { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } },
      );
    }
    return json({ error: 'not found' }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}
