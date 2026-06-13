import { DAYS } from './constants';
import type { ClassColumn, DayLabel, LabelField, Week } from './types';

/** Ordnet jedem Textfeld sein Farbfeld zu. */
const COLOR_KEY: Record<LabelField, 'combinedColor' | 'uColor' | 'gColor'> = {
  combined: 'combinedColor',
  u: 'uColor',
  g: 'gColor',
};

/** Spalte mit gegebenem gemeinsamen Namen an allen Wochentagen. */
function columnWith(combined: string): ClassColumn {
  return DAYS.map(() => ({ combined, u: '', g: '', combinedColor: '', uColor: '', gColor: '' }));
}

/** Stellt sicher, dass eine Spalte genau DAYS.length vollständige Einträge hat. */
function normalizeColumn(col: readonly Partial<DayLabel>[]): ClassColumn {
  return DAYS.map((_, d) => ({
    combined: col[d]?.combined ?? '',
    u: col[d]?.u ?? '',
    g: col[d]?.g ?? '',
    combinedColor: col[d]?.combinedColor ?? '',
    uColor: col[d]?.uColor ?? '',
    gColor: col[d]?.gColor ?? '',
  }));
}

/**
 * Verwaltet die Spalten des Rasters. Jede Spalte (über ihren Index
 * referenziert) trägt pro Wochentag eine Beschriftung: eine gemeinsame
 * Zeile (u+g) und getrennte Zeilen für u- bzw. g-Woche.
 */
export class ClassList {
  private columns: ClassColumn[];

  constructor(columns: ClassColumn[]) {
    this.columns = columns.map((c) => normalizeColumn(c));
  }

  static withDefaults(count = 10): ClassList {
    return new ClassList(Array.from({ length: count }, (_, i) => columnWith(`Klasse ${i + 1}`)));
  }

  /** Liest Alt-Format (string[]) und Neu-Format (ClassColumn[]). */
  static fromPersisted(raw: unknown): ClassList {
    if (!Array.isArray(raw) || raw.length === 0) return ClassList.withDefaults();
    const columns = raw.map((entry) => {
      if (typeof entry === 'string') return columnWith(entry);
      if (Array.isArray(entry)) return normalizeColumn(entry as Partial<DayLabel>[]);
      return columnWith('');
    });
    return new ClassList(columns);
  }

  get count(): number {
    return this.columns.length;
  }

  /** Text eines Beschriftungsfeldes. */
  label(classIdx: number, day: number, field: LabelField): string {
    return this.columns[classIdx]?.[day]?.[field] ?? '';
  }

  /** Hintergrundfarbe eines Beschriftungsfeldes (leer = keine). */
  color(classIdx: number, day: number, field: LabelField): string {
    return this.columns[classIdx]?.[day]?.[COLOR_KEY[field]] ?? '';
  }

  /**
   * Anzeigename für (Spalte, Tag, Woche): die wochenspezifische Zeile 2,
   * sonst die gemeinsame Zeile 1, sonst ein Platzhalter mit der Spaltennummer.
   */
  displayLabel(classIdx: number, day: number, week: Week): string {
    const dl = this.columns[classIdx]?.[day];
    if (!dl) return `Spalte ${classIdx + 1}`;
    const specific = week === 'u' ? dl.u : dl.g;
    return specific || dl.combined || `Spalte ${classIdx + 1}`;
  }

  /**
   * Erste vergebene Farbe für einen Beschriftungstext (über alle Felder),
   * für die automatische Farbübernahme bei gleichem Klassennamen. '' = keine.
   */
  colorForName(name: string): string {
    const key = name.trim().toLowerCase();
    if (!key) return '';
    for (const col of this.columns) {
      for (const dl of col) {
        if (dl.combinedColor && dl.combined.trim().toLowerCase() === key) return dl.combinedColor;
        if (dl.uColor && dl.u.trim().toLowerCase() === key) return dl.uColor;
        if (dl.gColor && dl.g.trim().toLowerCase() === key) return dl.gColor;
      }
    }
    return '';
  }

  /** Repräsentative Bezeichnung einer Spalte (z. B. für Lösch-Rückfragen). */
  columnLabel(classIdx: number): string {
    const col = this.columns[classIdx];
    if (col) {
      for (const dl of col) {
        const name = dl.combined || dl.u || dl.g;
        if (name) return name;
      }
    }
    return `Spalte ${classIdx + 1}`;
  }

  /** Fügt eine Spalte hinzu und gibt deren Index zurück. */
  add(): number {
    this.columns.push(columnWith(`Klasse ${this.columns.length + 1}`));
    return this.columns.length - 1;
  }

  /** Setzt den Text eines Beschriftungsfeldes (leer erlaubt). */
  setLabel(classIdx: number, day: number, field: LabelField, value: string): void {
    const dl = this.columns[classIdx]?.[day];
    if (dl) dl[field] = value;
  }

  /** Setzt die Hintergrundfarbe eines Beschriftungsfeldes (leer = keine). */
  setColor(classIdx: number, day: number, field: LabelField, color: string): void {
    const dl = this.columns[classIdx]?.[day];
    if (dl) dl[COLOR_KEY[field]] = color;
  }

  removeAt(idx: number): void {
    this.columns.splice(idx, 1);
  }

  /** Tiefe Kopie für die Persistenz. */
  toPersisted(): ClassColumn[] {
    return this.columns.map((col) => col.map((dl) => ({ ...dl })));
  }
}
