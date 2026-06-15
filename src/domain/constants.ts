/** Unterrichtstage (Index 0–4 = Montag–Freitag). */
export const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'] as const;

/** Anzahl der Unterrichtsstunden pro Tag. */
export const PERIODS = 9;

/** Wochentypen: u = ungerade, g = gerade Kalenderwoche. */
export const WEEKS = ['u', 'g'] as const;

/** Farbpalette für Karten und Klassen-Felder (24 gut unterscheidbare Farben). */
export const PALETTE = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5',
  '#039be5', '#00acc1', '#00897b', '#43a047', '#7cb342', '#c0ca33',
  '#fdd835', '#ffb300', '#fb8c00', '#f4511e', '#6d4c41', '#757575',
  '#546e7a', '#ad1457', '#4527a0', '#283593', '#00695c', '#9e9d24',
] as const;
