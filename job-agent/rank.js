#!/usr/bin/env node
// Bewertet manuell eingesammelte Stellen (z. B. aus dem Browser-Konsolen-Snippet,
// siehe docs/indeed-schnelltest.md) gegen dein Profil — ohne Netz, ohne Login.
//
//   node rank.js pasted.json                  # nutzt profile.demo.json
//   node rank.js pasted.json --profile profile.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeJob } from './src/normalize.js';
import { matchJob } from './src/match.js';
import { buildReport } from './src/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Nutzung: node rank.js <pasted.json> [--profile profile.json]'); process.exit(1); }
  const profilePath = arg('profile', 'profile.demo.json');
  const profile = JSON.parse(await readFile(join(__dirname, profilePath), 'utf8'));
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.jobs || []);
  const today = new Date().toISOString().slice(0, 10);

  const jobs = list.map((j, i) => normalizeJob({
    source: j.source || 'indeed',
    id: j.url || j.id || String(i),
    title: j.title,
    company: j.company,
    location: j.location,
    remote: /remote|home\s*office|hybrid/i.test(`${j.title} ${j.location}`),
    url: j.url || '',
    description: [j.title, j.snippet, j.description].filter(Boolean).join(' '),
  }));

  const scored = jobs
    .map((job) => ({ job, match: matchJob(job, profile) }))
    .filter((s) => s.match.passed)
    .sort((a, b) => b.match.score - a.match.score);

  const markdown = buildReport({
    scored, today, profile,
    stats: { fetched: jobs.length, known: 0, rejected: jobs.length - scored.length, errors: [] },
  });
  await mkdir(join(__dirname, 'reports'), { recursive: true });
  const out = join(__dirname, 'reports', `${today}-manuell.md`);
  await writeFile(out, markdown);
  console.log(markdown);
  console.log(`\n→ Bericht gespeichert: ${out}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
