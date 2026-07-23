# Indeed-Schnelltest — ohne Installation, in deinem eigenen Chrome

Für den Fall: Chrome ist offen, du bist bei Indeed eingeloggt und willst **jetzt
sofort** testen, ohne irgendetwas zu installieren. Wir sammeln die aktuell
sichtbaren Stellen direkt in deinem Browser ein und lassen sie hier bewerten.

## Schritt für Schritt

1. Gehe in deinem eingeloggten Chrome auf die **Indeed-Ergebnisseite** deiner
   Suche, z. B. `E-Commerce Manager` (am besten Filter „Letzte 24 Stunden").
2. Drücke **F12** (oder Strg+Umschalt+J) → oben den Reiter **„Console"** wählen.
3. Kopiere das Snippet unten **komplett**, füge es in die Konsole ein, **Enter**.
   (Beim ersten Mal verlangt Chrome evtl. das Tippen von `allow pasting` — dann
   das erlauben und das Snippet erneut einfügen.)
4. Es erscheint eine Tabelle der Stellen, und der Text **„… Jobs kopiert"**.
   Die Liste liegt jetzt in deiner Zwischenablage.
5. **Füge sie hier in den Chat ein.** Ich bewerte sie gegen dein Profil und
   schicke dir den Bericht zurück.
6. Für mehr Treffer: auf Indeed eine Seite weiterblättern bzw. anderen Suchbegriff
   wählen und Schritte 3–5 wiederholen.

## Das Snippet

```js
(() => {
  const base = 'https://de.indeed.com';
  const cards = document.querySelectorAll('div.job_seen_beacon, [data-testid="slider_item"], td.resultContent, .cardOutline');
  const jobs = [];
  cards.forEach((c) => {
    const tEl = c.querySelector('h2.jobTitle, [id^="jobTitle"], a.jcs-JobTitle');
    const title = tEl ? tEl.innerText.trim() : '';
    if (!title) return;
    const compEl = c.querySelector('[data-testid="company-name"], span.companyName');
    const locEl = c.querySelector('[data-testid="text-location"], div.companyLocation');
    const aEl = c.querySelector('a[href*="viewjob"], a[href*="/rc/clk"], a.jcs-JobTitle, h2.jobTitle a');
    let url = '';
    try { url = aEl ? new URL(aEl.getAttribute('href'), base).href : ''; } catch (e) {}
    jobs.push({
      title,
      company: compEl ? compEl.innerText.trim() : '',
      location: locEl ? locEl.innerText.trim() : '',
      url,
    });
  });
  console.table(jobs);
  try { copy(JSON.stringify(jobs, null, 2)); } catch (e) {}
  console.log(`✅ ${jobs.length} Jobs kopiert — jetzt in den Claude-Chat einfügen.`);
  return jobs.length;
})();
```

## Was danach passiert (technischer Teil, machen wir)

Die eingefügte Liste läuft durch `node rank.js`, das jede Stelle gegen dein
Profil bewertet (harte Filter + Score) und einen Markdown-Bericht erzeugt —
dieselbe Logik wie bei den API-Quellen.

> Rechtlich/fair: Das ist nur das Auslesen dessen, was **du** ohnehin sichtbar
> vor dir hast, für deine eigene Jobsuche. Kein Dauerbetrieb, keine Massenabfrage.
