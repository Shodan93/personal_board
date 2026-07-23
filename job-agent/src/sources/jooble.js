// Quelle: Jooble — Aggregator (bündelt u. a. Indeed/StepStone-Inhalte) LEGAL.
// Kostenloser Key: https://jooble.org/api/about  ·  POST mit JSON-Body.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeJob } from '../normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const id = 'jooble';
export const label = 'Jooble (Aggregator)';

export function rawToJobs(raw) {
  const list = raw?.jobs || [];
  return list.map((j) => normalizeJob({
    source: id,
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    remote: /remote|home\s*office|hybrid/i.test(`${j.title} ${j.snippet}`),
    url: j.link,
    description: j.snippet || '',
    postedAt: j.updated || null,
  }));
}

async function fetchRaw({ profile, demo, env = {} }) {
  if (demo) {
    return JSON.parse(await readFile(join(__dirname, '../../fixtures/jooble.json'), 'utf8'));
  }
  const key = env.JOOBLE_KEY;
  if (!key) throw new Error(`${label}: JOOBLE_KEY fehlt`);
  const res = await fetch(`https://jooble.org/api/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      keywords: (profile.rollen || []).join(', '),
      location: profile.orte?.[0] || '',
    }),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchJobs(ctx) {
  return rawToJobs(await fetchRaw(ctx));
}
