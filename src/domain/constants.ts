/** Unterrichtstage (Index 0–4 = Montag–Freitag). */
export const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'] as const;

/** Anzahl der Unterrichtsstunden pro Tag. */
export const PERIODS = 9;

/** Wochentypen: u = ungerade, g = gerade Kalenderwoche. */
export const WEEKS = ['u', 'g'] as const;

/** Farbpalette für Karten. */
export const PALETTE = [
  '#e53935', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
  '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
  '#8bc34a', '#ff9800', '#ff5722', '#795548', '#607d8b',
] as const;
