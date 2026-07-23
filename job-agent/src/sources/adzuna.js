// Quelle: Adzuna — Aggregator (bündelt viele Börsen inkl. Indeed-Inhalte) LEGAL.
// Kostenloser App-Zugang: https://developer.adzuna.com  -> app_id + app_key.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeJob } from '../normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const id = 'adzuna';
export const label = 'Adzuna (Aggregator)';

export function rawToJobs(raw) {
  const list = raw?.results || [];
  return list.map((j) => normalizeJob({
    source: id,
    id: j.id,
    title: j.title,
    company: j.company?.display_name,
    location: j.location?.display_name,
    remote: /remote|home\s*office|hybrid/i.test(`${j.title} ${j.description}`),
    url: j.redirect_url,
    salaryMin: j.salary_min ?? null,
    salaryMax: j.salary_max ?? null,
    description: j.description || '',
    postedAt: j.created || null,
  }));
}

async function fetchRaw({ profile, demo, env = {}, page = 1 }) {
  if (demo) {
    return JSON.parse(await readFile(join(__dirname, '../../fixtures/adzuna.json'), 'utf8'));
  }
  const appId = env.ADZUNA_APP_ID;
  const appKey = env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error(`${label}: ADZUNA_APP_ID / ADZUNA_APP_KEY fehlen`);
  const country = (profile.land || 'de').toLowerCase();
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: (profile.rollen || []).join(' '),
    results_per_page: '30',
    'content-type': 'application/json',
  });
  if (profile.orte?.[0]) params.set('where', profile.orte[0]);
  if (profile.umkreis_km) params.set('distance', String(profile.umkreis_km));
  if (profile.gehalt_min_eur) params.set('salary_min', String(profile.gehalt_min_eur));
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchJobs(ctx) {
  return rawToJobs(await fetchRaw(ctx));
}
