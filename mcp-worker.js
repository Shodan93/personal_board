/* =====================================================================
 * Orbit — Remote-MCP-Server (Cloudflare Worker)
 * ---------------------------------------------------------------------
 * Endpoint:  https://orbit.mumelter.org/mcp?key=<MCP_TOKEN>
 * Transport: MCP "Streamable HTTP" (JSON-RPC über POST).
 *
 * SICHERHEIT
 *  - Zugriff nur mit korrektem Token (?key=… oder Authorization: Bearer …).
 *  - ALLE Datenbankzugriffe werden serverseitig hart auf deine owner-UUID
 *    (ORBIT_OWNER_ID) gefiltert -> es ist ausschließlich DEIN Board sichtbar,
 *    niemals die Boards anderer Nutzer. Selbst eine fremde board_id liefert
 *    nichts, weil jeder Query zusätzlich owner=eq.<du> erzwingt.
 *  - Der Supabase-Service-Key liegt nur als Cloudflare-Secret im Worker.
 *
 * Erforderliche Secrets/Variablen (Worker -> Settings -> Variables & Secrets):
 *    SUPABASE_URL          z. B. https://eqrzazmdamiplqiizrat.supabase.co
 *    SUPABASE_SERVICE_KEY  Service-/Secret-Key (umgeht RLS — nur hier!)
 *    ORBIT_OWNER_ID        deine Auth-User-UUID (Supabase -> Authentication -> Users)
 *    MCP_TOKEN             frei wählbares langes Geheimnis (steht in der URL)
 *
 * Alles andere (/, index.html, …) wird unverändert als Static Asset geliefert.
 * ===================================================================== */

const SERVER_INFO = { name: "orbit", version: "1.0.0" };
const PROTO_FALLBACK = "2025-06-18";

const TOOLS = [
  { name: "list_boards", description: "Listet deine Boards (id + Titel).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_statuses", description: "Spalten/Status deines Boards in Reihenfolge.",
    inputSchema: { type: "object", properties: { board_id: { type: "string" } }, additionalProperties: false } },
  { name: "list_tickets", description: "Listet Tickets. Optional nach Status filtern, im Titel/Text suchen, Erledigte einschließen.",
    inputSchema: { type: "object", properties: {
      board_id: { type: "string" }, status: { type: "string" }, query: { type: "string" },
      include_done: { type: "boolean" } }, additionalProperties: false } },
  { name: "get_ticket", description: "Einzelnes Ticket per id.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, board_id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "create_ticket", description: "Neues Ticket anlegen. status muss eine Spalte des Boards sein (siehe list_statuses).",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, status: { type: "string" },
      prio: { type: "string", enum: ["Hoch", "Mittel", "Niedrig"] },
      deadline: { type: "string", description: "YYYY-MM-DD" },
      desc: { type: "string" }, cats: { type: "array", items: { type: "string" } },
      board_id: { type: "string" } }, required: ["title"], additionalProperties: false } },
  { name: "update_ticket", description: "Felder eines Tickets ändern (nur gesetzte werden überschrieben).",
    inputSchema: { type: "object", properties: {
      id: { type: "string" }, title: { type: "string" }, status: { type: "string" },
      prio: { type: "string", enum: ["Hoch", "Mittel", "Niedrig"] }, deadline: { type: "string" },
      desc: { type: "string" }, cats: { type: "array", items: { type: "string" } },
      board_id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "move_ticket", description: "Ticket in eine andere Spalte (Status) verschieben.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, status: { type: "string" }, board_id: { type: "string" } }, required: ["id", "status"], additionalProperties: false } },
  { name: "delete_ticket", description: "Ticket löschen.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, board_id: { type: "string" } }, required: ["id"], additionalProperties: false } },
];

const PRIOS = ["Hoch", "Mittel", "Niedrig"];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/* ---------- Supabase (REST, immer auf den Besitzer eingeschränkt) ---------- */
function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
}
async function sbGet(env, qs) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/boards?" + qs, { headers: sbHeaders(env) });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}
async function listBoards(env) {
  return sbGet(env, "select=id,title,updated_at&owner=eq." + encodeURIComponent(env.ORBIT_OWNER_ID) + "&order=updated_at.desc");
}
async function loadBoard(env, boardId) {
  let qs = "select=id,title,data&owner=eq." + encodeURIComponent(env.ORBIT_OWNER_ID);
  qs += boardId ? "&id=eq." + encodeURIComponent(boardId) : "&order=updated_at.desc&limit=1";
  const rows = await sbGet(env, qs);
  if (!rows.length) throw new Error("Kein Board gefunden, das dir gehört.");
  const b = rows[0];
  b.data = b.data || {};
  b.data.tickets = Array.isArray(b.data.tickets) ? b.data.tickets : [];
  return b;
}
async function saveData(env, id, data) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/boards?id=eq." + encodeURIComponent(id) + "&owner=eq." + encodeURIComponent(env.ORBIT_OWNER_ID), {
    method: "PATCH", headers: { ...sbHeaders(env), Prefer: "return=minimal" },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error("Supabase update " + r.status + ": " + (await r.text()).slice(0, 200));
}
function statusesOf(b) {
  const st = b.data?.settings?.statuses;
  return Array.isArray(st) && st.length ? st : ["Themenspeicher", "Geplant", "In Arbeit", "Review", "Erledigt"];
}
function doneOf(b) {
  const d = b.data?.settings?.doneStatuses;
  return Array.isArray(d) && d.length ? d : [statusesOf(b).slice(-1)[0]];
}
function pub(t) {
  return { id: t.id, title: t.title, status: t.status, prio: t.prio, deadline: t.deadline,
    desc: t.desc || "", note: t.note || "", cats: t.cats || [],
    tasks: (t.tasks || []).map((x) => ({ text: x.text, done: !!x.done })),
    createdAt: t.createdAt, completedAt: t.completedAt || null };
}

/* ---------- Tools ---------- */
async function callTool(name, a, env) {
  if (name === "list_boards") return JSON.stringify(await listBoards(env), null, 2);

  if (name === "list_statuses") return JSON.stringify(statusesOf(await loadBoard(env, a.board_id)), null, 2);

  if (name === "list_tickets") {
    const b = await loadBoard(env, a.board_id), done = doneOf(b);
    let t = b.data.tickets.slice();
    if (a.status) t = t.filter((x) => x.status === a.status);
    else if (!a.include_done) t = t.filter((x) => !done.includes(x.status));
    if (a.query) { const q = String(a.query).toLowerCase(); t = t.filter((x) => (x.title || "").toLowerCase().includes(q) || (x.desc || "").toLowerCase().includes(q)); }
    return JSON.stringify({ board: b.title, count: t.length, tickets: t.map(pub) }, null, 2);
  }

  if (name === "get_ticket") {
    const b = await loadBoard(env, a.board_id), t = b.data.tickets.find((x) => x.id === a.id);
    if (!t) throw new Error("Ticket nicht gefunden: " + a.id);
    return JSON.stringify(pub(t), null, 2);
  }

  if (name === "create_ticket") {
    if (!a.title) throw new Error("title fehlt.");
    const b = await loadBoard(env, a.board_id), st = statusesOf(b);
    const useStatus = a.status && st.includes(a.status) ? a.status : st[0];
    if (a.prio && !PRIOS.includes(a.prio)) throw new Error("prio muss Hoch/Mittel/Niedrig sein.");
    const ticket = { id: uid(), title: a.title, status: useStatus, prio: a.prio || "Mittel",
      deadline: a.deadline || today(), desc: a.desc || "", note: "", cats: a.cats || [], imgs: [], tasks: [], createdAt: today() };
    b.data.tickets = [...b.data.tickets, ticket];
    await saveData(env, b.id, b.data);
    return JSON.stringify({ created: ticket.id, status: useStatus, board: b.title }, null, 2);
  }

  if (name === "update_ticket") {
    const b = await loadBoard(env, a.board_id), t = b.data.tickets.find((x) => x.id === a.id);
    if (!t) throw new Error("Ticket nicht gefunden: " + a.id);
    if (a.status && !statusesOf(b).includes(a.status)) throw new Error("Unbekannter Status: " + a.status);
    if (a.prio && !PRIOS.includes(a.prio)) throw new Error("prio muss Hoch/Mittel/Niedrig sein.");
    for (const k of ["title", "status", "prio", "deadline", "desc", "cats"]) if (a[k] !== undefined) t[k] = a[k];
    const done = doneOf(b);
    if (done.includes(t.status) && !t.completedAt) t.completedAt = today();
    if (!done.includes(t.status)) delete t.completedAt;
    await saveData(env, b.id, b.data);
    return JSON.stringify(pub(t), null, 2);
  }

  if (name === "move_ticket") {
    const b = await loadBoard(env, a.board_id);
    if (!statusesOf(b).includes(a.status)) throw new Error("Unbekannter Status: " + a.status);
    const t = b.data.tickets.find((x) => x.id === a.id);
    if (!t) throw new Error("Ticket nicht gefunden: " + a.id);
    t.status = a.status;
    const done = doneOf(b);
    if (done.includes(a.status)) { if (!t.completedAt) t.completedAt = today(); } else delete t.completedAt;
    await saveData(env, b.id, b.data);
    return JSON.stringify({ moved: a.id, status: a.status }, null, 2);
  }

  if (name === "delete_ticket") {
    const b = await loadBoard(env, a.board_id), before = b.data.tickets.length;
    b.data.tickets = b.data.tickets.filter((x) => x.id !== a.id);
    if (b.data.tickets.length === before) throw new Error("Ticket nicht gefunden: " + a.id);
    await saveData(env, b.id, b.data);
    return JSON.stringify({ deleted: a.id }, null, 2);
  }

  throw new Error("Unbekanntes Tool: " + name);
}

/* ---------- MCP-JSON-RPC ---------- */
async function handleRpc(msg, env) {
  const { id, method, params } = msg || {};
  if (method === "initialize")
    return rpcOk(id, { protocolVersion: params?.protocolVersion || PROTO_FALLBACK, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
  if (method && method.startsWith("notifications/")) return null;   // Notifications: keine Antwort
  if (method === "ping") return rpcOk(id, {});
  if (method === "tools/list") return rpcOk(id, { tools: TOOLS });
  if (method === "tools/call") {
    const nm = params?.name, args = params?.arguments || {};
    try { return rpcOk(id, { content: [{ type: "text", text: await callTool(nm, args, env) }] }); }
    catch (e) { return rpcOk(id, { content: [{ type: "text", text: "Fehler: " + e.message }], isError: true }); }
  }
  return rpcErr(id ?? null, -32601, "Methode nicht gefunden: " + method);
}

async function handleMcp(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Token prüfen (URL-Param ?key= oder Authorization: Bearer …)
  const auth = request.headers.get("Authorization") || "";
  const token = url.searchParams.get("key") || (auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (!env.MCP_TOKEN || token !== env.MCP_TOKEN) return json({ error: "Forbidden" }, 403);   // 403 (kein 401 -> kein OAuth-Flow)
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.ORBIT_OWNER_ID)
    return json(rpcErr(null, -32002, "Server nicht konfiguriert (SUPABASE_URL/SUPABASE_SERVICE_KEY/ORBIT_OWNER_ID fehlen)."), 200);
  if (request.method === "GET") return json({ ok: true, server: SERVER_INFO });          // einfacher Healthcheck
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST", ...CORS } });

  let body;
  try { body = await request.json(); } catch { return json(rpcErr(null, -32700, "Parse error")); }
  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) { const r = await handleRpc(m, env); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const r = await handleRpc(body, env);
  return r ? json(r) : new Response(null, { status: 202, headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return handleMcp(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);   // alles andere: statische Seite
    return new Response("Not found", { status: 404 });
  },
};
