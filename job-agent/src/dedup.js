// Dedup über eine JSON-Datei im Repo (kein Supabase nötig): merkt sich gesehene
// Stellen-Hashes, damit der Bericht nur NEU erschienene Treffer zeigt.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEN_PATH = join(__dirname, '../data/seen.json');

export async function loadSeen() {
  try { return JSON.parse(await readFile(SEEN_PATH, 'utf8')); }
  catch { return {}; }
}

export async function saveSeen(seen) {
  await mkdir(dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify(seen, null, 2) + '\n');
}

/** Teilt Jobs in neu / bereits gesehen anhand des Hashes. */
export function splitNew(jobs, seen) {
  const fresh = [];
  const known = [];
  for (const j of jobs) (seen[j.hash] ? known : fresh).push(j);
  return { fresh, known };
}

/** Ergänzt neue Hashes im Seen-Store (mit Datum + Score). */
export function remember(seen, scored, today) {
  for (const s of scored) {
    if (!seen[s.job.hash]) seen[s.job.hash] = { firstSeen: today, score: s.match.score };
  }
  return seen;
}
