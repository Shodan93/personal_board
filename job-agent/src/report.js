// Erzeugt den Morgen-Bericht als Markdown.

const stars = (score) => '★'.repeat(Math.round(score / 20)).padEnd(5, '☆');

export function buildReport({ scored, today, profile, stats }) {
  const top = scored.slice(0, profile.report?.max_treffer_pro_tag ?? 10);
  const L = [];
  L.push(`# Job-Bericht — ${today}`);
  L.push('');
  L.push(`Profil: ${(profile.rollen || []).join(', ')} · Orte: ${(profile.orte || []).join('/') || 'egal'}` +
         `${profile.remote_ok ? ' · Remote ok' : ''}`);
  L.push('');
  L.push(`**${scored.length} passende neue Stelle(n)** von ${stats.fetched} geladenen ` +
         `(${stats.known} bereits bekannt, ${stats.rejected} ausgefiltert).`);
  L.push('');
  if (!top.length) {
    L.push('_Heute keine neuen Treffer, die zum Profil passen._');
    return L.join('\n') + '\n';
  }
  L.push('| # | Score | Stelle | Firma | Ort | Quelle |');
  L.push('|--:|:--|:--|:--|:--|:--|');
  top.forEach((s, i) => {
    L.push(`| ${i + 1} | ${s.match.score} ${stars(s.match.score)} | [${s.job.title}](${s.job.url}) | ` +
           `${s.job.company || '—'} | ${s.job.location || (s.job.remote ? 'Remote' : '—')} | ${s.job.source} |`);
  });
  L.push('');
  L.push('---');
  L.push('');
  top.forEach((s, i) => {
    L.push(`### ${i + 1}. ${s.job.title} — ${s.job.company || '—'}  ·  Score ${s.match.score}/100`);
    L.push(`Ort: ${s.job.location || (s.job.remote ? 'Remote' : '—')} · Quelle: ${s.job.source}` +
           `${s.job.salaryMin ? ` · Gehalt ab ${s.job.salaryMin} €` : ''}`);
    if (s.match.reasons.length) L.push(`- ✅ ${s.match.reasons.join(' · ')}`);
    if (s.match.redFlags.length) L.push(`- ⚠️ ${s.match.redFlags.join(' · ')}`);
    L.push(`- 🔗 ${s.job.url}`);
    L.push('');
  });
  return L.join('\n') + '\n';
}
