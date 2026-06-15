import { PALETTE } from '../domain/constants';
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

/** Zeilen (erste Zeile = Überschriften) in Karten umwandeln. Ohne Kürzel = übersprungen. */
export function parseCardRows(rows: unknown[][]): CardProps[] {
  if (!rows.length) return [];
  const idxByField: Partial<Record<keyof CardProps, number>> = {};
  (rows[0] ?? []).forEach((h, i) => {
    const field = HEADER_MAP[norm(h)];
    if (field && idxByField[field] === undefined) idxByField[field] = i;
  });

  const cell = (row: unknown[], field: keyof CardProps): unknown => {
    const i = idxByField[field];
    return i === undefined ? '' : row[i];
  };

  const out: CardProps[] = [];
  let autoColor = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const abbr = String(cell(row, 'abbr') ?? '').trim().toUpperCase();
    if (!abbr) continue;
    const color = parseColor(cell(row, 'color')) || PALETTE[autoColor++ % PALETTE.length];
    const dur = parseInt(String(cell(row, 'duration') ?? ''), 10);
    const lg = String(cell(row, 'labGroup') ?? '').trim().toLowerCase();
    out.push({
      klasse: String(cell(row, 'klasse') ?? '').trim(),
      abbr,
      fach: String(cell(row, 'fach') ?? '').trim(),
      name: '',
      room: String(cell(row, 'room') ?? '').trim(),
      duration: Number.isFinite(dur) && dur >= 1 && dur <= 9 ? dur : 2,
      color,
      isLabor: truthy(cell(row, 'isLabor')),
      labGroup: lg === 'a' || lg === 'b' ? lg : '',
      isWerkstatt: truthy(cell(row, 'isWerkstatt')),
      isVierwoechig: truthy(cell(row, 'isVierwoechig')),
      firstHalf: truthy(cell(row, 'firstHalf')),
      secondHalf: truthy(cell(row, 'secondHalf')),
      comment: String(cell(row, 'comment') ?? '').trim(),
    });
  }
  return out;
}

/** Vorlage-Inhalt (Überschriften + Beispielzeilen). */
export const TEMPLATE_AOA: (string | number)[][] = [
  ['Klasse', 'Kürzel', 'Fach', 'Raum', 'Dauer', 'Farbe', 'Labor', 'Gruppe (a/b)', 'Werkstatt', '4-wöchig', '1. Halbjahr', '2. Halbjahr', 'Kommentar'],
  ['E3EG', 'KN', 'Mathematik', 'C103', 2, '#4f46e5', '', '', '', '', '', '', 'Taschenrechner mitbringen'],
  ['5a', 'LZ', 'Deutsch', 'A12', 1, '', '', '', '', '', 'x', '', ''],
  ['7b', 'RD', 'Chemie', 'L1', 2, '', 'x', 'a', '', '', '', '', 'Labor Gruppe a'],
  ['7b', 'GH', 'Physik', 'L2', 2, '', 'x', 'b', '', '', '', '', 'Labor Gruppe b'],
  ['M1', 'ST', 'Metall', 'W1', 6, '', '', 'a', 'x', '', '', '', 'Werkstatt Gruppe a'],
  ['M1', 'KL', 'Metall', 'W2', 6, '', '', 'b', 'x', '', '', '', 'Werkstatt Gruppe b'],
  ['E3EG', 'MÜ', 'Sport', 'Halle', 2, '', '', '', '', 'x', '', '', '4-wöchiger Turnus'],
];
