#!/usr/bin/env node
/* =====================================================================
 * Orbit MCP-Server
 * ---------------------------------------------------------------------
 * Stellt dem Claude-Chat (Claude Desktop o. Ä.) Werkzeuge bereit, um die
 * Tickets deines Orbit-Boards in Supabase zu LESEN und zu ERSTELLEN.
 *
 * Orbit speichert ein Board als eine Zeile in der Tabelle `boards`:
 *   { id, owner, title, data: { tickets[], categories[], settings, notes[] }, ... }
 * Tickets liegen also als JSONB-Array unter data.tickets.
 *
 * Konfiguration über Umgebungsvariablen (siehe README / .env.example):
 *   SUPABASE_URL          z. B. https://<projektref>.supabase.co
 *   SUPABASE_SERVICE_KEY  Service-Role-/Secret-Key (NUR lokal! umgeht RLS)
 *   ORBIT_BOARD_ID        Standard-Board-UUID (optional; sonst je Aufruf angeben)
 * ===================================================================== */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_BOARD = process.env.ORBIT_BOARD_ID || null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("[orbit-mcp] Bitte SUPABASE_URL und SUPABASE_SERVICE_KEY setzen.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const PRIOS = ["Hoch", "Mittel", "Niedrig"];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const ok = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: "Fehler: " + msg }] });

async function loadBoard(boardId) {
  const id = boardId || DEFAULT_BOARD;
  if (!id) throw new Error("Keine board_id angegeben und ORBIT_BOARD_ID ist nicht gesetzt. Nutze zuerst list_boards.");
  const { data, error } = await sb.from("boards").select("id,title,data").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Board nicht gefunden: " + id);
  data.data = data.data || {};
  data.data.tickets = Array.isArray(data.data.tickets) ? data.data.tickets : [];
  return data;
}
async function saveData(id, data) {
  const { error } = await sb.from("boards").update({ data, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}
function statusesOf(board) {
  const st = board.data?.settings?.statuses;
  return Array.isArray(st) && st.length ? st : ["Themenspeicher", "Geplant", "In Arbeit", "Review", "Erledigt"];
}
function publicTicket(t) {
  // schlanke Sicht fürs Modell (ohne Bild-Blobs etc.)
  return { id: t.id, title: t.title, status: t.status, prio: t.prio, deadline: t.deadline,
    desc: t.desc || "", note: t.note || "", cats: t.cats || [],
    tasks: (t.tasks || []).map(x => ({ text: x.text, done: !!x.done })),
    createdAt: t.createdAt, completedAt: t.completedAt || null };
}

const server = new McpServer({ name: "orbit", version: "1.0.0" });

server.tool("list_boards", "Listet alle Boards (id + Titel).", {}, async () => {
  try {
    const { data, error } = await sb.from("boards").select("id,title,updated_at").order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ok(data);
  } catch (e) { return fail(e.message); }
});

server.tool("list_statuses", "Gibt die Spalten/Status des Boards in Reihenfolge zurück.",
  { board_id: z.string().optional() },
  async ({ board_id }) => {
    try { const b = await loadBoard(board_id); return ok(statusesOf(b)); }
    catch (e) { return fail(e.message); }
  });

server.tool("list_tickets",
  "Listet Tickets des Boards. Optional nach Status filtern und im Titel/Beschreibung suchen.",
  { board_id: z.string().optional(), status: z.string().optional(), query: z.string().optional(),
    include_done: z.boolean().optional() },
  async ({ board_id, status, query, include_done }) => {
    try {
      const b = await loadBoard(board_id);
      const done = b.data?.settings?.doneStatuses || [statusesOf(b).slice(-1)[0]];
      let t = b.data.tickets.slice();
      if (status) t = t.filter(x => x.status === status);
      if (!include_done && !status) t = t.filter(x => !done.includes(x.status));
      if (query) {
        const q = query.toLowerCase();
        t = t.filter(x => (x.title || "").toLowerCase().includes(q) || (x.desc || "").toLowerCase().includes(q));
      }
      return ok({ board: b.title, count: t.length, tickets: t.map(publicTicket) });
    } catch (e) { return fail(e.message); }
  });

server.tool("get_ticket", "Liefert ein einzelnes Ticket per id.",
  { id: z.string(), board_id: z.string().optional() },
  async ({ id, board_id }) => {
    try {
      const b = await loadBoard(board_id);
      const t = b.data.tickets.find(x => x.id === id);
      return t ? ok(publicTicket(t)) : fail("Ticket nicht gefunden: " + id);
    } catch (e) { return fail(e.message); }
  });

server.tool("create_ticket",
  "Legt ein neues Ticket an. status muss eine Spalte des Boards sein (siehe list_statuses).",
  { title: z.string().min(1),
    status: z.string().optional(),
    prio: z.enum(["Hoch", "Mittel", "Niedrig"]).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    desc: z.string().optional(),
    cats: z.array(z.string()).optional(),
    board_id: z.string().optional() },
  async ({ title, status, prio, deadline, desc, cats, board_id }) => {
    try {
      const b = await loadBoard(board_id);
      const st = statusesOf(b);
      const useStatus = status && st.includes(status) ? status : st[0];
      const ticket = { id: uid(), title, status: useStatus, prio: prio || "Mittel",
        deadline: deadline || today(), desc: desc || "", note: "",
        cats: cats || [], imgs: [], tasks: [], createdAt: today() };
      b.data.tickets = [...b.data.tickets, ticket];
      await saveData(b.id, b.data);
      return ok({ created: ticket.id, status: useStatus, board: b.title });
    } catch (e) { return fail(e.message); }
  });

server.tool("update_ticket",
  "Aktualisiert Felder eines Tickets (nur die gesetzten werden geändert).",
  { id: z.string(),
    title: z.string().optional(),
    status: z.string().optional(),
    prio: z.enum(["Hoch", "Mittel", "Niedrig"]).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    desc: z.string().optional(),
    cats: z.array(z.string()).optional(),
    board_id: z.string().optional() },
  async ({ id, board_id, ...patch }) => {
    try {
      const b = await loadBoard(board_id);
      const t = b.data.tickets.find(x => x.id === id);
      if (!t) return fail("Ticket nicht gefunden: " + id);
      if (patch.status && !statusesOf(b).includes(patch.status)) return fail("Unbekannter Status: " + patch.status);
      for (const k of ["title", "status", "prio", "deadline", "desc", "cats"]) if (patch[k] !== undefined) t[k] = patch[k];
      const done = b.data?.settings?.doneStatuses || [statusesOf(b).slice(-1)[0]];
      if (done.includes(t.status) && !t.completedAt) t.completedAt = today();
      if (!done.includes(t.status)) delete t.completedAt;
      await saveData(b.id, b.data);
      return ok(publicTicket(t));
    } catch (e) { return fail(e.message); }
  });

server.tool("move_ticket", "Verschiebt ein Ticket in eine andere Spalte (Status).",
  { id: z.string(), status: z.string(), board_id: z.string().optional() },
  async ({ id, status, board_id }) => {
    try {
      const b = await loadBoard(board_id);
      if (!statusesOf(b).includes(status)) return fail("Unbekannter Status: " + status);
      const t = b.data.tickets.find(x => x.id === id);
      if (!t) return fail("Ticket nicht gefunden: " + id);
      t.status = status;
      const done = b.data?.settings?.doneStatuses || [statusesOf(b).slice(-1)[0]];
      if (done.includes(status)) { if (!t.completedAt) t.completedAt = today(); } else { delete t.completedAt; }
      await saveData(b.id, b.data);
      return ok({ moved: id, status });
    } catch (e) { return fail(e.message); }
  });

server.tool("delete_ticket", "Löscht ein Ticket per id.",
  { id: z.string(), board_id: z.string().optional() },
  async ({ id, board_id }) => {
    try {
      const b = await loadBoard(board_id);
      const before = b.data.tickets.length;
      b.data.tickets = b.data.tickets.filter(x => x.id !== id);
      if (b.data.tickets.length === before) return fail("Ticket nicht gefunden: " + id);
      await saveData(b.id, b.data);
      return ok({ deleted: id });
    } catch (e) { return fail(e.message); }
  });

await server.connect(new StdioServerTransport());
console.error("[orbit-mcp] bereit." + (DEFAULT_BOARD ? " Standard-Board: " + DEFAULT_BOARD : " (kein Standard-Board gesetzt)"));
