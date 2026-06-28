import worker from '../worker.js';

const env = {
  ANTHROPIC_API_KEY: 'sk-test',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.includes('/auth/v1/user')) {
    // gültiges Token nur wenn Authorization Bearer good-token
    const ok = (opts.headers.Authorization || opts.headers.authorization) === 'Bearer good-token';
    return new Response(ok ? JSON.stringify({ id: 'u1' }) : 'unauthorized', { status: ok ? 200 : 401 });
  }
  if (url.includes('api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    if (body.model !== 'claude-haiku-4-5') throw new Error('Falsches Modell');
    const isHk = body.system.includes('Korrigiere');
    const isFocus = body.system.includes('GENAU EINEM');
    const p = isHk ? { title: 'T', desc: 'd', note: 'n' } : isFocus ? { fokus: 'X' } : { report: 'R' };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(p) }] }), { status: 200 });
  }
  return realFetch(url, opts);
};

const base = 'https://w.example';
const req = (path, { method = 'POST', token, body } = {}) => worker.fetch(new Request(base + path, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Supabase-Token': token } : {}),
  body: body !== undefined ? JSON.stringify(body) : undefined,
}), env);

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };

let r = await req('/version', { method: 'GET' });
let j = await r.json();
ok(j.version === 7 && j.supabase === true, '/version meldet v7 + Supabase verbunden');

r = await req('/focus', { body: { tickets: [] } });
ok(r.status === 401, 'Ohne Token -> 401');
r = await req('/focus', { token: 'bad-token', body: { tickets: [] } });
ok(r.status === 401, 'Ungültiges Token -> 401');

r = await req('/focus', { token: 'good-token', body: { tickets: [] } });
j = await r.json();
ok(r.status === 200 && j.fokus === 'X', 'Fokus mit gültigem Token ok (Haiku geprüft)');
r = await req('/housekeeper', { token: 'good-token', body: { title: 'x', desc: '', note: '' } });
j = await r.json();
ok(r.status === 200 && j.title === 'T', 'Housekeeper ok');
r = await req('/report-all', { token: 'good-token', body: { tickets: [] } });
j = await r.json();
ok(r.status === 200 && j.report === 'R', 'Report-all ok');
r = await req('/data', { token: 'good-token' });
ok(r.status === 404, 'Alte /data-Route entfernt -> 404');

r = await worker.fetch(new Request(base + '/focus', { method: 'OPTIONS', headers: { Origin: 'https://shodan93.github.io' } }), env);
ok(r.headers.get('Access-Control-Allow-Origin') === 'https://shodan93.github.io', 'CORS ok');

console.log('\nErgebnis: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
