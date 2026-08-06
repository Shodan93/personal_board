# Optionales Browser-Modul (StepStone / Indeed / LinkedIn) — „dem Bot zuschauen"

Du wolltest StepStone, Indeed und LinkedIn mit dabei haben und dem Bot beim
Durchklicken zuschauen können. Hier die ehrliche Einordnung und der einzig
vertretbare Weg.

## Warum das NICHT der Standardweg ist

Diese drei Börsen haben **keine offene Such-API** und untersagen automatisiertes
Auslesen. Sie haben starke Bot-Abwehr (Cloudflare-Challenges, Captchas). Ein
Automat, der sich einloggt und scrollt,

- verstößt gegen die AGB und kann dein **persönliches Konto sperren**,
- wird regelmäßig blockiert und **bricht bei jeder Layout-Änderung**,
- ist der mit Abstand wartungsintensivste Teil.

Deshalb ist der Kern des Agenten **API-first** (Bundesagentur, Adzuna, Jooble,
Arbeitnow). Adzuna und Jooble bündeln u. a. **Indeed- und StepStone-Inhalte
legal** — damit ist ein großer Teil dieser Börsen bereits abgedeckt, ohne
Scraping.

## Der einzig vertretbare Browser-Weg: „Manueller Login, sichtbarer Lauf"

Falls du eine bestimmte Börse trotzdem direkt willst, dann so — und **nur
lokal auf deinem eigenen Rechner**, nicht auf einem Server:

1. **Headed** (sichtbares Fenster) mit Playwright starten — du siehst alles.
2. **Du loggst dich selbst von Hand ein** (der Bot bekommt dein Passwort NIE;
   es wird nirgends gespeichert). Der Bot wartet, bis du fertig bist.
3. Erst **danach** übernimmt der Bot: gibt die Suchbegriffe des Tages ein,
   scrollt die Ergebnisliste, sammelt Titel/Firma/Ort/Link ein.
4. Die eingesammelten Stellen laufen durch **dieselbe** Matching-/Report-Logik
   wie die API-Quellen.

So bleibt es dein manueller Login (kein Auto-Login), du schaust live zu, und es
werden keine Zugangsdaten gespeichert.

### Skizze (wird auf Wunsch als `browser/scrape.mjs` gebaut)

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, slowMo: 250 }); // sichtbar + langsam
const page = await browser.newPage();
await page.goto('https://de.indeed.com/');
console.log('>> Bitte im Fenster einloggen, dann hier Enter drücken …');
await waitForEnter();                 // Mensch loggt sich ein
await page.fill('#text-input-what', suchbegriffeDesTages);
await page.keyboard.press('Enter');
// … scrollen & Karten einsammeln → normalizeJob() → matchJob() …
```

**Voraussetzung:** Node auf deinem Rechner + `npm i playwright` + `npx playwright
install chromium`. Ein Editor wie **VS Code** ist bequem, aber nicht zwingend —
ein Terminal reicht. Auf einem Cloudflare Worker läuft dieses Modul **nicht**
(dort gibt es keinen Browser); es ist bewusst ein lokaler, von dir gestarteter
Schritt.

> Empfehlung: erst mit den API-Quellen live gehen. Das Browser-Modul nur
> ergänzen, wenn dir nach ein paar Tagen konkret Stellen auf genau einer Börse
> fehlen, die die Aggregatoren nicht liefern.
