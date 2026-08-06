#!/usr/bin/env node
// CLI-Einstieg. Beispiele:
//   node scan.js --demo                 # Offline-Demo (gebündelte Fixtures, kein Netz/Keys)
//   node scan.js                        # Live (nutzt profile.json + ENV-Keys)
//   node scan.js --source arbeitsagentur,arbeitnow
//   node scan.js --demo --profile profile.demo.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runScan } from './src/pipeline.js';
import { loadSeen, saveSeen, remember } from './src/dedup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const demo = Boolean(arg('demo', false));
const profilePath = arg('profile', demo ? 'profile.demo.json' : 'profile.json');
const sources = typeof arg('source') === 'string' ? arg('source').split(',') : undefined;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  let profile;
  try {
    profile = JSON.parse(await readFile(join(__dirname, profilePath), 'utf8'));
  } catch {
    console.error(`✖ Profil ${profilePath} nicht gefunden. Für den echten Lauf ` +
      `profile.example.json nach profile.json kopieren und ausfüllen.`);
    process.exit(1);
  }

  // Demo: nicht persistieren -> wiederholbar (immer alle als "neu").
  const seen = demo ? {} : await loadSeen();

  const { scored, stats, markdown, errors } = await runScan({
    profile, demo, sources, env: process.env, seen, today,
  });

  const outDir = join(__dirname, 'reports');
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `${today}${demo ? '-demo' : ''}.md`);
  await writeFile(outFile, markdown);

  if (!demo) await saveSeen(remember(seen, scored, today));

  console.log(markdown);
  if (errors.length) console.error('\nHinweise/Fehler:\n- ' + errors.join('\n- '));
  console.log(`\n→ Bericht gespeichert: ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
