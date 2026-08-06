// Quellen-Register. Neue Börse anbinden = eine Datei nach dem gleichen Muster
// hinzufügen und hier importieren.
import * as arbeitsagentur from './arbeitsagentur.js';
import * as adzuna from './adzuna.js';
import * as arbeitnow from './arbeitnow.js';
import * as jooble from './jooble.js';

export const SOURCES = { arbeitsagentur, adzuna, arbeitnow, jooble };

// Welche Quellen im Demo-Modus ohne Keys laufen (alle, da Fixtures gebündelt).
export const DEMO_SOURCES = ['arbeitsagentur', 'adzuna', 'arbeitnow', 'jooble'];

// Welche Quellen live ohne zusätzliche Keys laufen.
export const KEYLESS_SOURCES = ['arbeitsagentur', 'arbeitnow'];
