// Quelle: Arbeitnow — DE/Tech/Remote, kostenlos, kein Key.
// https://www.arbeitnow.com/api/job-board-api
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeJob } from '../normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const id = 'arbeitnow';
export const label = 'Arbeitnow';

export function rawToJobs(raw) {
  const list = raw?.data || [];
  return list.map((j) => normalizeJob({
    source: id,
    id: j.slug,
    title: j.title,
    company: j.company_name,
    location: j.location,
    remote: Boolean(j.remote),
    url: j.url,
    description: `${(j.tags || []).join(', ')} ${j.description || ''}`,
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
  }));
}

async function fetchRaw({ demo }) {
  if (demo) {
    return JSON.parse(await readFile(join(__dirname, '../../fixtures/arbeitnow.json'), 'utf8'));
  }
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchJobs(ctx) {
  return rawToJobs(await fetchRaw(ctx));
}
