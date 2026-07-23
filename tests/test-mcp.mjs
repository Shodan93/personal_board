/* =====================================================================
 * Tests für den Remote-MCP-Server (mcp-worker.js)
 * Fokus: Token -> Owner-Auflösung und harte owner-Filterung pro Person.
 * global fetch wird gemockt (kein echtes Supabase nötig): wir prüfen,
 * mit WELCHER owner-UUID der Server die Supabase-REST-URL aufruft.
 * ===================================================================== */
import worker from '../mcp-worker.js';

const DAVID = '310705ff-fd41-4ad1-a940-877178191730';
const SVENJA = '345534e7-89bf-4d07-951c-8f08b17a079d';
const T_DAVID = 'orbit_david_TESTONLY';
const T_SVENJA = 'orbit_svenja_TESTONLY';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service_test',
  // Alt-Einzelzugang (David) + neue JSON-Map (David + Svenja)
  MCP_TOKEN: T_DAVID,
  ORBIT_OWNER_ID: DAVID,
  MCP_USERS: JSON.stringify({ [T_SVENJA]: SVENJA }),
};

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

// fetch-Mock: merkt sich die zuletzt aufgerufene Supabase-URL und liefert 1 Board zurück
let lastUrl = '';
globalThis.fetch = async (u) => {
  lastUrl = String(u);
  const body = JSON.stringify([{ id: 'b1', title: 'Testboard', data: { tickets: [] } }]);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const base = 'https://orbit.mumelter.org';
const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
const post = (token, msg) => worker.fetch(new Request(base + '/mcp' + (token ? '?key=' + token : ''), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
}), env);

console.log('\nMCP-Server — Token/Owner-Scoping');
try {
  // 1) Kein Token -> 403
  let r = await post('', rpc('tools/list', {}));
  ok(r.status === 403, 'Ohne Token -> 403');

  // 2) Falsches Token -> 403
  r = await post('orbit_falsch', rpc('tools/list', {}));
  ok(r.status === 403, 'Ungültiges Token -> 403');

  // 3) Davids Token (Alt-Einzelzugang) -> list_boards fragt mit Davids owner
  lastUrl = '';
  r = await post(T_DAVID, rpc('tools/call', { name: 'list_boards', arguments: {} }));
  ok(r.status === 200, 'Davids Token akzeptiert (200)');
  ok(lastUrl.includes('owner=eq.' + DAVID), 'David -> Supabase-Query filtert auf Davids owner');
  ok(!lastUrl.includes(SVENJA), 'David -> Svenjas owner kommt NICHT vor');

  // 4) Svenjas Token (JSON-Map) -> list_boards fragt mit Svenjas owner
  lastUrl = '';
  r = await post(T_SVENJA, rpc('tools/call', { name: 'list_boards', arguments: {} }));
  ok(r.status === 200, 'Svenjas Token akzeptiert (200)');
  ok(lastUrl.includes('owner=eq.' + SVENJA), 'Svenja -> Supabase-Query filtert auf Svenjas owner');
  ok(!lastUrl.includes(DAVID), 'Svenja -> Davids owner kommt NICHT vor (Isolation)');

  // 5) Svenja kann kein fremdes Board per board_id laden (owner-Filter erzwingt Leere)
  lastUrl = '';
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const res = await post(T_SVENJA, rpc('tools/call', { name: 'list_tickets', arguments: { board_id: 'fremdes-board' } }));
  const payload = await res.json();
  const text = payload.result?.content?.[0]?.text || '';
  ok(lastUrl.includes('owner=eq.' + SVENJA) && lastUrl.includes('id=eq.fremdes-board'), 'Svenja + fremde board_id -> Query bleibt auf Svenjas owner beschränkt');
  ok(/Fehler|nicht gefunden/i.test(text), 'Fremde board_id liefert kein fremdes Board (Fehler statt Daten)');

  // 6) Nur MCP_USERS gesetzt (kein Alt-Einzelzugang) funktioniert ebenfalls
  const env2 = { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY, MCP_USERS: JSON.stringify({ [T_SVENJA]: SVENJA }) };
  lastUrl = '';
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response(JSON.stringify([{ id: 'b1', title: 'T', data: { tickets: [] } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const r6 = await worker.fetch(new Request(base + '/mcp?key=' + T_SVENJA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpc('tools/call', { name: 'list_boards', arguments: {} })) }), env2);
  ok(r6.status === 200 && lastUrl.includes('owner=eq.' + SVENJA), 'MCP_USERS allein (ohne MCP_TOKEN) genügt für Svenjas Zugang');

  console.log('\nErgebnis: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
  if (fail) process.exit(1);
} catch (e) {
  console.error('Testlauf abgebrochen:', e);
  process.exit(1);
}
