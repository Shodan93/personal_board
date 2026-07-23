#!/usr/bin/env node
// LOKALES Indeed-Modul — läuft auf DEINEM Rechner, nicht auf einem Server.
// Sichtbares Chrome-Fenster, DU loggst dich selbst ein (kein gespeichertes
// Passwort, kein Auto-Login). Danach übernimmt der Bot Suche + Scrollen und
// schickt die Treffer durch dieselbe Matching-/Report-Logik wie die API-Quellen.
//
// Einrichtung & Start: siehe browser/README.md
//
// Hinweis: Indeed ändert sein HTML regelmäßig. Die Selektoren unten sind der
// Stand bei Bau; falls Indeed etwas umbaut, hier nachjustieren (das Fenster ist
// sichtbar, du erkennst sofort, wo es hakt).
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { normalizeJob } from '../src/normalize.js';
import { matchJob } from '../src/match.js';
import { buildReport } from '../src/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const waitForEnter = (msg) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(msg, () => { rl.close(); res(); });
});

async function loadProfile() {
  for (const p of ['profile.json', 'profile.demo.json']) {
    try { return JSON.parse(await readFile(join(ROOT, p), 'utf8')); } catch {}
  }
  throw new Error('Kein profile.json / profile.demo.json gefunden.');
}

async function main() {
  const profile = await loadProfile();
  const queries = profile.browser_queries?.length
    ? profile.browser_queries
    : (profile.rollen || []).slice(0, 6);
  const where = profile.orte?.[0] || '';
  const today = new Date().toISOString().slice(0, 10);

  const browser = await chromium.launch({ headless: false, slowMo: 200 }); // sichtbar + langsam
  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();

  await page.goto('https://de.indeed.com/', { waitUntil: 'domcontentloaded' });
  console.log('\n>> Bitte im Chrome-Fenster einloggen und ggf. das "Ich bin kein Roboter" lösen.');
  await waitForEnter('>> Wenn du eingeloggt bist und Indeed normal siehst: hier ENTER drücken … ');

  const seen = new Set();
  const jobs = [];

  for (const q of queries) {
    console.log(`\n… suche: "${q}"${where ? ` in ${where}` : ''}`);
    const url = `https://de.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(where)}&fromage=1`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // sanft scrollen, damit alle Karten laden (und du zuschauen kannst)
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(800); }

    const cards = await page.locator('div.job_seen_beacon, a.tapItem, [data-testid="slider_item"]').all();
    for (const card of cards) {
      try {
        const title = (await card.locator('h2.jobTitle, [id^="jobTitle"]').first().innerText().catch(() => '')).trim();
        if (!title) continue;
        const company = (await card.locator('[data-testid="company-name"], span.companyName').first().innerText().catch(() => '')).trim();
        const location = (await card.locator('[data-testid="text-location"], div.companyLocation').first().innerText().catch(() => '')).trim();
        const href = await card.locator('a').first().getAttribute('href').catch(() => '');
        const link = href ? new URL(href, 'https://de.indeed.com').toString() : '';
        const key = `${title}|${company}|${location}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(normalizeJob({
          source: 'indeed', id: link || key, title, company, location,
          remote: /remote|home\s*office|hybrid/i.test(`${title} ${location}`),
          url: link, description: `${title} ${q}`,
        }));
      } catch {}
    }
    console.log(`   → ${jobs.length} Stellen gesammelt (kumuliert)`);
    await page.waitForTimeout(1200 + Math.floor(1000 * (queries.indexOf(q) % 3) / 3)); // höflich pausieren
  }

  await browser.close();

  const scored = jobs
    .map((job) => ({ job, match: matchJob(job, profile) }))
    .filter((s) => s.match.passed)
    .sort((a, b) => b.match.score - a.match.score);

  const markdown = buildReport({
    scored, today, profile,
    stats: { fetched: jobs.length, known: 0, rejected: jobs.length - scored.length, errors: [] },
  });
  await mkdir(join(ROOT, 'reports'), { recursive: true });
  const out = join(ROOT, 'reports', `${today}-indeed.md`);
  await writeFile(out, markdown);
  console.log(markdown);
  console.log(`\n→ Bericht gespeichert: ${out}`);
}

main().catch((e) => { console.error('\n✖ Fehler:', e.message); process.exit(1); });
