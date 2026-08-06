// Gemeinsames, quellen-unabhängiges Job-Format + stabiler Hash für Dedup.

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Bringt eine Rohstelle in das einheitliche Format. Der Hash identifiziert eine
 * Stelle stabil über Läufe hinweg (für Dedup): bevorzugt quelle+externe-ID,
 * ersatzweise ein Hash aus Titel/Firma/Ort.
 */
export function normalizeJob(src) {
  const id = src.id != null && String(src.id).length > 0
    ? String(src.id)
    : djb2([src.title, src.company, src.location].join('|').toLowerCase());
  return {
    hash: `${src.source}:${id}`,
    source: src.source,
    id,
    title: (src.title || '').trim(),
    company: (src.company || '').trim(),
    location: (src.location || '').trim(),
    remote: Boolean(src.remote),
    url: src.url || '',
    salaryMin: src.salaryMin ?? null,
    salaryMax: src.salaryMax ?? null,
    description: (src.description || '').trim(),
    postedAt: src.postedAt || null,
  };
}
