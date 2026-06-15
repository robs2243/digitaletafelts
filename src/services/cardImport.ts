import type { CardProps } from '../domain/types';

/** Normalisierte Spaltenüberschrift → Karten-Feld. */
const HEADER_MAP: Record<string, keyof CardProps> = {
  klasse: 'klasse',
  kuerzel: 'abbr',
  kurzel: 'abbr',
  fach: 'fach',
  raum: 'room',
  dauer: 'duration',
  stunden: 'duration',
  farbe: 'color',
  color: 'color',
  labor: 'isLabor',
  laborgruppe: 'labGroup',
  gruppe: 'labGroup',
  gruppeab: 'labGroup',
  werkstatt: 'isWerkstatt',
  '4woechig': 'isVierwoechig',
  vierwoechig: 'isVierwoechig',
  '4wochig': 'isVierwoechig',
  '1halbjahr': 'firstHalf',
  hj1: 'firstHalf',
  '1hj': 'firstHalf',
  '2halbjahr': 'secondHalf',
  hj2: 'secondHalf',
  '2hj': 'secondHalf',
  nichtzaehlen: 'noCount',
  nichtzahlen: 'noCount',
  nichtzaehlend: 'noCount',
  nichtzaehlt: 'noCount',
  nichtwerten: 'noCount',
  kommentar: 'comment',
};

/** Überschrift robust normalisieren (Umlaute, Sonderzeichen, Groß/Klein). */
function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function truthy(v: unknown): boolean {
  return ['x', 'ja', 'j', 'yes', 'y', '1', 'true', 'wahr'].includes(String(v ?? '').trim().toLowerCase());
}

function parseColor(v: unknown): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  return m ? `#${m[1].toLowerCase()}` : '';
}

/** Wert auf eine gültige Gruppe ('a' | 'b' | '') reduzieren. */
function group(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'a' || s === 'b' ? s : '';
}

/**
 * Zeilen (erste Zeile = Überschriften) in Karten umwandeln. Ohne Kürzel = übersprungen.
 * Die Farbe wird hier NICHT vergeben – das macht die App ausgewogen je Kürzel
 * (siehe AppState.fillCardColors). Eine optionale „Farbe"-Spalte wird respektiert.
 */
export function parseCardRows(rows: unknown[][]): CardProps[] {
  if (!rows.length) return [];
  const idxByField: Partial<Record<keyof CardProps, number>> = {};
  const headerIdx: Record<string, number> = {};
  (rows[0] ?? []).forEach((h, i) => {
    const key = norm(h);
    if (key && headerIdx[key] === undefined) headerIdx[key] = i;
    const field = HEADER_MAP[key];
    if (field && idxByField[field] === undefined) idxByField[field] = i;
  });

  const cell = (row: unknown[], field: keyof CardProps): unknown => {
    const i = idxByField[field];
    return i === undefined ? '' : row[i];
  };
  /** Rohzelle anhand der normalisierten Überschrift (für die zwei a/b-Spalten). */
  const raw = (row: unknown[], key: string): unknown => {
    const i = headerIdx[key];
    return i === undefined ? '' : row[i];
  };

  const out: CardProps[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const abbr = String(cell(row, 'abbr') ?? '').trim().toUpperCase();
    if (!abbr) continue;
    const dur = parseInt(String(cell(row, 'duration') ?? ''), 10);
    const isLabor = truthy(cell(row, 'isLabor'));
    const isWerkstatt = truthy(cell(row, 'isWerkstatt'));
    // Gruppe a/b aus der jeweils passenden Spalte; sonst generische Gruppen-Spalte.
    const labGroup =
      (isWerkstatt ? group(raw(row, 'werkstattab')) : '') ||
      (isLabor ? group(raw(row, 'laborab')) : '') ||
      group(cell(row, 'labGroup'));
    out.push({
      klasse: String(cell(row, 'klasse') ?? '').trim(),
      abbr,
      fach: String(cell(row, 'fach') ?? '').trim(),
      name: '',
      room: String(cell(row, 'room') ?? '').trim(),
      duration: Number.isFinite(dur) && dur >= 1 && dur <= 9 ? dur : 2,
      color: parseColor(cell(row, 'color')),
      isLabor,
      labGroup,
      isWerkstatt,
      isVierwoechig: truthy(cell(row, 'isVierwoechig')),
      firstHalf: truthy(cell(row, 'firstHalf')),
      secondHalf: truthy(cell(row, 'secondHalf')),
      noCount: truthy(cell(row, 'noCount')),
      comment: String(cell(row, 'comment') ?? '').trim(),
    });
  }
  return out;
}

/** Vorlage-Inhalt (Überschriften + Beispielzeilen). */
export const TEMPLATE_AOA: (string | number)[][] = [
  ['Klasse', 'Kürzel', 'Fach', 'Raum', 'Dauer', 'Labor', 'Labor a/b', 'Werkstatt', 'Werkstatt a/b', '4-wöchig', '1. Halbjahr', '2. Halbjahr', 'Nicht zählen', 'Kommentar'],
  ['E3EG', 'KN', 'Mathematik', 'C103', 2, '', '', '', '', '', '', '', '', 'Taschenrechner mitbringen'],
  ['5a', 'LZ', 'Deutsch', 'A12', 1, '', '', '', '', '', 'x', '', '', ''],
  ['7b', 'RD', 'Chemie', 'L1', 2, 'x', 'a', '', '', '', '', '', '', 'Labor Gruppe a'],
  ['7b', 'GH', 'Physik', 'L2', 2, 'x', 'b', '', '', '', '', '', '', 'Labor Gruppe b'],
  ['M1', 'ST', 'Metall', 'W1', 6, '', '', 'x', 'a', '', '', '', '', 'Werkstatt Gruppe a'],
  ['M1', 'KL', 'Metall', 'W2', 6, '', '', 'x', 'b', '', '', '', '', 'Werkstatt Gruppe b'],
  ['E3EG', 'MÜ', 'Sport', 'Halle', 2, '', '', '', '', 'x', '', '', '', '4-wöchiger Turnus'],
  ['5a', 'KN', 'gesperrt', '', 2, '', '', '', '', '', '', '', 'x', 'Block 1.+2. Std – zählt nicht'],
];
