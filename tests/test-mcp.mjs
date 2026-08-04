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

  // 5b) Board-beschränktes Token (Arbeits-Token): sieht NUR das eine erlaubte Board
  const BOARD_OK = '9f32fbac-0a59-4609-88a5-63d1f1ffc005';   // "dental bauer"
  const BOARD_OTHER = '31dac948-66a3-49cf-b95c-0d9d73cc177c'; // "Life"
  const T_WORK = 'orbit_work_TESTONLY';
  const envW = {
    SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    MCP_USERS: JSON.stringify({ [T_WORK]: { owner: DAVID, boards: [BOARD_OK] } }),
  };
  const postW = (msg) => worker.fetch(new Request(base + '/mcp?key=' + T_WORK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
  }), envW);

  // list_boards -> Query enthält den in.(…)-Filter auf genau das erlaubte Board
  lastUrl = '';
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response(JSON.stringify([{ id: BOARD_OK, title: 'dental bauer', data: { tickets: [] } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  let rw = await postW(rpc('tools/call', { name: 'list_boards', arguments: {} }));
  ok(rw.status === 200 && lastUrl.includes('owner=eq.' + DAVID) && lastUrl.includes('id=in.(' + BOARD_OK), 'Arbeits-Token: list_boards ist auf das erlaubte Board eingeschränkt');

  // Erlaubtes Board per id laden -> ok
  lastUrl = '';
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response(JSON.stringify([{ id: BOARD_OK, title: 'dental bauer', data: { tickets: [] } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  rw = await postW(rpc('tools/call', { name: 'list_tickets', arguments: { board_id: BOARD_OK } }));
  ok(rw.status === 200 && !/Fehler/.test(JSON.stringify(await rw.json())), 'Arbeits-Token: erlaubtes Board (dental bauer) ist zugänglich');

  // Fremdes Board per id -> Fehler, und es geht KEINE Query dafür raus
  lastUrl = 'NOCALL';
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response(JSON.stringify([{ id: BOARD_OTHER, title: 'Life', data: { tickets: [] } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  rw = await postW(rpc('tools/call', { name: 'list_tickets', arguments: { board_id: BOARD_OTHER } }));
  const wtext = (await rw.json()).result?.content?.[0]?.text || '';
  ok(/Fehler|nicht gefunden/i.test(wtext), 'Arbeits-Token: fremdes Board (Life) liefert Fehler, keine Daten');
  ok(lastUrl === 'NOCALL', 'Arbeits-Token: fremde board_id löst gar keine Supabase-Abfrage aus');

  // Schreibversuch auf fremdes Board -> abgelehnt
  globalThis.fetch = async (u) => { lastUrl = String(u); return new Response(JSON.stringify([{ id: BOARD_OTHER, title: 'Life', data: { tickets: [] } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  rw = await postW(rpc('tools/call', { name: 'create_ticket', arguments: { board_id: BOARD_OTHER, title: 'X' } }));
  const wtext2 = (await rw.json()).result?.content?.[0]?.text || '';
  ok(/Fehler|nicht gefunden|Kein Zugriff/i.test(wtext2), 'Arbeits-Token: create_ticket auf fremdes Board wird abgelehnt');

  // 6) Nur MCP_USERS gesetzt (kein Alt-Einzelzugang) funktioniert ebenfalls
  globalThis.fetch = async (u) => { lastUrl = String(u); const body = JSON.stringify([{ id: 'b1', title: 'Testboard', data: { tickets: [] } }]); return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }); };
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
