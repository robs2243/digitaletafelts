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
  kopplung: 'coupling',
  koppelung: 'coupling',
  kopplungsid: 'coupling',
  teamteaching: 'teamTeaching',
  team: 'teamTeaching',
  teamid: 'teamTeaching',
  hauptfach: 'mainSubject',
  hf: 'mainSubject',
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
    const klasse = String(cell(row, 'klasse') ?? '').trim();
    // Karte braucht mindestens ein Kürzel ODER eine Klasse (z. B. lehrerlose
    // Untis-Stunden wie „Betrieb" werden der Klasse zugeordnet).
    if (!abbr && !klasse) continue;
    const dur = parseInt(String(cell(row, 'duration') ?? ''), 10);
    const isLabor = truthy(cell(row, 'isLabor'));
    const isWerkstatt = truthy(cell(row, 'isWerkstatt'));
    // Gruppe a/b aus der jeweils passenden Spalte; sonst generische Gruppen-Spalte.
    const labGroup =
      (isWerkstatt ? group(raw(row, 'werkstattab')) : '') ||
      (isLabor ? group(raw(row, 'laborab')) : '') ||
      group(cell(row, 'labGroup'));
    out.push({
      klasse,
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
      coupling: String(cell(row, 'coupling') ?? '').trim(),
      teamTeaching: String(cell(row, 'teamTeaching') ?? '').trim(),
      collision: false,
      mainSubject: truthy(cell(row, 'mainSubject')),
      comment: String(cell(row, 'comment') ?? '').trim(),
    });
  }
  return out;
}

/**
 * Wandelt einen Untis-Export (AOA, 1. Zeile = Überschriften) in das Vorlage-Format
 * dieser App um (gleiche Spalten wie TEMPLATE_AOA). Regeln:
 *  - überflüssige Untis-Spalten (U-Nr, Kl,Le, Nvpl Std., Schülergruppe, Stammraum,
 *    U-Gruppen …) werden ignoriert,
 *  - Zeilen mit Wst = 0 (oder leer) entfallen,
 *  - mehrere Klassen in „Klasse(n)" → je Klasse eine Zeile mit gemeinsamer
 *    Kopplungs-ID (K1, K2 …), damit die Stunden gekoppelt geplant werden,
 *  - „Text" → „Kommentar" (1:1 kopiert),
 *  - sortiert nach Klasse, Kürzel, Fach.
 */
export function convertUntisToTemplate(rows: unknown[][]): (string | number)[][] {
  const header = TEMPLATE_AOA[0] as string[];
  if (!rows.length) return [header];
  const idx: Record<string, number> = {};
  (rows[0] ?? []).forEach((h, i) => {
    const k = norm(h);
    if (k && idx[k] === undefined) idx[k] = i;
  });
  const col = (row: unknown[], key: string): string => {
    const i = idx[key];
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };
  const out: (string | number)[][] = [];
  let kid = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const wst = parseInt(col(row, 'wst'), 10);
    if (!Number.isFinite(wst) || wst <= 0) continue; // Wst=0 / leer → raus
    const klassen = col(row, 'klassen') // „Klasse(n)" → normalisiert „klassen"
      .split(/[,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!klassen.length) continue;
    const lehrer = col(row, 'lehrer');
    const fachraum = col(row, 'fachraum');
    const stammraum = col(row, 'stammraum');
    const text = col(row, 'text');
    // Gruppe a/b aus dem Fach-Präfix (A_… / B_…); der Präfix wird entfernt.
    let fach = col(row, 'fach');
    const m = /^([ab])[_-](.+)$/i.exec(fach);
    const grp = m ? m[1].toLowerCase() : '';
    if (m) fach = m[2];
    // Werkstatt erkennt man an einem „W-…"-Raum (Fachraum oder Stammraum), sonst Labor.
    const isWerk = /^w-/i.test(fachraum) || /^w-/i.test(stammraum);
    const labor = grp && !isWerk ? 'x' : '';
    const werk = grp && isWerk ? 'x' : '';
    const laborAB = labor ? grp : '';
    const werkAB = werk ? grp : '';
    // Raum: bevorzugt Fachraum, sonst Stammraum (so geht der W-Raum nicht verloren).
    const raum = fachraum || stammraum;
    const kopplung = klassen.length > 1 ? `K${++kid}` : '';
    for (const kl of klassen) {
      // Reihenfolge wie TEMPLATE_AOA-Kopf: Klasse,Kürzel,Fach,Raum,Dauer,Labor,
      // Labor a/b,Werkstatt,Werkstatt a/b,4-wöchig,1.HJ,2.HJ,Kopplung,Teamteaching,
      // Hauptfach,Nicht zählen,Kommentar.
      out.push([kl, lehrer, fach, raum, wst, labor, laborAB, werk, werkAB, '', '', '', kopplung, '', '', '', text]);
    }
  }
  out.sort(
    (a, b) =>
      String(a[0]).localeCompare(String(b[0]), 'de', { numeric: true }) ||
      String(a[1]).localeCompare(String(b[1]), 'de', { numeric: true }) ||
      String(a[2]).localeCompare(String(b[2]), 'de', { numeric: true }),
  );
  return [header, ...out];
}

/** Vorlage-Inhalt (Überschriften + Beispielzeilen). */
export const TEMPLATE_AOA: (string | number)[][] = [
  ['Klasse', 'Kürzel', 'Fach', 'Raum', 'Dauer', 'Labor', 'Labor a/b', 'Werkstatt', 'Werkstatt a/b', '4-wöchig', '1. Halbjahr', '2. Halbjahr', 'Kopplung', 'Teamteaching', 'Hauptfach', 'Nicht zählen', 'Kommentar'],
  ['E3EG', 'KN', 'Mathematik', 'C103', 2, '', '', '', '', '', '', '', '', '', 'x', '', 'Hauptfach – bevorzugt 1.–6. Std'],
  ['5a', 'LZ', 'Deutsch', 'A12', 1, '', '', '', '', '', 'x', '', '', '', 'x', '', ''],
  ['7b', 'RD', 'Chemie', 'L1', 2, 'x', 'a', '', '', '', '', '', '', '', '', '', 'Labor Gruppe a'],
  ['7b', 'GH', 'Physik', 'L2', 2, 'x', 'b', '', '', '', '', '', '', '', '', '', 'Labor Gruppe b'],
  ['M1', 'ST', 'Metall', 'W1', 6, '', '', 'x', 'a', '', '', '', '', '', '', '', 'Werkstatt Gruppe a'],
  ['M1', 'KL', 'Metall', 'W2', 6, '', '', 'x', 'b', '', '', '', '', '', '', '', 'Werkstatt Gruppe b'],
  ['E3EG', 'MÜ', 'Sport', 'Halle', 2, '', '', '', '', 'x', '', '', '', '', '', '', '4-wöchiger Turnus'],
  ['E2EG', 'BM', 'Deutsch', 'A5', 2, '', '', '', '', '', '', '', 'K1', '', 'x', '', 'Kopplung mit M2WZ'],
  ['M2WZ', 'BM', 'Deutsch', 'A5', 2, '', '', '', '', '', '', '', 'K1', '', 'x', '', 'Kopplung mit E2EG'],
  ['9c', 'AB', 'WuK', 'C103', 2, '', '', '', '', '', '', '', '', 'T1', '', '', 'Teamteaching mit CD'],
  ['9c', 'CD', 'WuK', 'C103', 2, '', '', '', '', '', '', '', '', 'T1', '', '', 'Teamteaching mit AB'],
  ['5a', 'KN', 'gesperrt', '', 2, '', '', '', '', '', '', '', '', '', '', 'x', 'Block 1.+2. Std – zählt nicht'],
];
