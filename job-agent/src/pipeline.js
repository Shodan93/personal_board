// Orchestrierung: Quellen abrufen -> Dedup -> Matching -> Report.
// Wird von der CLI (scan.js) UND vom Cloudflare Worker (worker.js) genutzt —
// EIN Codepfad, egal ob per Button oder per Terminal ausgelöst.
import { SOURCES, DEMO_SOURCES, KEYLESS_SOURCES } from './sources/index.js';
import { matchJob } from './match.js';
import { splitNew } from './dedup.js';
import { buildReport } from './report.js';

export async function runScan({ profile, demo = false, sources, env = {}, seen = {}, today }) {
  const active = sources || (demo ? DEMO_SOURCES : KEYLESS_SOURCES);
  const errors = [];
  let all = [];

  for (const name of active) {
    const src = SOURCES[name];
    if (!src) { errors.push(`Unbekannte Quelle: ${name}`); continue; }
    try {
      const jobs = await src.fetchJobs({ profile, demo, env });
      all = all.concat(jobs);
    } catch (e) {
      errors.push(`${src.label}: ${e.message}`);
    }
  }

  const fetched = all.length;
  const { fresh, known } = splitNew(all, seen);

  const scored = fresh
    .map((job) => ({ job, match: matchJob(job, profile) }))
    .filter((s) => s.match.passed)
    .sort((a, b) => b.match.score - a.match.score);

  const rejected = fresh.length - scored.length;
  const stats = { fetched, known: known.length, rejected, errors };
  const markdown = buildReport({ scored, today, profile, stats });

  return { scored, stats, markdown, errors };
}
