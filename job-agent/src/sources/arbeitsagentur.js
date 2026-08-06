// Quelle: Bundesagentur für Arbeit — offizielle Jobsuche-API (kostenlos, DE-Anker).
// Doku: https://jobsuche.api.bund.dev  ·  statischer Key im Header.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeJob } from '../normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs';

export const id = 'arbeitsagentur';
export const label = 'Bundesagentur für Arbeit';

// Rohes API-JSON -> einheitliches Format. Wird auch vom Demo-Modus genutzt,
// damit der Demo-Lauf denselben Parser testet wie der Live-Lauf.
export function rawToJobs(raw) {
  const list = raw?.stellenangebote || [];
  return list.map((s) => normalizeJob({
    source: id,
    id: s.refnr,
    title: s.titel || s.beruf,
    company: s.arbeitgeber,
    location: [s.arbeitsort?.ort, s.arbeitsort?.plz].filter(Boolean).join(' '),
    remote: false,
    url: s.externeUrl || `https://www.arbeitsagentur.de/jobsuche/jobdetail/${s.refnr}`,
    description: s.beruf || '',
    postedAt: s.aktuelleVeroeffentlichungsdatum || s.eintrittsdatum || null,
  }));
}

async function fetchRaw({ profile, demo, page = 1 }) {
  if (demo) {
    return JSON.parse(await readFile(join(__dirname, '../../fixtures/arbeitsagentur.json'), 'utf8'));
  }
  const params = new URLSearchParams({
    was: (profile.rollen || []).join(' '),
    size: '30',
    page: String(page),
  });
  if (profile.orte?.[0]) params.set('wo', profile.orte[0]);
  if (profile.umkreis_km) params.set('umkreis', String(profile.umkreis_km));
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { 'X-API-Key': 'jobboerse-jobsuche', accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchJobs(ctx) {
  return rawToJobs(await fetchRaw(ctx));
}
