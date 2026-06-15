/** Wochentyp: ungerade ('u') oder gerade ('g') Kalenderwoche. */
export type Week = 'u' | 'g';

/** Fachliche Eigenschaften einer Karte (Lehrer/Fach-Einheit). */
export interface CardProps {
  /** Klassenbindung (optional, leer = ''): Karte darf nur in eine Spalte mit
   *  identischem Klassennamen (am jeweiligen Tag/Woche) gelegt werden. */
  klasse: string;
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
  /** Labor-Gruppe ('a' | 'b' | ''): a wird beim Planen auf b gelegt. */
  labGroup: string;
  /** Werkstatt-Karte: darf – wie Labor – ohne Rückfrage gestapelt werden. */
  isWerkstatt: boolean;
  /** 4-wöchiger Turnus: zählt bei der Stundenberechnung mit halbem Gewicht. */
  isVierwoechig: boolean;
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

/** Beschriftbares Feld eines Tages-Labels. */
export type LabelField = 'combined' | 'u' | 'g';

/** Beschriftung einer Spalte an einem Wochentag (Texte + optionale Farben). */
export interface DayLabel {
  /** Zeile 1: gemeinsamer Name für u- und g-Woche. */
  combined: string;
  /** Zeile 2: nur ungerade Woche. */
  u: string;
  /** Zeile 2: nur gerade Woche. */
  g: string;
  /** Hintergrundfarbe der Felder (leer = keine), zur visuellen Gruppierung. */
  combinedColor: string;
  uColor: string;
  gColor: string;
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

/** Ergebnis des automatischen Verplanens. */
export interface AutoPlanResult {
  placed: number;
  /** Nicht platzierbare Karten mit Grund. */
  skipped: { card: string; reason: string }[];
  /** Anzahl offener Pflichtstunden (1–6) nach dem Verplanen. */
  openMandatory: number;
  /** Lehrkräfte mit u/g-Differenz > 2 Stunden (u-/g-Stunden zur Meldung). */
  weekImbalance: { abbr: string; u: number; g: number }[];
}

/** Fortschritt während des (langen) Planungslaufs. */
export interface PlanProgress {
  elapsedMs: number;
  attempts: number;
  /** Beste Lösung bisher: platzierte Karten. */
  placed: number;
  /** Karten gesamt, die verplant werden sollen. */
  total: number;
  /** Beste Lösung bisher: noch nicht platzierbare Karten. */
  skipped: number;
  /** Summe der u/g-Überschreitungen (über alle Lehrkräfte). */
  imbalance: number;
}

/** Ergebnis eines kompletten Planungslaufs (mit Mehrfach-Zyklen). */
export interface PlanRunResult extends AutoPlanResult {
  /** Alle Karten verplant UND u/g-Differenz überall ≤ 2. */
  solved: boolean;
  /** Vom Anwender abgebrochen – es wurde nichts angewendet. */
  cancelled: boolean;
  attempts: number;
  elapsedMs: number;
}

/** Zeile der Stunden-Übersicht. */
export interface StatRow {
  abbr: string;
  fach: string;
  name: string;
  color: string;
  /** Stunden in der u-Woche. */
  hoursU: number;
  /** Stunden in der g-Woche. */
  hoursG: number;
}
