import vm from 'node:vm';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// ---- Fake DOM ----
const ctxStub = new Proxy({}, {
  get(_, p) {
    if (p === 'canvas') return { width: 300, height: 64 };
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (typeof p === 'string' && /^[a-z]/.test(p)) return () => {}; // alle Methoden no-op
    return undefined;
  },
  set() { return true; },
});

function makeEl(id) {
  const handlers = {};
  const el = {
    _id: id, dataset: {}, children: [],
    style: { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } },
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,f){ const has=this._s.has(c); const on=f===undefined?!has:f; if(on)this._s.add(c);else this._s.delete(c); return on;},
      contains(c){return this._s.has(c);} },
    width: 300, height: 64, clientWidth: 300, clientHeight: 64,
    textContent: '', innerHTML: '', value: '', hidden: false, checked: false, disabled: false,
    offsetWidth: 200, offsetHeight: 170,
    getContext() { return ctxStub; },
    addEventListener(ev, fn) { (handlers[ev] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, replaceWith() {}, focus() {}, blur() {}, click() {},
    setAttribute(k,v){ this.dataset[k]=v; }, getAttribute(){ return null; }, hasAttribute(){return false;},
    toggleAttribute(){}, removeAttribute(){},
    querySelector(sel) { return makeEl('q:'+sel); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left:0, top:0, width:200, height:170, right:200, bottom:170 }; },
    closest() { return null; }, contains(){ return false; },
    reportValidity() { return true; }, checkValidity() { return true; },
    _handlers: handlers,
    get firstChild(){ return null; },
  };
  return new Proxy(el, {
    get(t, p) { if (p in t) return t[p]; if (typeof p==='string' && p.startsWith('on')) return t[p]; return undefined; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const elCache = {};
const getEl = id => (elCache[id] ||= makeEl(id));

const docHandlers = {};
const document = {
  getElementById: getEl,
  createElement: (t) => makeEl('new:'+t),
  createRange: () => ({ selectNodeContents(){}, collapse(){}, setStartAfter(){}, deleteContents(){}, insertNode(){}, setStart(){} }),
  querySelector: (s) => makeEl('q:'+s),
  querySelectorAll: () => [],
  addEventListener: (ev, fn) => { (docHandlers[ev] ||= []).push(fn); },
  removeEventListener: () => {},
  elementFromPoint: () => null,
  elementsFromPoint: () => [],
  body: makeEl('body'),
  documentElement: makeEl('html'),
  hidden: false,
  activeElement: makeEl('active'),
};

let rafCb = null, perf = 1000;
const ctxGlobal = {
  document, window: null, navigator: { storage: null },
  localStorage: { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} },
  indexedDB: { open(){ const r={}; setTimeout(()=>r.onerror&&r.onerror(),0); return r; } },
  location: { reload(){}, href:'' },
  performance: { now: () => perf },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  cancelAnimationFrame: () => { rafCb = null; },
  setTimeout: (fn) => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  fetch: () => Promise.reject(new Error('offline-test')),
  alert: () => {}, confirm: () => true, prompt: () => null,
  getSelection: () => ({ rangeCount:0, removeAllRanges(){}, addRange(){}, getRangeAt(){return{};}, anchorNode:null }),
  matchMedia: () => ({ matches:false }),
  ResizeObserver: class { observe(){} disconnect(){} },
  DOMParser: class { parseFromString(s){ return { body: { textContent: s||'', innerHTML: s||'', childNodes: [], querySelectorAll: () => [] } }; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
  Image: class {}, Blob: class {}, FileReader: class { readAsDataURL(){} },
  crypto: { randomUUID: () => 'uuid-'+Math.random() },
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Set, Map, Promise, parseInt, parseFloat, isNaN,
  innerWidth: 1200, innerHeight: 800,
};
ctxGlobal.window = ctxGlobal;
ctxGlobal.globalThis = ctxGlobal;

const context = vm.createContext(ctxGlobal);

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

try {
  vm.runInContext(script, context, { filename: 'board.js' });
  ok(true, 'Script lädt ohne Fehler (Init/Login-Overlay)');

  // Internen Bootstrap auslösen -> startApp -> applyGimmick -> DINO.start
  // (Der UI-Button „Ohne Cloud" wurde entfernt: keine Nutzung ohne Anmeldung.)
  ok(getEl('btnLoginOffline').onclick === undefined, 'Kein „Ohne Cloud"-Button-Handler mehr (Login Pflicht)');
  vm.runInContext('startOffline()', context);
  ok(rafCb !== null, 'startApp + DINO.start registriert Frame');

  // 40 Frames pumpen
  for (let i = 0; i < 40; i++) { perf += 16; const cb = rafCb; rafCb = null; if (cb) cb(perf); }
  ok(true, '40 Frames ohne Laufzeitfehler gelaufen');

  // Viele Frames -> alle Pflanzen/Berge/Vulkan/Boden mehrfach gezeichnet
  for (let i = 0; i < 120; i++) { perf += 16; const cb = rafCb; rafCb = null; if (cb) cb(perf); }
  ok(true, 'Urzeit-Szene: 120 weitere Frames (Pflanzen/Berge/Vulkan/Boden) ohne Fehler');

  // Weltall-Szene: umschalten + lange laufen lassen, damit Rakete UND UFO spawnen (kein Fehler)
  vm.runInContext('DINO.setMode("space")', context);
  ok(vm.runInContext('DINO.getMode()', context) === 'space', 'Szene auf „Weltall" umgeschaltet');
  for (let i = 0; i < 5200; i++) { perf += 33; const cb = rafCb; rafCb = null; if (cb) cb(perf); }
  ok(true, 'Weltall-Szene: ~170s Frames (Sterne/Wandern/Sternschnuppen/Überflug) ohne Fehler');

  // Pixel-Lauf ist an den Modus gebunden: Dark = Weltall, Light = Urzeit
  const bound = vm.runInContext(`(function(){
    state.settings.theme = 'dark';  applyTheme(); var d = DINO.getMode();
    state.settings.theme = 'light'; applyTheme(); var l = DINO.getMode();
    return { d, l };
  })()`, context);
  ok(bound.d === 'space', 'Dark Mode -> Weltall-Szene (automatisch gebunden)');
  ok(bound.l === 'run', 'Light Mode -> Urzeit-Szene (automatisch gebunden)');
  for (let i = 0; i < 10; i++) { perf += 16; const cb = rafCb; rafCb = null; if (cb) cb(perf); }

// (Schiffskatze entfernt — Tests dazu ebenfalls)

  // Sticky Note + Ticket-render INNERHALB des vm (Zugriff auf let-Variablen)
  const probe = vm.runInContext(`(function(){
    addNote(100,200);
    const n = state.notes.length;
    state.tickets.push({ id:'t1', title:'Test', prio:'Hoch', deadline:'2026-06-20', desc:'x', note:'', cats:[], imgs:[], status:'In Arbeit', createdAt:'2026-06-01' });
    render();
    renderNotes();
    return { notes:n, tickets: state.tickets.length };
  })()`, context);
  ok(probe.notes === 1, 'addNote erstellt genau eine Notiz');
  ok(probe.tickets === 1, 'render() mit Ticket (Erstelldatum) ohne Fehler');

  // TICKET-ERSTELLEN VOLL DURCHSPIELEN (Bug-Suche)
  const create = vm.runInContext(`(function(){
    var before = state.tickets.length;
    openModal(null);                                       // „Neues Ticket"-Button entfernt -> direkt
    var opened = overlay.classList.contains('open');
    document.getElementById('fTitle').value = 'Neues Ticket';
    document.getElementById('fDesc').innerHTML = 'Beschreibung';
    document.getElementById('fStatus').value = 'In Arbeit';
    document.getElementById('fPrio').value = 'Hoch';
    document.getElementById('fDeadline').value = '2026-06-30';
    document.getElementById('btnSave').onclick();          // saveTicket()
    return { opened: opened, added: state.tickets.length - before };
  })()`, context);
  ok(create.opened === true, 'openModal(null): Modal öffnet sich (Neues Ticket)');
  ok(create.added === 1, 'saveTicket(): Ticket wird angelegt (BUG behoben)');

  // Erstelldatum: als Info-Punkt im Ticket-Kopf (Tooltip bei Hover)
  const created = vm.runInContext(`(function(){
    openModal('t1');
    return document.getElementById('ticketInfo').hidden === false &&
           /Erstellt am/.test(document.getElementById('ticketInfo').title);
  })()`, context);
  ok(created, 'Erstelldatum als Info-Punkt im Ticket-Kopf (Hover-Tooltip)');

  // Öffnen eines Tickets setzt automatisch status „geöffnet"
  const openedStatus = vm.runInContext(`(function(){
    state.tickets = [{ id:'o1', title:'Open', prio:'Mittel', deadline:'2026-06-25', desc:'', note:'', cats:[], imgs:[], status:'In Arbeit', createdAt:'2026-06-01' }];
    openModal('o1');
    return state.tickets[0].opened;
  })()`, context);
  ok(openedStatus === 'geöffnet', 'openModal markiert Ticket automatisch als „geöffnet"');

  // Deep-Link: #t=<id> öffnet das Ticket in der Kanban-Ansicht
  const deep = vm.runInContext(`(function(){
    state.tickets = [{ id:'dl1', title:'Link', prio:2, deadline:'2099-01-01', desc:'', note:'', cats:[], imgs:[], tasks:[], status:'In Arbeit', createdAt:'2026-01-01' }];
    render();
    setView('list');                       // absichtlich falsche Ansicht
    location.hash = '#t=dl1';
    openTicketFromHash();
    return { v: view, editing: editingId, url: ticketUrl('dl1') };
  })()`, context);
  ok(deep.v === 'kanban' && deep.editing === 'dl1', 'Deep-Link #t=<id> öffnet Ticket in der Kanban-Ansicht');
  ok(/#t=dl1$/.test(deep.url), 'ticketUrl erzeugt #t=<id>-Link');
  vm.runInContext('closeModal(); location.hash = ""', context);

  // Aktive Suche übersteuert die Fälligkeits-Schnellfilter (Liste)
  const searchOverride = vm.runInContext(`(function(){
    state.tickets = [{ id:'so1', title:'Zukunftsticket', prio:3, deadline:'2099-01-01', desc:'', note:'', cats:[], imgs:[], tasks:[], status:'In Arbeit', createdAt:'2026-01-01' }];
    quick = 'today';                                   // Filter allein würde alles ausblenden
    document.getElementById('search').value = 'Zukunft';
    var before = document.getElementById('listBody').children.length;
    renderList();
    var after = document.getElementById('listBody').children.length;
    document.getElementById('search').value = ''; quick = '';
    return after - before;
  })()`, context);
  ok(searchOverride >= 1, 'Aktive Suche übersteuert den „heute fällig"-Filter');

  // Editierbare Listenzeile: entsteht ohne Fehler, trägt die Prio-Farbklasse
  const listRow = vm.runInContext(`(function(){
    var el = listRowEl(state.tickets[0]);
    return el && /lp-3/.test(el.className);
  })()`, context);
  ok(listRow, 'listRowEl: editierbare Zeile mit Prio-Farbklasse (lp-3)');

  // Rückgängig / Wiederholen (Strg+Z / Strg+Shift+Z)
  const hist = vm.runInContext(`(function(){
    state.tickets = []; resetHistory();
    state.tickets.push({ id:'u1', title:'Undo', prio:'Mittel', deadline:'2026-06-25', desc:'', note:'', cats:[], imgs:[], status:'In Arbeit', createdAt:'2026-06-01' });
    save();                       // captureHistory -> ein Verlaufseintrag
    var afterAdd = state.tickets.length;
    undo();                       // zurück auf leer
    var afterUndo = state.tickets.length;
    redo();                       // wieder her
    var afterRedo = state.tickets.length;
    return { afterAdd, afterUndo, afterRedo };
  })()`, context);
  ok(hist.afterAdd === 1, 'Verlauf: Ticket hinzugefügt');
  ok(hist.afterUndo === 0, 'Strg+Z macht das Hinzufügen rückgängig');
  ok(hist.afterRedo === 1, 'Strg+Shift+Z stellt es wieder her');

  // Verbindungsstatus in den Einstellungen: „Verbunden" bzw. „Offline"
  const conn = vm.runInContext(`(function(){
    var prev = auth;
    auth = { user: 'tester@example.com', name: 't' };
    setSync(true);  var g = document.getElementById('setConnStatus').textContent;
    setSync(false); var r = document.getElementById('setConnStatus').textContent;
    auth = prev;
    return { g, r };
  })()`, context);
  ok(/Verbunden/.test(conn.g), 'Einstellungen: Status „Verbunden" bei aktiver Verbindung');
  ok(/Offline/.test(conn.r), 'Einstellungen: Status „Offline" bei Trennung');

  // Generalisiertes Board: eigene Säulen + Titel über die Einstellungen
  const gen = vm.runInContext(`(function(){
    state.settings.statuses = ['Ideen','Recherche','Schreiben','Lektorat','Veröffentlicht'];
    state.settings.boardTitle = 'Mein Buch';
    applyBoardConfig();
    state.tickets = [{ id:'g1', title:'Kap.1', prio:'Mittel', deadline:'2026-07-01', desc:'x', note:'', cats:[], imgs:[], status:'Schreiben', createdAt:'2026-06-10' }];
    render();
    return {
      statuses: STATUSES.join('|'), done: DONE.join('|'),
      title: document.title,
      ncols: document.getElementById('kanban').style.getPropertyValue('--ncols')
    };
  })()`, context);
  ok(gen.statuses === 'Ideen|Recherche|Schreiben|Lektorat|Veröffentlicht', 'Board: eigene 5 Säulen aktiv');

  // Spalten deaktivieren: weniger Säulen, Tickets bleiben erhalten (nur ausgeblendet)
  const colToggle = vm.runInContext(`(function(){
    state.settings.disabledStatuses = ['Recherche', 'Lektorat'];
    applyBoardConfig();
    var active = ACTIVE_STATUSES.join('|');
    var full = STATUSES.join('|');
    state.tickets = [{ id:'dis1', title:'Versteckt', prio:2, deadline:'2099-01-01', desc:'', note:'', cats:[], imgs:[], tasks:[], status:'Recherche', createdAt:'2026-01-01' }];
    migrateTickets();                       // darf den Status NICHT wegmigrieren
    var kept = state.tickets[0].status === 'Recherche';
    var ncols = document.getElementById('kanban').style.getPropertyValue('--ncols');
    state.settings.disabledStatuses = []; applyBoardConfig();
    return { active, full, kept, ncols: String(ncols) };
  })()`, context);
  ok(colToggle.active === 'Ideen|Schreiben|Veröffentlicht', 'Deaktivierte Spalten fehlen in ACTIVE_STATUSES');
  ok(colToggle.full.split('|').length === 5, 'Volle Spaltenliste bleibt erhalten (keine Datenmigration)');
  ok(colToggle.kept === true, 'Ticket in deaktivierter Spalte behält seinen Status');
  ok(colToggle.ncols === '3', 'Kanban zeigt nur die aktiven Spalten (--ncols)');
  ok(gen.done === 'Veröffentlicht', 'Board: letzte Säule = erledigt');
  ok(gen.title.indexOf('Mein Buch')===0, 'Board: eigener Titel im Header');
  ok(String(gen.ncols) === '5', 'Board: Kanban auf 5 Spalten');

  // Export -> Import übernimmt Säulen + Titel + Voreinstellungen
  const imp = vm.runInContext(`(function(){
    var snapshot = JSON.stringify({ version:3, tickets: state.tickets, categories: state.categories,
      settings: { statuses:['A','B','C'], boardTitle:'Importiert', defaultView:'kanban', kanbanSort:'deadline' } });
    var data = JSON.parse(snapshot);
    state.tickets = data.tickets; state.categories = data.categories;
    state.settings = Object.assign(defaultSettings(), data.settings);
    setColumnsFromSettings(); migrateTickets(); ensureCategories(); applyBoardConfig();
    return { statuses: STATUSES.join('|'), title: document.title, ncols: document.getElementById('kanban').style.getPropertyValue('--ncols') };
  })()`, context);
  ok(imp.statuses === 'A|B|C', 'Import: Säulen aus Datei übernommen');
  ok(imp.title.indexOf('Importiert')===0, 'Import: Boardtitel übernommen');
  ok(String(imp.ncols) === '3', 'Import: Spaltenzahl angepasst');

  // Manuell markierte „Erledigt"-Säule (nicht die letzte): keine Eskalation, gilt als erledigt
  const doneCol = vm.runInContext(`(function(){
    state.settings.statuses = ['A','B','C'];
    state.settings.doneStatuses = ['B'];                 // mittlere Spalte = erledigt
    applyBoardConfig();
    var past = '2000-01-01';
    var tDone = { id:'d1', title:'x', prio:'Hoch', deadline:past, desc:'', note:'', cats:[], imgs:[], status:'B', createdAt:'2000-01-01' };
    var tOpen = { id:'o1', title:'y', prio:'Hoch', deadline:past, desc:'', note:'', cats:[], imgs:[], status:'A', createdAt:'2000-01-01' };
    return {
      DONE: DONE.join('|'),
      doneNoEscal: deadlineClass(tDone) === '' && doneClass(tDone).indexOf('done') === 0,
      openOverdue: deadlineClass(tOpen) === 'overdue'
    };
  })()`, context);
  ok(doneCol.DONE === 'B', 'Erledigt-Säule kommt aus den Einstellungen (mittlere Spalte)');
  ok(doneCol.doneNoEscal, 'Ticket in Erledigt-Säule: keine Eskalationsfärbung, gilt als erledigt');
  ok(doneCol.openOverdue, 'Überfälliges Ticket in offener Säule bleibt rot (overdue)');

  // Kanban-Ticketsuche
  const search = vm.runInContext(`(function(){
    state.settings.statuses = ['A','B','C']; state.settings.doneStatuses = ['C'];
    applyBoardConfig();
    state.tickets = [
      { id:'s1', title:'Rechnung schreiben', prio:'Hoch', deadline:'2026-07-01', desc:'an Kunde X', note:'', cats:['Finanzen'], imgs:[], status:'A', createdAt:'2026-06-01' },
      { id:'s2', title:'Urlaub planen', prio:'Mittel', deadline:'2026-07-02', desc:'Flüge buchen', note:'', cats:[], imgs:[], status:'A', createdAt:'2026-06-01' }
    ];
    return {
      titleHit: matchesSearch(state.tickets[0], 'rechnung'),
      descHit: matchesSearch(state.tickets[1], 'flüge'),
      catHit: matchesSearch(state.tickets[0], 'finanzen'),
      miss: matchesSearch(state.tickets[1], 'rechnung'),
      empty: matchesSearch(state.tickets[0], '')
    };
  })()`, context);
  ok(search.titleHit && search.descHit && search.catHit, 'Kanban-Suche trifft Titel, Beschreibung und Kategorie');
  ok(!search.miss, 'Kanban-Suche: Nicht-Treffer wird ausgefiltert');
  ok(search.empty, 'Kanban-Suche: leere Eingabe zeigt alles');

  // renderKanban mit aktiver Suche läuft fehlerfrei
  vm.runInContext('kanbanSearch = "urlaub"; renderKanban(); kanbanSearch = "";', context);
  ok(true, 'renderKanban() mit aktiver Suche ohne Fehler');

  // Aufgaben-Checkliste: anlegen, speichern, wieder öffnen
  const tasks = vm.runInContext(`(function(){
    openModal(null);
    document.getElementById('fTitle').value = 'Mit Aufgaben';
    document.getElementById('fDesc').innerHTML = 'x';
    document.getElementById('fStatus').value = STATUSES[0];
    document.getElementById('fDeadline').value = '2026-09-01';
    modalTasks = [{ text:'Schritt 1', done:true }, { text:'Schritt 2', done:false }, { text:'', done:false }];
    document.getElementById('btnSave').onclick();
    var t = state.tickets.find(x => x.title === 'Mit Aufgaben');
    return { count: t.tasks.length, doneCount: t.tasks.filter(x=>x.done).length, firstDone: t.tasks[0].done, names: t.tasks.map(x=>x.text).join('|') };
  })()`, context);
  ok(tasks.count === 2, 'Aufgaben: leere Zeilen werden verworfen, gefüllte gespeichert');
  ok(tasks.doneCount === 1 && tasks.firstDone === true, 'Aufgaben: erledigt-Status wird gespeichert');
  ok(tasks.names === 'Schritt 1|Schritt 2', 'Aufgaben: Reihenfolge + Texte korrekt');

  // Notiz-Persistenz über Supabase (boardSnapshot -> loadBoardData), kein localStorage
  const notesPersist = vm.runInContext(`(function(){
    state.notes = [{ id:'n1', x:10, y:80, w:160, h:120, text:'wichtig' }];
    var snap = boardSnapshot();              // genau das wird in Supabase gespeichert
    var inSnap = Array.isArray(snap.notes) && snap.notes.length === 1 && snap.notes[0].text === 'wichtig';
    state.notes = [];                        // simuliert Neuladen aus der Cloud
    loadBoardData({ title: 'B', data: snap });
    return inSnap && state.notes.length === 1 && state.notes[0].text === 'wichtig';
  })()`, context);
  ok(notesPersist, 'Notizen werden über Supabase (boardSnapshot/loadBoardData) persistiert');

  // Kein localStorage mehr in Benutzung
  ok(Object.keys(ctxGlobal.localStorage._d).length === 0, 'Kein localStorage-Schreibzugriff mehr (alles in Supabase)');

  // Prioritäts-Kreise (P1–P5) setzen das versteckte #fPrio; Alt-Werte werden gemappt
  vm.runInContext('setPrioPicker("1")', context);
  ok(vm.runInContext('document.getElementById("fPrio").value', context) === '1', 'Prio-Kreise setzen verstecktes #fPrio (P1)');
  vm.runInContext('setPrioPicker("Hoch")', context);
  ok(vm.runInContext('document.getElementById("fPrio").value', context) === '1', 'Alt-Wert „Hoch" wird zu P1 gemappt');
  ok(vm.runInContext('normPrio("Niedrig")', context) === 4 && vm.runInContext('normPrio(5)', context) === 4 && vm.runInContext('normPrio(7)', context) === 3, 'normPrio: Niedrig->4, P5->P4, ungültig->3');

  // deadlineLabel: relative Bezeichnungen statt Kalender-Emoji
  const dl = vm.runInContext('({ heute: deadlineLabel({deadline: todayStr(), status:"A"}), keins: deadlineLabel({deadline:"", status:"A"}) })', context);
  ok(dl.heute === 'Heute', 'deadlineLabel: heutiges Datum -> „Heute"');
  ok(dl.keins === 'kein Datum', 'deadlineLabel: leeres Datum -> „kein Datum"');

  // Beschreibung ist kein Pflichtfeld mehr
  const noDesc = vm.runInContext(`(function(){
    var b = state.tickets.length;
    openModal(null);
    document.getElementById('fTitle').value = 'Ohne Beschreibung';
    document.getElementById('fDesc').innerHTML = '';
    document.getElementById('fStatus').value = STATUSES[0];
    document.getElementById('fDeadline').value = '2026-09-09';
    document.getElementById('btnSave').onclick();
    return state.tickets.length - b;
  })()`, context);
  ok(noDesc === 1, 'Ticket ohne Beschreibung speicherbar (kein Pflichtfeld)');

  // Minigame-Klicks lösen UFO/Meteor aus (5×/10×) — ohne Laufzeitfehler
  const dinoClick = vm.runInContext(`(function(){
    var cv = document.getElementById('dinoCv');
    var h = (cv._handlers && cv._handlers.click) || [];
    if (!h.length) return 'no-handler';
    for (var i=0;i<10;i++) h[0]({ clientX: 5, clientY: 5 });
    return 'ok';
  })()`, context);
  ok(dinoClick === 'ok', 'Minigame-Klicks (5×→UFO, 10×→Meteor) laufen fehlerfrei');

  // Entfernte Features sind wirklich weg
  ok(getEl('btnExportIcs').onclick === undefined, 'In-Kalender-/ICS-Funktion entfernt');
  ok(getEl('btnLogDate').onclick === undefined, 'Datumszeile-Funktion entfernt');
  ok(getEl('btnCatAdd').onclick === undefined, 'Kategorie-Anlegen im Ticket entfernt');
  // Read-only-Sharing: Bearbeiten blockiert, wenn boardReadOnly
  const ro = vm.runInContext(`(function(){
    state.tickets = [{ id:'roT', title:'X', prio:'Mittel', deadline:todayStr(), desc:'', note:'', cats:[], imgs:[], tasks:[], status:STATUSES[0], createdAt:todayStr() }];
    boardReadOnly = true;
    var before = state.tickets.length;
    openModal(null);                                   // darf KEIN neues Ticket öffnen
    var openedNew = overlay.classList.contains('open');
    var t = state.tickets[0]; var oldStatus = t.status;
    moveToStatus(t, STATUSES[1]);                      // darf NICHT verschieben
    var moved = t.status !== oldStatus;
    var saved = saveTicket();                          // requireEdit -> false, kein Save
    boardReadOnly = false;
    return { openedNew: openedNew, moved: moved };
  })()`, context);
  ok(ro.openedNew === false, 'Nur-Lesen: kein neues Ticket per openModal(null)');
  ok(ro.moved === false, 'Nur-Lesen: moveToStatus verschiebt nicht');

  // Warnung beim Verschieben in eine „erledigt"-Säule mit offenen Aufgaben
  const mv = vm.runInContext(`(function(){
    state.settings.statuses = ['Todo','Done']; state.settings.doneStatuses = ['Done']; applyBoardConfig();
    var t = { id:'mv1', title:'x', prio:'Mittel', deadline:todayStr(), desc:'', note:'', cats:[], imgs:[], tasks:[{text:'a',done:false}], status:'Todo', createdAt:todayStr() };
    state.tickets = [t];
    var orig = globalThis.confirm;
    globalThis.confirm = function(){ return false; };
    moveToStatus(t, 'Done'); var stayed = t.status;          // offene Aufgabe + abgelehnt
    globalThis.confirm = function(){ return true; };
    moveToStatus(t, 'Done'); var moved = t.status;           // bestätigt
    globalThis.confirm = orig;
    return { stayed: stayed, moved: moved };
  })()`, context);
  ok(mv.stayed === 'Todo', 'Offene Aufgaben + Abbruch -> Ticket bleibt in alter Säule');
  ok(mv.moved === 'Done', 'Offene Aufgaben + Bestätigt -> Ticket wird verschoben');

  // Kopieren: Titel/Beschreibung/Notiz/Aufgaben formatiert
  const info = vm.runInContext(`(function(){
    document.getElementById('fTitle').value = 'Titel X';
    document.getElementById('fDesc').innerHTML = 'Beschreibung Y';
    document.getElementById('fNote').innerHTML = 'Notiz Z';
    modalTasks = [{text:'A',done:true},{text:'B',done:false}];
    return ticketInfoText();
  })()`, context);
  ok(/Titel X/.test(info) && /Beschreibung Y/.test(info) && /Notiz:\nNotiz Z/.test(info) && /☑ A/.test(info) && /☐ B/.test(info),
     'Kopieren: Titel + Beschreibung + Notiz + Aufgaben korrekt formatiert');

  // Dark Mode umschalten
  const dON = vm.runInContext(`(function(){ state.settings.theme='dark'; applyTheme(); return document.documentElement.dataset.theme; })()`, context);
  ok(dON === 'dark', 'Dark Mode: data-theme="dark" gesetzt');
  const dOFF = vm.runInContext(`(function(){ state.settings.theme='light'; applyTheme(); return document.documentElement.dataset.theme; })()`, context);
  ok(dOFF === '', 'Light Mode: data-theme zurückgesetzt');

  // BUGFIX H1: Ticket ohne prio/deadline darf das Board nicht crashen
  const robust = vm.runInContext(`(function(){
    state.settings.statuses = ['A','B','C']; state.settings.doneStatuses = ['C']; applyBoardConfig();
    state.tickets = [{ id:'bad1', title:'Kaputt', status:'A', cats:[], imgs:[], tasks:[] }]; // KEIN prio/deadline
    migrateTickets();
    var ok1 = state.tickets[0].prio === 3 && state.tickets[0].deadline === '';
    render();                 // darf nicht werfen
    return ok1;
  })()`, context);
  ok(robust, 'Malformed Ticket (ohne prio/deadline) wird normalisiert und rendert ohne Crash');

  // BUGFIX M1: Spaltennamen mit < werden in Optionen escaped
  const escName = vm.runInContext(`(function(){
    state.settings.statuses = ['<img x>','B']; state.settings.doneStatuses=['B']; applyBoardConfig();
    refreshStatusOptions();
    return document.getElementById('fStatus').innerHTML.indexOf('<img x>') === -1;
  })()`, context);
  ok(escName, 'Spaltennamen werden in Status-Optionen escaped (kein HTML-Inject)');

  // Aufgaben per Drag&Drop umsortieren (moveTask)
  const reorder = vm.runInContext(`(function(){
    modalTasks = [{text:'A',done:false},{text:'B',done:false},{text:'C',done:false}];
    moveTask(0, 2);   // A hinter B schieben -> B, A, C
    var r1 = modalTasks.map(t=>t.text).join('');
    moveTask(2, 0);   // C nach vorne -> C, B, A
    var r2 = modalTasks.map(t=>t.text).join('');
    return r1 + '|' + r2;
  })()`, context);
  ok(reorder === 'BAC|CBA', 'Aufgaben lassen sich per moveTask() umsortieren');

  // Kalenderwoche
  ok(vm.runInContext('isoWeek(new Date(2024,0,1))', context) === 1, 'isoWeek: 01.01.2024 (Mo) = KW 1');
  ok(typeof vm.runInContext('isoWeek(new Date())', context) === 'number', 'isoWeek liefert Zahl für heute');

  // Fällig-Fenster: „diese Woche" = ECHTE Kalenderwoche (bis So), 30 Tage rollierend
  const win = vm.runInContext(`(function(){
    var mk = (off, status) => ({ deadline: addDays(todayStr(), off), status: status || 'In Arbeit' });
    var dow = (new Date().getDay() + 6) % 7;      // Mo=0 … So=6
    var toSun = 6 - dow;                           // Tage bis Sonntag dieser Woche
    return {
      heute:    isToday(mk(0)),
      faellig:  isDue(mk(-3)) && isDue(mk(0)) && !isDue(mk(1)),      // überfällig+heute, nicht morgen
      inWoche:  isThisWeek(mk(0)) && isThisWeek(mk(toSun)),          // heute + Sonntag -> diese Woche
      nachWoche: isThisWeek(mk(toSun + 1)),                          // Montag nächster Woche -> NICHT
      t20:      isNext30Days(mk(20)),
      t40:      isNext30Days(mk(40)),
      ueber:    isNext30Days(mk(-3)),
      erledigt: isNext30Days(mk(5, DONE[DONE.length-1] || 'Erledigt'))
    };
  })()`, context);
  ok(win.heute === true,  'isToday: heute fällig');
  ok(win.faellig === true, 'isDue („fällig"): überfällig + heute, nicht morgen');
  ok(win.inWoche === true && win.nachWoche === false, 'isThisWeek: echte Kalenderwoche (bis Sonntag)');
  ok(win.t20 === true && win.t40 === false, 'isNext30Days: nächste 30 Tage (nicht Kalendermonat)');
  ok(win.ueber === false, 'Fällig-Fenster ignoriert überfällige Tickets');
  ok(win.erledigt === false, 'Fällig-Fenster ignoriert erledigte Tickets');

  // Wiederkehrende Tickets: Termin-Berechnung + Respawn nach Abschluss
  const rec = vm.runInContext(`(function(){
    state.settings.statuses = ['Offen','Doing','Fertig']; state.settings.doneStatuses = ['Fertig'];
    state.settings.disabledStatuses = []; applyBoardConfig();
    var day3 = nextRecurDate('2026-07-06', { every: 3, unit: 'day', weekdays: [] });          // Mo +3
    var satW = nextRecurDate('2026-07-06', { every: 1, unit: 'week', weekdays: [5] });        // Mo -> Sa gleiche Woche
    var sat2 = nextRecurDate('2026-07-11', { every: 2, unit: 'week', weekdays: [5] });        // Sa -> Sa in 2 Wochen
    var mClamp = nextRecurDate('2026-01-31', { every: 1, unit: 'month', weekdays: [] });      // 31.1. -> 28.2.
    var t1 = { id:'r1', title:'Serie', prio:2, deadline:'2026-07-06', desc:'', note:'', cats:[], imgs:[], tasks:[],
               status:'Doing', createdAt:'2026-07-01', recur: normRecur({ every:3, unit:'day' }) };
    state.tickets = [t1];
    setStatus(t1, 'Fertig');                       // Abschluss -> Respawn
    var respawn = { status: t1.status, deadline: t1.deadline, done: t1.recur.done, completed: 'completedAt' in t1 };
    var t2 = { id:'r2', title:'Ende', prio:2, deadline:'2026-07-06', desc:'', note:'', cats:[], imgs:[], tasks:[],
               status:'Doing', createdAt:'2026-07-01', recur: normRecur({ every:1, unit:'day', endCount:1, done:1 }) };
    state.tickets.push(t2);
    setStatus(t2, 'Fertig');                       // Serie zu Ende -> bleibt erledigt
    var ended = { status: t2.status, completed: !!t2.completedAt };
    return { day3, satW, sat2, mClamp, respawn, ended };
  })()`, context);
  ok(rec.day3 === '2026-07-09', 'Recur: alle 3 Tage -> +3 Tage');
  ok(rec.satW === '2026-07-11', 'Recur: wöchentlich am Sa (von Mo) -> Sa derselben Woche');
  ok(rec.sat2 === '2026-07-25', 'Recur: alle 2 Wochen am Sa -> Sa in 2 Wochen');
  ok(rec.mClamp === '2026-02-28', 'Recur: monatlich klemmt 31. auf Monatsende');
  ok(rec.respawn.status === 'Offen' && rec.respawn.deadline === '2026-07-09' && rec.respawn.done === 1 && rec.respawn.completed === false,
     'Recur: Abschluss legt Ticket mit neuem Termin zurück in die erste Spalte');
  ok(rec.ended.status === 'Fertig' && rec.ended.completed === true, 'Recur: Serie zu Ende -> Ticket bleibt erledigt');

  // Auto-Theme nach Uhrzeit
  const auto = vm.runInContext(`(function(){
    state.settings.themeMode = 'auto'; state.settings.darkFrom = '00:00'; state.settings.darkTo = '24:00';
    applyTheme(); var allDark = document.documentElement.dataset.theme === 'dark';
    state.settings.darkFrom = '23:58'; state.settings.darkTo = '23:59';
    applyTheme(); var tinyWin = document.documentElement.dataset.theme === 'dark';
    state.settings.themeMode = 'manual'; state.settings.theme = 'light'; applyTheme();
    return { allDark, tinyWin, manual: document.documentElement.dataset.theme };
  })()`, context);
  ok(auto.allDark === true, 'Auto-Theme: Fenster 00:00-24:00 -> dunkel');
  ok(auto.manual === '', 'Auto-Theme aus -> manueller Light Mode greift wieder');

  // Spalte direkt umbenennen
  const rename = vm.runInContext(`(function(){
    state.settings.statuses = ['A','B','C']; state.settings.doneStatuses = ['C']; applyBoardConfig();
    state.tickets = [{ id:'rs1', title:'x', prio:'Mittel', deadline:todayStr(), desc:'', note:'', cats:[], imgs:[], tasks:[], status:'B', createdAt:todayStr() }];
    boardReadOnly = false;
    renameStatus('B', 'Beta');
    return { hasBeta: STATUSES.includes('Beta'), noB: !STATUSES.includes('B'), ticket: state.tickets[0].status };
  })()`, context);
  ok(rename.hasBeta && rename.noB, 'renameStatus: Spalte umbenannt (B -> Beta)');
  ok(rename.ticket === 'Beta', 'renameStatus: Tickets folgen dem neuen Spaltennamen');

  // Dino-Spiel (eigenständig, Leertaste)
  vm.runInContext('DinoGame.start()', context);
  ok(vm.runInContext('DinoGame.isOpen()', context) === true, 'Leertaste startet das Dino-Spiel');
  for (let i = 0; i < 40; i++) { perf += 16; const cb = rafCb; rafCb = null; if (cb) cb(perf); }
  vm.runInContext('DinoGame.jump()', context); vm.runInContext('DinoGame.setDuck(true)', context);
  for (let i = 0; i < 40; i++) { perf += 16; const cb = rafCb; rafCb = null; if (cb) cb(perf); }
  vm.runInContext('DinoGame.close()', context);
  ok(vm.runInContext('DinoGame.isOpen()', context) === false, 'Dino-Spiel läuft (Physik/Hindernisse/Score) + schließt ohne Fehler');

} catch (e) {
  fail++; console.log('  ✗ LAUFZEITFEHLER:', e.message, '\n', (e.stack||'').split('\n').slice(0,4).join('\n'));
}

console.log('\nErgebnis: ' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
