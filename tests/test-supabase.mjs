import vm from 'node:vm';
import fs from 'node:fs';

let script = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
// Anon-Key injizieren, damit sb initialisiert wird
script = script.replace("const SUPABASE_ANON_KEY = '';", "const SUPABASE_ANON_KEY = 'fake-anon';");

// ---- kompakter DOM-Stub ----
const ctxStub = new Proxy({}, { get(_, p) { if (p === 'canvas') return { width: 300, height: 64 }; if (typeof p === 'string' && /^[a-z]/.test(p)) return () => {}; return undefined; }, set() { return true; } });
function makeEl(id) {
  const h = {};
  const el = { _id: id, dataset: {}, children: [],
    style: { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { const on = f === undefined ? !this._s.has(c) : f; on ? this._s.add(c) : this._s.delete(c); return on; }, contains(c) { return this._s.has(c); } },
    width: 300, height: 64, clientWidth: 300, clientHeight: 64, textContent: '', innerHTML: '', value: '', hidden: false, checked: false, disabled: false, offsetWidth: 200, offsetHeight: 170,
    getContext() { return ctxStub; }, addEventListener(e, fn) { (h[e] ||= []).push(fn); }, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, replaceWith() {}, focus() {}, blur() {}, click() {},
    setAttribute(k, v) { this.dataset[k] = v; }, getAttribute() { return null; }, hasAttribute() { return false; }, toggleAttribute() {}, removeAttribute() {},
    querySelector(s) { return makeEl('q:' + s); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 170, right: 200, bottom: 170 }; },
    closest() { return null; }, contains() { return false; }, reportValidity() { return true; }, get firstChild() { return null; } };
  return new Proxy(el, { get(t, p) { return p in t ? t[p] : (typeof p === 'string' && p.startsWith('on') ? t[p] : undefined); }, set(t, p, v) { t[p] = v; return true; } });
}
const elCache = {}; const getEl = id => (elCache[id] ||= makeEl(id));
const document = { getElementById: getEl, createElement: t => makeEl('new:' + t), createRange: () => ({ selectNodeContents() {}, collapse() {}, setStartAfter() {}, deleteContents() {}, insertNode() {}, setStart() {} }), querySelector: s => makeEl('q:' + s), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, elementFromPoint: () => null, elementsFromPoint: () => [], body: makeEl('body'), documentElement: makeEl('html'), hidden: false, activeElement: makeEl('a'), title: '' };

// ---- Supabase-Stub ----
const board = { id: 'board-1', title: 'Mein Board', share_code: 'abc123', owner: 'u1', data: { tickets: [{ id: 't1', title: 'Vorhanden', prio: 'Mittel', deadline: '2026-07-01', desc: 'x', note: '', cats: [], imgs: [], status: 'In Arbeit', createdAt: '2026-06-01' }], categories: [], settings: { statuses: ['A', 'B', 'C', 'D', 'E'], boardTitle: 'Geladenes Board' }, notes: [] } };
const board2 = { id: 'board-2', title: 'Neues Board', share_code: 'def456', owner: 'u1', data: { tickets: [], categories: [], settings: { statuses: ['A', 'B', 'C', 'D', 'E'], boardTitle: 'Neues Board' }, notes: [] } };
const boardsList = [board];
let updateCalled = 0, subscribed = 0;
const thenable = (val) => ({ then: (res) => res(val), eq() { updateCalled++; return Promise.resolve({ error: null }); }, select() { return this; }, single() { return Promise.resolve({ data: board, error: null }); }, order() { return Promise.resolve({ data: boardsList.slice(), error: null }); } });
let authCb = null;
const supaStub = {
  createClient() {
    return {
      auth: {
        signInWithPassword: async () => { const s = { access_token: 'tok', user: { id: 'u1', email: 'a@b.de' } }; if (authCb) authCb('SIGNED_IN', s); return { data: { session: s }, error: null }; },
        signUp: async () => ({ data: { session: null }, error: null }),
        signOut: async () => ({}),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb) => { authCb = cb; return { data: { subscription: {} } }; },
      },
      from() { return { select: () => thenable(), insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: board, error: null }) }) }), update: () => ({ eq: () => { updateCalled++; return Promise.resolve({ error: null }); } }) }; },
      storage: { from: () => ({ upload: async () => ({}), download: async () => ({ data: new (class { get type() { return 'image/png'; } })(), error: null }), remove: async () => ({}) }) },
      channel: () => ({ on() { return this; }, subscribe() { subscribed++; return this; } }),
      removeChannel() {},
      rpc: async (name) => {
        if (name === 'create_board') { if (!boardsList.some(b => b.id === 'board-2')) boardsList.push(board2); return { data: board2, error: null }; }
        return { data: 'board-1', error: null };
      },
    };
  },
};

let raf = null, perf = 1000;
const g = {
  document, navigator: { storage: null }, supabase: supaStub,
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  indexedDB: { open() { const r = {}; setTimeout(() => r.onerror && r.onerror(), 0); return r; } },
  location: { reload() {}, href: '' }, performance: { now: () => perf },
  requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame: () => { raf = null; },
  setTimeout: fn => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  fetch: async () => ({ ok: true, json: async () => ({ version: 7, supabase: true }) }),
  alert() {}, confirm: () => true, prompt: () => null,
  getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }),
  matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} },
  DOMParser: class { parseFromString(s) { return { body: { textContent: s || '', innerHTML: s || '', childNodes: [], querySelectorAll: () => [] } }; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, Blob: class {}, FileReader: class { readAsDataURL() {} },
  crypto: { randomUUID: () => 'u-' + Math.random() }, btoa: s => Buffer.from(s).toString('base64'), atob: s => Buffer.from(s, 'base64').toString(),
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Set, Map, Promise, parseInt, parseFloat, isNaN, innerWidth: 1200, innerHeight: 800,
};
g.window = g; g.globalThis = g;
const ctx = vm.createContext(g);

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };

try {
  vm.runInContext(script, ctx, { filename: 'board.js' });
  ok(true, 'Script lädt mit Supabase-Client ohne Fehler');

  // Login auslösen -> onAuthStateChange -> startSupabase -> ensureBoards -> setActiveBoard
  await vm.runInContext('document.getElementById("loginEmail").value="a@b.de"; document.getElementById("loginPass").value="geheim"; document.getElementById("btnLogin").onclick()', ctx);
  await new Promise(r => setTimeout(r, 30)); // async-Pfad abwarten

  const res = vm.runInContext('({ boardId: typeof boardId!=="undefined"?boardId:null, tickets: state.tickets.length, title: state.settings.boardTitle, statuses: STATUSES.join("|"), started: appStarted })', ctx);
  ok(res.boardId === 'board-1', 'Nach Login ist ein Board aktiv');
  ok(res.started === true, 'appStarted gesetzt');
  ok(res.tickets === 1, 'Board-Tickets aus Supabase geladen');
  ok(res.title === 'Mein Board', 'Board-Titel = title-Spalte des Boards');
  ok(res.statuses === 'A|B|C|D|E', 'Säulen aus geladenem Board aktiv');

  // Speichern auslösen
  vm.runInContext('cloudSave()', ctx);
  await new Promise(r => setTimeout(r, 10));
  ok(true, 'cloudSave() ohne Fehler (Supabase update)');

  // Ticket anlegen + render (Supabase-Modus)
  const add = vm.runInContext('(function(){ var b=state.tickets.length; openModal(null); document.getElementById("fTitle").value="Neu"; document.getElementById("fDesc").innerHTML="x"; document.getElementById("fStatus").value="B"; document.getElementById("fDeadline").value="2026-08-01"; document.getElementById("btnSave").onclick(); return state.tickets.length-b; })()', ctx);
  ok(add === 1, 'Ticket anlegen funktioniert im Supabase-Modus');

  // createBoard() nutzt die SECURITY-DEFINER-RPC (umgeht 42501 beim zweiten Account)
  await vm.runInContext('createBoard()', ctx);
  await new Promise(r => setTimeout(r, 20));
  const cb = vm.runInContext('({ id: boardId, has: myBoards.some(b => b.id === "board-2") })', ctx);
  ok(cb.id === 'board-2' && cb.has, 'createBoard() legt Board via create_board-RPC an (kein Direkt-Insert)');

} catch (e) {
  fail++; console.log('  ✗ LAUFZEITFEHLER:', e.message, '\n', (e.stack || '').split('\n').slice(0, 5).join('\n'));
}

console.log('\nErgebnis: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
