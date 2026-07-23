// Matching = harte Filter (Ausschluss) + transparentes Scoring (Ranking).
//
// Bewusst regelbasiert und nachvollziehbar. Das "schlaue" semantische Ranking
// per Claude ist ein optionaler Zusatz (siehe README §MCP/Worker) — dieselbe
// Job-Liste kann vor dem Report durch ein LLM neu bewertet werden.

const lc = (s) => (s || '').toLowerCase();

function hits(text, terms) {
  return (terms || []).filter((t) => t && text.includes(lc(t)));
}

/**
 * @returns {{passed:boolean, score:number, reasons:string[], redFlags:string[], rejectedBy?:string}}
 */
export function matchJob(job, profile) {
  const title = lc(job.title);
  const haystack = lc(`${job.title} ${job.company} ${job.location} ${job.description}`);
  const reasons = [];
  const redFlags = [];

  // --- Harte Filter -------------------------------------------------------
  const noGoHit = hits(haystack, profile.no_go)[0];
  if (noGoHit) return { passed: false, score: 0, reasons, redFlags, rejectedBy: `No-Go: „${noGoHit}"` };

  const orte = profile.orte || [];
  if (orte.length && !job.remote && !(profile.remote_ok && job.remote)) {
    const ortOk = orte.some((o) => lc(job.location).includes(lc(o)));
    if (!ortOk && job.location) {
      return { passed: false, score: 0, reasons, redFlags, rejectedBy: `Ort „${job.location}" außerhalb ${orte.join('/')}` };
    }
  }

  if (profile.gehalt_min_eur > 0 && job.salaryMax != null && job.salaryMax < profile.gehalt_min_eur) {
    return { passed: false, score: 0, reasons, redFlags, rejectedBy: `Gehalt < ${profile.gehalt_min_eur} €` };
  }

  // Relevanz-Voraussetzung: ohne Bezug zu einer Wunschrolle gehört die Stelle
  // nicht in den Bericht (Remote/Boost/Präferenz allein qualifizieren nicht).
  const rolleImTitel = hits(title, profile.rollen);
  const rolleImText = hits(haystack, profile.rollen);
  if (!rolleImTitel.length && !rolleImText.length) {
    return { passed: false, score: 0, reasons, redFlags, rejectedBy: 'keine Wunschrolle erkennbar' };
  }

  // --- Scoring ------------------------------------------------------------
  let score = 0;
  if (rolleImTitel.length) {
    score += 45;
    reasons.push(`Rolle im Titel: ${rolleImTitel.join(', ')}`);
  } else {
    score += 22;
    reasons.push(`Rolle im Text: ${rolleImText.join(', ')}`);
  }

  const boost = hits(haystack, profile.keywords_boost);
  if (boost.length) {
    score += Math.min(24, boost.length * 8);
    reasons.push(`Boost-Begriffe: ${boost.join(', ')}`);
  }

  const prefs = hits(haystack, profile.praeferenzen);
  if (prefs.length) {
    score += Math.min(15, prefs.length * 5);
    reasons.push(`Präferenzen erfüllt: ${prefs.join(', ')}`);
  }

  if (profile.remote_ok && job.remote) {
    score += 10;
    reasons.push('Remote möglich');
  }

  if (profile.gehalt_min_eur > 0 && job.salaryMin != null && job.salaryMin >= profile.gehalt_min_eur) {
    score += 6;
    reasons.push(`Gehalt ab ${job.salaryMin} € ≥ Wunsch`);
  }

  score = Math.max(0, Math.min(100, score));
  return { passed: score > 0, score, reasons, redFlags };
}
