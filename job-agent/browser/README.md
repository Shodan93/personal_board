# Indeed-Modul — auf deinem Mac starten & dem Bot zuschauen

Dieses Modul ist der einzige vertretbare Weg, Indeed **direkt** einzubinden:
ein sichtbares Chrome-Fenster auf **deinem** Rechner, in dem **du dich selbst
einloggst**. Der Bot speichert kein Passwort und loggt sich nie selbst ein.

> Warum nicht „von Claude aus jetzt sofort"? Claude läuft in einem Cloud-
> Container ohne Verbindung zu deinem Chrome, und Indeed ist von dort ohnehin
> netzwerkseitig gesperrt. Direkter Indeed-Zugriff **muss** lokal bei dir laufen.

## Einmalige Einrichtung (ca. 5 Min.)

1. **Node installieren** (falls noch nicht): https://nodejs.org (LTS). Prüfen im
   Terminal: `node --version` (sollte ≥ 18 zeigen).
2. Repo/Ordner auf den Rechner holen und hineinwechseln:
   ```bash
   cd pfad/zu/personal_board/job-agent
   ```
3. Playwright + Browser installieren:
   ```bash
   npm install playwright
   npx playwright install chromium
   ```
4. Dein Profil anlegen (einmalig):
   ```bash
   cp profile.example.json profile.json     # dann Rollen/Orte/Gehalt eintragen
   ```
   Zum schnellen Testen kannst du auch das mitgelieferte `profile.demo.json`
   (E-Commerce) nehmen — dann diesen Schritt überspringen.

## Starten

```bash
node browser/scrape-indeed.mjs
```

Dann:

1. Es öffnet sich ein **Chrome-Fenster** mit Indeed.
2. **Logg dich ein** (und löse ggf. „Ich bin kein Roboter").
3. Wechsle zum Terminal und drücke **ENTER**.
4. Schau zu: Der Bot tippt nacheinander deine Suchbegriffe, scrollt die
   Ergebnisse und sammelt Titel/Firma/Ort/Link ein.
5. Am Ende steht der Bericht im Terminal und als Datei unter
   `reports/<Datum>-indeed.md` — bewertet mit derselben Logik wie die API-Quellen.

## Suchbegriffe & Ort steuern

- Standard: die ersten Einträge aus `rollen` in deinem Profil, Ort = `orte[0]`.
- Gezielter: im Profil `"browser_queries": ["E-Commerce Manager","Amazon PPC Manager", …]`
  setzen — dann sucht das Modul genau diese Begriffe.

## Wenn etwas hakt

- **Keine Treffer / leere Liste:** Indeed hat vermutlich das HTML geändert. Die
  Selektoren stehen oben in `scrape-indeed.mjs` (Abschnitt „cards"). Da das
  Fenster sichtbar ist, siehst du sofort, an welcher Stelle es klemmt.
- **Blockade/Captcha mitten im Lauf:** einfach im Fenster lösen; das Skript
  läuft mit Pausen und `slowMo`, damit es nicht wie ein aggressiver Bot wirkt.
- **Fair bleiben:** nur für deine eigene Jobsuche, mit Maß. Kein Dauerbetrieb,
  keine Massenabfragen — sonst riskierst du eine Sperre deines Kontos.

## StepStone

Gleiches Muster; StepStone hat aber eine noch striktere Bot-Abwehr. Empfehlung:
StepStone-Inhalte zuerst über die Aggregatoren (Adzuna/Jooble) mitnehmen — dort
kommen sie ohne Login rein. Ein eigenes `scrape-stepstone.mjs` bauen wir nur,
wenn dir konkret Stellen fehlen.
