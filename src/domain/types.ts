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
  /** Raum (optional, leer = ''). Wird wie das Kürzel auf Kollision geprüft. */
  room: string;
  /** Dauer in Stunden am Stück (1–9). */
  duration: number;
  /** Hex-Farbe der Karte. */
  color: string;
  /** Labor-/Gruppenkarte: darf ohne Rückfrage gestapelt werden. */
  isLabor: boolean;
  /** Findet im 1. Halbjahr statt. Beide Flags false = ganzes Jahr. */
  firstHalf: boolean;
  /** Findet im 2. Halbjahr statt. Beide Flags false = ganzes Jahr. */
  secondHalf: boolean;
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

/** Beschriftung einer Spalte an einem Wochentag. */
export interface DayLabel {
  /** Zeile 1: gemeinsamer Name für u- und g-Woche. */
  combined: string;
  /** Zeile 2: nur ungerade Woche. */
  u: string;
  /** Zeile 2: nur gerade Woche. */
  g: string;
}

/** Eine Spalte (Klasse): je Wochentag eine Beschriftung (genau DAYS.length). */
export type ClassColumn = DayLabel[];

/** Serialisierte Karte (Persistenzformat, kompatibel zum Alt-Format). */
export interface PersistedCard extends CardProps {
  id: string;
}

/** Serialisierte Platzierung (Persistenzformat). */
export interface PersistedPlacement extends PersistedCard, PlacementPosition {
  /** Gegen versehentliches Verschieben/Entfernen fixiert (fehlt = false). */
  locked?: boolean;
}

/** Gesamtzustand im Persistenzformat. */
export interface PersistedState {
  /** Neu: Spalten mit Tagesbeschriftungen. Alt: string[] (wird migriert). */
  classes: (string | ClassColumn)[];
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
