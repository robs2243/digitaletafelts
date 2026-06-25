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
  schiene: 'schiene',
  schienen: 'schiene',
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

/** Wert auf eine gültige Gruppe ('a' | 'b' | 'c' | 'd' | '') reduzieren. */
function group(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  return ['a', 'b', 'c', 'd'].includes(s) ? s : '';
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
    const room = String(cell(row, 'room') ?? '').trim();
    const isLabor = truthy(cell(row, 'isLabor'));
    // Werkstatt = Flag gesetzt ODER „W-…"-Raum (ein W-Raum kennzeichnet immer Werkstatt).
    const isWerkstatt = truthy(cell(row, 'isWerkstatt')) || /^w-/i.test(room);
    const fach = String(cell(row, 'fach') ?? '').trim();
    // Gruppe a/b aus der jeweils passenden Spalte; sonst generische Gruppen-Spalte.
    // Betrieb-Karten (A_Betrieb/B_Betrieb …) erhalten ihre Gruppe aus dem Fach-Präfix,
    // damit A_ und B_ am Betriebstag parallel (gestapelt) liegen können.
    const labGroup =
      (isWerkstatt ? group(raw(row, 'werkstattab')) : '') ||
      (isLabor ? group(raw(row, 'laborab')) : '') ||
      group(cell(row, 'labGroup')) ||
      (/betrieb/i.test(fach) ? (/^([abcd])[_-]/i.exec(fach)?.[1] ?? '').toLowerCase() : '');
    out.push({
      klasse,
      abbr,
      fach,
      name: '',
      room,
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
      schiene: truthy(cell(row, 'schiene')),
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
    // Fach 1:1 aus Untis übernehmen. Gruppe a/b nur am Präfix (A_… / B_…) ERKENNEN,
    // den Namen aber NICHT verändern (z. B. „A_LBTW" bleibt „A_LBTW").
    const fach = col(row, 'fach');
    const m = /^([abcd])[_-]/i.exec(fach);
    const grp = m ? m[1].toLowerCase() : '';
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
      out.push([kl, lehrer, fach, raum, wst, labor, laborAB, werk, werkAB, '', '', '', kopplung, '', '', '', '', text]);
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

/** Ergebnis der Untis-Umwandlung: Vorlage-Zeilen + Kontrolle je Klasse. */
export interface UntisResult {
  /** Vorlage-AOA (1. Zeile = Überschriften). */
  aoa: (string | number)[][];
  /** Je Klasse: Soll (Summe „Wert ="), erzeugte Karten (ohne Betrieb) und Betrieb-Karten. */
  control: { klasse: string; soll: number; ist: number; betrieb: number }[];
  /** Hinweise (z. B. beschädigte „Wert ="-Zellen, die geschätzt wurden). */
  flags: string[];
}

/** Erkennt das Block-/Deputate-Format (Spalte „Wert =" / „ZeilenWert"). */
export function isDeputateFormat(rows: unknown[][]): boolean {
  return rows.slice(0, 6).some((r) => (r ?? []).some((c) => /^wert\s*=/i.test(String(c ?? '').trim())));
}

/**
 * Wandelt den Untis-Deputate-Export (Blockformat je Klasse: Spalten
 * Wert=, Wst, U-Gruppen, Lehrer, Fach, Klasse(n), Schülergruppe, ZeilenWert) ins
 * Vorlage-Format um:
 *  - „Wert =" = Anzahl Karten je Zeile (gerundet), je Karte Dauer 2;
 *  - A_Betrieb/B_Betrieb → immer 8 Karten;
 *  - mehrere Klassen → Kopplung (Karten je Klasse, eigene K-ID je Doppelstunde);
 *  - Werkstatt: Fach enthält LBP/LBTW/WP_ATM; sonst Gruppen-Fach (A_/B_/C_/D_) = Labor;
 *  - Gruppe: A→a, B→b, C→a, D→b (Präfix X_ oder Suffix _X);
 *  - WST/U-Gruppen/Schülergruppe/ZeilenWert entfallen; sortiert; Kontrolle je Klasse.
 *  - Beschädigte „Wert ="-Zellen (als Datum formatiert) werden geschätzt + markiert.
 */
export function convertUntisDeputate(rows: unknown[][]): UntisResult {
  const header = TEMPLATE_AOA[0] as string[];
  const out: (string | number)[][] = [];
  const flags: string[] = [];
  const ist = new Map<string, number>(); // Karten je Klasse (ohne Betrieb)
  const betrieb = new Map<string, number>(); // Betrieb-Karten je Klasse
  const soll = new Map<string, number>();
  // Gekoppelte Lektionen stehen in BEIDEN Klassen-Blöcken. Damit beide Seiten
  // dieselbe Kopplungs-ID bekommen, vergeben wir IDs pro „Lektion+Einheit".
  const coupId = new Map<string, string>();
  let kid = 0;
  const couplingFor = (lehrer: string, fach: string, partners: string[], u: number): string => {
    const key = `${lehrer.toLowerCase()}|${fach.toLowerCase()}|${[...partners].sort().join(',')}|${u}`;
    let id = coupId.get(key);
    if (!id) {
      id = `K${++kid}`;
      coupId.set(key, id);
    }
    return id;
  };
  let block = '';

  const parseWert = (v: unknown): { n: number; bad: boolean } => {
    if (typeof v === 'number') return v > 60 ? { n: 0, bad: true } : { n: v, bad: false }; // >60 = Datums-Serie
    const f = parseFloat(String(v ?? '').trim().replace(',', '.'));
    return { n: Number.isFinite(f) ? f : 0, bad: false };
  };

  for (const row of rows) {
    const c0 = String(row[0] ?? '').trim();
    const fach = String(row[4] ?? '').trim();
    if (/^wert\s*=/i.test(c0)) continue; // Spaltenkopf
    if (!fach) {
      // Ohne Fach: reine Zahl in col0 = Summenzeile (Soll des Blocks); sonst ist
      // col0 der Klassenname = Block-Kopf. (Manche Köpfe haben in col1 eine
      // Langbezeichnung, z. B. „BVE1"/„BVE" – daher NICHT c0===c1 prüfen.)
      if (/^\d+([.,]\d+)?$/.test(c0)) {
        // Summenzelle = Soll. Datums-Serial (>1000) ist beschädigt → nicht
        // übernehmen, sondern melden (echte Soll-Summen liegen unter ~60).
        if (block) {
          const sn = typeof row[0] === 'number' ? row[0] : parseFloat(c0.replace(',', '.'));
          if (Number.isFinite(sn) && sn <= 1000) soll.set(block, sn);
          else flags.push(`${block}: Soll-/Summenzelle beschädigt (Wert „${c0}")`);
        }
      } else if (c0) block = c0;
      continue;
    }
    if (!block) continue;
    const partners = String(row[5] ?? '')
      .split(/[,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const coupled = partners.length > 1;
    const lehrer = String(row[3] ?? '').trim();
    // Gruppe a/b/c/d aus Präfix X_ oder Suffix _X (1:1 übernommen – die Parallelität
    // mehrerer Gruppen wird über die Kopplungen vorgegeben).
    const gm = /^([abcd])[_-]/i.exec(fach) ?? /[_-]([abcd])$/i.exec(fach);
    const grp = gm ? gm[1].toLowerCase() : '';
    const isBetrieb = /betrieb/i.test(fach);
    const isWerk = !isBetrieb && /(lbp|lbtw|wp[_-]?atm)/i.test(fach);
    const labor = !isBetrieb && grp && !isWerk ? 'x' : '';
    const werk = isWerk ? 'x' : '';
    const laborAB = labor ? grp : '';
    const werkAB = werk ? grp : '';
    const w = parseWert(row[0]);
    let count = isBetrieb ? 8 : Math.round(w.n);
    let note = '';
    if (w.bad) {
      const wst = Number(row[1]);
      count = Number.isFinite(wst) && wst > 0 ? Math.max(1, Math.round(wst / 2)) : 1;
      note = 'Wert prüfen';
      flags.push(`${block}: ${fach} (${partners.join(',')}) – „Wert =" beschädigt, geschätzt ${count}`);
    }
    if (count < 1) continue;
    // Karten NUR für die Block-Klasse erzeugen (die Partner-Klasse liefert ihre
    // eigenen Karten aus ihrem Block – gekoppelt über dieselbe K-ID).
    for (let u = 0; u < count; u++) {
      const kop = coupled ? couplingFor(lehrer, fach, partners, u) : '';
      out.push([block, lehrer, fach, '', 2, labor, laborAB, werk, werkAB, '', '', '', kop, '', '', '', '', note]);
      if (isBetrieb) betrieb.set(block, (betrieb.get(block) ?? 0) + 1);
      else ist.set(block, (ist.get(block) ?? 0) + 1);
    }
  }
  out.sort(
    (a, b) =>
      String(a[0]).localeCompare(String(b[0]), 'de', { numeric: true }) ||
      String(a[1]).localeCompare(String(b[1]), 'de', { numeric: true }) ||
      String(a[2]).localeCompare(String(b[2]), 'de', { numeric: true }),
  );
  const klassen = new Set([...soll.keys(), ...ist.keys(), ...betrieb.keys()]);
  const control = [...klassen]
    .map((kl) => ({ klasse: kl, soll: soll.get(kl) ?? 0, ist: ist.get(kl) ?? 0, betrieb: betrieb.get(kl) ?? 0 }))
    .sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }));
  return { aoa: [header, ...out], control, flags };
}

/** Vorlage-Inhalt (Überschriften + Beispielzeilen). */
export const TEMPLATE_AOA: (string | number)[][] = [
  ['Klasse', 'Kürzel', 'Fach', 'Raum', 'Dauer', 'Labor', 'Labor a/b', 'Werkstatt', 'Werkstatt a/b', '4-wöchig', '1. Halbjahr', '2. Halbjahr', 'Kopplung', 'Teamteaching', 'Hauptfach', 'Schiene', 'Nicht zählen', 'Kommentar'],
  ['E3EG', 'KN', 'Mathematik', 'C103', 2, '', '', '', '', '', '', '', '', '', 'x', '', '', 'Hauptfach – bevorzugt 1.–6. Std'],
  ['5a', 'LZ', 'Deutsch', 'A12', 1, '', '', '', '', '', 'x', '', '', '', 'x', '', '', ''],
  ['7b', 'RD', 'Chemie', 'L1', 2, 'x', 'a', '', '', '', '', '', '', '', '', '', '', 'Labor Gruppe a'],
  ['7b', 'GH', 'Physik', 'L2', 2, 'x', 'b', '', '', '', '', '', '', '', '', '', '', 'Labor Gruppe b'],
  ['M1', 'ST', 'Metall', 'W1', 6, '', '', 'x', 'a', '', '', '', '', '', '', '', '', 'Werkstatt Gruppe a'],
  ['M1', 'KL', 'Metall', 'W2', 6, '', '', 'x', 'b', '', '', '', '', '', '', '', '', 'Werkstatt Gruppe b'],
  ['E3EG', 'MÜ', 'Sport', 'Halle', 2, '', '', '', '', 'x', '', '', '', '', '', '', '', '4-wöchiger Turnus'],
  ['E2EG', 'BM', 'Deutsch', 'A5', 2, '', '', '', '', '', '', '', 'K1', '', 'x', 'x', '', 'Kopplung + Schiene (S) über mehrere Klassen'],
  ['M2WZ', 'BM', 'Deutsch', 'A5', 2, '', '', '', '', '', '', '', 'K1', '', 'x', 'x', '', 'Kopplung + Schiene (S) über mehrere Klassen'],
  ['9c', 'AB', 'WuK', 'C103', 2, '', '', '', '', '', '', '', '', 'T1', '', '', '', 'Teamteaching mit CD'],
  ['9c', 'CD', 'WuK', 'C103', 2, '', '', '', '', '', '', '', '', 'T1', '', '', '', 'Teamteaching mit AB'],
  ['5a', 'KN', 'gesperrt', '', 2, '', '', '', '', '', '', '', '', '', '', '', 'x', 'Block 1.+2. Std – zählt nicht'],
];
