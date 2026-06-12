/** Wochentyp: ungerade ('u') oder gerade ('g') Kalenderwoche. */
export type Week = 'u' | 'g';

/** Fachliche Eigenschaften einer Karte (Lehrer/Fach-Einheit). */
export interface CardProps {
  /** Lehrerkürzel, max. 5 Zeichen, immer Großbuchstaben. */
  abbr: string;
  /** Fachbezeichnung (optional, leer = ''). */
  fach: string;
  /** Lehrername (optional, leer = ''). */
  name: string;
  /** Dauer in Stunden am Stück (1–9). */
  duration: number;
  /** Hex-Farbe der Karte. */
  color: string;
  /** Labor-/Gruppenkarte: darf ohne Rückfrage gestapelt werden. */
  isLabor: boolean;
  /** Freitext-Kommentar (leer = ''), per Doppelklick auf die Karte gepflegt. */
  comment: string;
}

/** Position einer Platzierung im Stundenplan. */
export interface PlacementPosition {
  /** Tag-Index (0 = Montag … 4 = Freitag). */
  day: number;
  /** Erste belegte Stunde (1-basiert). */
  startPeriod: number;
  /** Index der Klasse in der Klassenliste. */
  classIdx: number;
  /** Wochentyp der Spalte. */
  week: Week;
}

/** Serialisierte Karte (Persistenzformat, kompatibel zum Alt-Format). */
export interface PersistedCard extends CardProps {
  id: string;
}

/** Serialisierte Platzierung (Persistenzformat). */
export interface PersistedPlacement extends PersistedCard, PlacementPosition {}

/** Gesamtzustand im Persistenzformat (kompatibel zur Vorgänger-App). */
export interface PersistedState {
  classes: string[];
  cards: PersistedCard[];
  placed: PersistedPlacement[];
  nid: number;
}

/** Zeile der Stunden-Übersicht. */
export interface StatRow {
  abbr: string;
  fach: string;
  name: string;
  color: string;
  hours: number;
}
