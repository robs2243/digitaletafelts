/**
 * SELBSTTEST: lädt Layout-JSON + alle Excel-Karten, plant automatisch und prüft
 * JEDE Planungsregel einzeln (PASS/FAIL). Dient als Regressionstest nach jeder
 * Planer-Änderung.
 *
 *   bun scripts/plan-selftest.mjs <layout.json> <excel-ordner> [budgetSekunden]
 *
 * Exit-Code 0 = alle Regeln erfüllt, 1 = mindestens ein FAIL.
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import * as XLSX from 'xlsx';
import { parseCardRows } from '../src/services/cardImport.ts';
import { AppState } from '../src/domain/AppState.ts';
import { Card } from '../src/domain/Card.ts';
import { DAYS, WEEKS } from '../src/domain/constants.ts';
import { teachingPeriods, blockedPeriods } from '../src/domain/periods.ts';

const [layoutPath, dir, budgetArg] = process.argv.slice(2);
const budgetS = Number(budgetArg ?? 60);
if (!layoutPath || !dir) {
  console.error('Aufruf: bun scripts/plan-selftest.mjs <layout.json> <excel-ordner> [budgetSekunden]');
  process.exit(1);
}

const st = AppState.fromJSON(JSON.parse(fs.readFileSync(layoutPath, 'utf8')));
let nid = 1;
for (const f of fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
  const wb = XLSX.readFile(nodePath.join(dir, f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
  for (const c of parseCardRows(rows)) st.pool.add(new Card(String(nid++), c));
}
st.ensureClassColumns([...new Set(st.pool.all.map((c) => c.klasse.trim()).filter(Boolean))]);
const totalCards = st.pool.all.length;

const t0 = Date.now();
const res = await st.planBest({ budgetMs: budgetS * 1000, shouldStop: () => 'continue', onProgress: () => {} });
console.log(`Plan: ${res.placed}/${totalCards} verplant, offen ${res.skipped.length}, ${Math.round((Date.now() - t0) / 1000)}s, ${res.attempts} Versuche\n`);

// ── Hilfen ────────────────────────────────────────────────────────────────
const pls = st.schedule.all;
const isSk = (f) => /^([abcd][_-])?sk\d*$/i.test(f.trim());
const isSpan = (f) => /^([abcd][_-])?sb\d+$/i.test(f.trim());
const isOlz = (f) => /(^|[^a-z])olz([^a-z]|$)/i.test(f.trim());
const isBetrieb = (f) => /betrieb/i.test(f);
const kl = (p) => p.klasse.trim().toLowerCase();
const teach = (p) => teachingPeriods(p.isWerkstatt, p.startPeriod, p.duration);
const blocked = (p) => blockedPeriods(p.isWerkstatt, p.startPeriod, p.duration);
const lbl = (p) => `${p.klasse} ${p.abbr || '-'} ${p.fach} ${DAYS[p.day].slice(0, 2)}-${p.week}-${p.startPeriod}`;

let fails = 0;
const check = (name, errors, max = 4) => {
  if (errors.length === 0) console.log(`  PASS  ${name}`);
  else {
    fails++;
    console.log(`  FAIL  ${name} (${errors.length}×)`);
    errors.slice(0, max).forEach((e) => console.log(`        - ${e}`));
  }
};
const info = (name, text) => console.log(`  info  ${name}: ${text}`);

console.log('=== Regel-Prüfung ===');

// 1) Zellen-Doppelbelegung: Stapeln nur Labor/Werkstatt/Betrieb mit Gruppen a-d.
//    Karten DERSELBEN Kopplung zählen als EINE Einheit (vom Anwender definierte
//    Parallelität, z. B. Doppelbesetzung); verschiedene Einheiten brauchen
//    verschiedene Gruppen, höchstens 4 je Zelle.
{
  const cell = new Map();
  for (const p of pls) for (const per of blocked(p)) {
    const k = `${p.classIdx}|${p.day}|${p.week}|${per}`;
    (cell.get(k) ?? cell.set(k, []).get(k)).push(p);
  }
  const errs = [];
  for (const [k, arr] of cell) {
    if (arr.length < 2) continue;
    const units = new Map();
    for (const p of arr) {
      const u = p.coupling.trim() || p.teamTeaching.trim() || `solo-${p.id}`;
      (units.get(u) ?? units.set(u, []).get(u)).push(p);
    }
    if (units.size < 2) continue; // eine Kopplung/Team-Einheit → vom Anwender gewollt
    const stackOk = arr.every((p) => (p.isLabor || p.isWerkstatt || isBetrieb(p.fach)) && ['a', 'b', 'c', 'd'].includes(p.labGroup));
    const unitGroups = [...units.values()].map((u) => [...new Set(u.map((p) => p.labGroup))].sort().join(''));
    const distinct = new Set(unitGroups).size === unitGroups.length;
    if (!stackOk || !distinct || units.size > 4) errs.push(`${k}: ${arr.map(lbl).join(' | ')}`);
  }
  check('Zellen-Belegung (Stapeln nur Gruppen a-d, Einheiten distinct, ≤4)', errs);
}

// 2) Lehrer-Doppelbelegung (gleicher Slot nur bei gleicher Kopplung/Team)
{
  const m = new Map();
  for (const p of pls) { if (!p.abbr.trim()) continue; for (const per of blocked(p)) {
    const k = `${p.abbr.toLowerCase()}|${p.day}|${p.week}|${per}`;
    (m.get(k) ?? m.set(k, []).get(k)).push(p);
  } }
  const errs = [];
  for (const [k, arr] of m) {
    if (arr.length < 2) continue;
    const c0 = arr[0].coupling.trim(); const t0m = arr[0].teamTeaching.trim();
    const linked = arr.every((p) => (c0 && p.coupling.trim() === c0) || (t0m && p.teamTeaching.trim() === t0m));
    if (!linked) errs.push(`${k}: ${arr.map(lbl).join(' | ')}`);
  }
  check('Lehrkraft nie doppelt (außer Kopplung/Team)', errs);
}

// 3) Raum-Doppelbelegung
{
  const m = new Map();
  for (const p of pls) { if (!p.room.trim()) continue; for (const per of blocked(p)) {
    const k = `${p.room.trim().toLowerCase()}|${p.day}|${p.week}|${per}`;
    (m.get(k) ?? m.set(k, []).get(k)).push(p);
  } }
  const errs = [];
  for (const [k, arr] of m) {
    if (arr.length < 2) continue;
    const c0 = arr[0].coupling.trim();
    const linked = arr.every((p) => c0 && p.coupling.trim() === c0);
    if (!linked) errs.push(`${k}: ${arr.map(lbl).join(' | ')}`);
  }
  check('Raum nie doppelt (außer gleiche Kopplung)', errs);
}

// 4) 7. Stunde frei (außer Werkstatt / Seminarkurs / Betrieb)
check('7. Stunde frei (außer Werkstatt/Sk/Betrieb)',
  pls.filter((p) => teach(p).includes(7) && !p.isWerkstatt && !isSk(p.fach) && !isBetrieb(p.fach)).map(lbl));

// 5) Labor nie in der 7. (auch wenn als Werkstatt markiert wäre)
check('Labor nie in der 7. Stunde', pls.filter((p) => p.isLabor && !isSk(p.fach) && teach(p).includes(7)).map(lbl));

// 6) Seminarkurs nur Montag 7.–9.
check('Seminarkurs (SK) nur Mo 7.–9.',
  pls.filter((p) => isSk(p.fach) && (p.day !== 0 || p.startPeriod < 7 || p.startPeriod + p.duration - 1 > 9)).map(lbl));

// 7) Spanisch nur Randstunden 1+2 / 8+9
check('Spanisch (SBx) nur 1+2 / 8+9', pls.filter((p) => isSpan(p.fach) && p.startPeriod !== 1 && p.startPeriod !== 8).map(lbl));

// 8) OLZ: Randstunden + volle Schiene über alle OLZ-Klassen + u/g-Spiegelung
{
  const olz = pls.filter((p) => isOlz(p.fach));
  const olzClasses = [...new Set(olz.map(kl))].sort();
  check('OLZ nur 1+2 / 8+9', olz.filter((p) => p.startPeriod !== 1 && p.startPeriod !== 8).map(lbl));
  const bySlot = new Map();
  for (const p of olz) { const k = `${DAYS[p.day].slice(0, 2)}-${p.startPeriod}-${p.week}`; (bySlot.get(k) ?? bySlot.set(k, new Set()).get(k)).add(kl(p)); }
  check(`OLZ-Schiene: jeder Slot mit ALLEN ${olzClasses.length} Klassen (${olzClasses.join(',')})`,
    [...bySlot].filter(([, s]) => s.size !== olzClasses.length).map(([k, s]) => `${k}: nur ${[...s].join(',')}`));
  const mirror = new Map();
  for (const p of olz) { const k = `${kl(p)}|${p.abbr.toLowerCase()}`; (mirror.get(k) ?? mirror.set(k, { u: new Set(), g: new Set() }).get(k))[p.week].add(`${p.day}|${p.startPeriod}`); }
  const unmirrored = [...mirror].filter(([, v]) => [...v.u].sort().join() !== [...v.g].sort().join()).map(([k]) => k);
  info('OLZ u/g gespiegelt (Bonus, kein Muss)', unmirrored.length ? `${unmirrored.length} ungespiegelt: ${unmirrored.join(', ')}` : 'alle gespiegelt');
  info('OLZ-Verteilung', `${new Set(olz.map((p) => p.day)).size} verschiedene Tage, ${bySlot.size} Slots, ${olz.length} Karten`);
}

// 9) Betriebstage: alle Betrieb-Karten verplant, 1BFB nur Montag, 1BFK nur Mittwoch (1–8)
{
  const open = st.pool.all.filter((c) => isBetrieb(c.fach));
  check('Alle Betrieb-Karten verplant', open.map((c) => `${c.klasse} ${c.fach} (offen)`));
  check('1BFB-Betrieb nur Montag, Blöcke 1.–4./5.–8.',
    pls.filter((p) => kl(p) === '1bfb' && isBetrieb(p.fach) && (p.day !== 0 || ![1, 5].includes(p.startPeriod))).map(lbl));
  check('1BFK-Betrieb nur Mittwoch 1.–8.',
    pls.filter((p) => kl(p) === '1bfk' && isBetrieb(p.fach) && (p.day !== 2 || p.startPeriod !== 1)).map(lbl));
}

// 10) Werkstatt-Schienen: je Paar EIN gemeinsamer Tag, richtige Fenster, u/g gespiegelt
{
  const pair = (classes, wantStarts, label) => {
    const w = pls.filter((p) => p.isWerkstatt && classes.includes(kl(p)));
    if (!w.length) { info(label, 'keine Werkstatt-Karten'); return; }
    const days = [...new Set(w.map((p) => p.day))];
    const errs = [];
    if (days.length !== 1) errs.push(`Tage: ${days.map((d) => DAYS[d].slice(0, 2)).join(',')} (erwartet: EIN Tag)`);
    for (const c of classes) for (const week of WEEKS) {
      const starts = [...new Set(w.filter((p) => kl(p) === c && p.week === week).map((p) => p.startPeriod))].sort((a, b) => a - b);
      if (starts.join(',') !== wantStarts.join(',')) errs.push(`${c} ${week}: Starts [${starts}] statt [${wantStarts}]`);
    }
    check(label, errs);
  };
  pair(['2bfe2', '2bfm2'], [1, 3, 6, 8], 'Werkstatt 2BFE2+2BFM2: EIN Tag, voll 1–4+6–9');
  pair(['av1', 'av2'], [3, 5], 'Werkstatt AV1+AV2: EIN Tag, durchgehend 3–6');
  pair(['av3', 'av4'], [1, 3, 6, 8], 'Werkstatt AV3+AV4: EIN Tag, voll 1–4+6–9');
}

// 11) Werkstatt nie unter 4h am Tag (je Klasse+Gruppe)
{
  const m = new Map();
  for (const p of pls.filter((p) => p.isWerkstatt)) {
    const k = `${kl(p)}|${p.labGroup}|${p.day}|${p.week}`;
    m.set(k, (m.get(k) ?? 0) + p.duration);
  }
  check('Werkstatt ≥4 Std am Tag (je Klasse+Gruppe)', [...m].filter(([, h]) => h < 4).map(([k, h]) => `${k}: ${h}h`));
}

// 12) Hauptfach (nur x): max 2 Std/Tag je Klasse+Fach
{
  const m = new Map();
  for (const p of pls.filter((p) => p.mainSubject)) {
    const k = `${kl(p)}|${p.fach.toLowerCase()}|${p.day}|${p.week}`;
    m.set(k, (m.get(k) ?? 0) + p.duration);
  }
  check('Hauptfach (x) max 2 Std/Tag', [...m].filter(([, h]) => h > 2).map(([k, h]) => `${k}: ${h}h`));
  const late = pls.filter((p) => p.mainSubject && p.startPeriod > 6).length;
  info('Hauptfach in 8/9', `${late} Karten (weiche Regel)`);
}

// 13) Lehrer-Tagesstunden: max 6 (8 bei Werkstatt/Labor/Betrieb/K2FR/K3FR-Tag)
{
  const hours = new Map();
  const allow8 = new Set();
  for (const p of pls) {
    if (!p.abbr.trim()) continue;
    const dk = `${p.abbr.toLowerCase()}|${p.day}|${p.week}`;
    const set = hours.get(dk) ?? hours.set(dk, new Set()).get(dk);
    for (const per of teach(p)) set.add(per);
    if (p.isWerkstatt || p.isLabor || isBetrieb(p.fach) || ['k2fr', 'k3fr'].includes(kl(p))) allow8.add(dk);
  }
  check('Lehrkraft ≤6 Std/Tag (≤8 bei Werkstatt/Labor/8h-Klassen)',
    [...hours].filter(([k, s]) => s.size > (allow8.has(k) ? 8 : 6)).map(([k, s]) => `${k}: ${s.size} Std`));
}

// 14) LBT max 6 Std/Tag je Klasse (Stunden-SLOTS: parallele Gruppen zählen einmal)
{
  const m = new Map();
  for (const p of pls.filter((p) => p.fach.trim().toLowerCase() === 'lbt')) {
    const k = `${kl(p)}|${p.day}|${p.week}`;
    const set = m.get(k) ?? m.set(k, new Set()).get(k);
    for (const per of teach(p)) set.add(per);
  }
  check('LBT ≤6 Std/Tag je Klasse', [...m].filter(([, s]) => s.size > 6).map(([k, s]) => `${k}: ${s.size}h`));
}

// 14b) KLASSEN ohne Hohlstunden (harte Schüler-Regel): zwischen erster und letzter
//      Stunde eines Klassentags durchweg Unterricht; Pausen: 7. Stunde, an
//      Werkstatt-Tagen stattdessen die 5. – 1–6-Abdeckung als Messwert (datenabhängig).
{
  const byCD = new Map();
  for (const p of pls) {
    const k = `${p.classIdx}|${p.day}|${p.week}`;
    const e = byCD.get(k) ?? byCD.set(k, { periods: new Set(), werk: false, name: p.klasse.trim() || '?' }).get(k);
    for (const per of blocked(p)) e.periods.add(per);
    if (p.isWerkstatt) e.werk = true;
  }
  const errs = [];
  let under6 = 0;
  for (const [k, e] of byCD) {
    const [, d, w] = k.split('|');
    const isPause = (p) => p === 7 || (e.werk && p === 5);
    const ps = [...e.periods].filter((p) => !isPause(p)).sort((a, b) => a - b);
    if (!ps.length) continue;
    const holes = [];
    for (let p = ps[0]; p <= ps[ps.length - 1]; p++) if (!isPause(p) && !e.periods.has(p)) holes.push(p);
    if (holes.length) errs.push(`${e.name} ${DAYS[+d].slice(0, 2)}-${w}: Lücke Std ${holes.join(',')} (belegt ${ps.join(',')})`);
    for (let p = 1; p <= 6; p++) if (!isPause(p) && !e.periods.has(p)) { under6++; break; }
  }
  check('Klassen ohne Hohlstunden (Pause 7. bzw. 5. bei Werkstatt)', errs, 8);
  info('Klassentage mit unvollständiger 1–6-Abdeckung', `${under6} (datenabhängig – zu wenige Karten am Tag)`);
}

// 15) Prüfbericht der App selbst. Schüler-Hohlstunden/Werkstatt<4h sind dort
//     bewusst FEHLER (Anwender-Sicht) – hier zählen sie über die eigenen Checks,
//     im Integritäts-Check geht es um Kollisionen/Sperrzeiten/Datenfehler.
{
  const issues = st.validatePlan();
  const quality = (t) => /Schüler-Hohlstunde|Werkstatt braucht mindestens 4|4-wöchig allein/.test(t);
  const errs = issues.filter((i) => i.severity === 'error' && !quality(i.text));
  check('App-Prüfbericht: 0 Integritäts-Fehler', errs.map((e) => e.text));
  info('App-Prüfbericht Qualitäts-Fehler (Hohlstunden/Werkstatt)', String(issues.filter((i) => i.severity === 'error' && quality(i.text)).length));
  info('App-Prüfbericht Warnungen', String(issues.filter((i) => i.severity === 'warn').length));
}

// 16) Übersicht offen/Pflicht
{
  info('u/g-Differenz > Limit', `${st.teacherWeekImbalance().length} Lehrkräfte (strukturell)`);
  info('Pflichtstunden (1–6) offen', String(res.openMandatory));
  if (res.skipped.length) {
    const byReason = new Map();
    for (const s of res.skipped) (byReason.get(s.reason) ?? byReason.set(s.reason, []).get(s.reason)).push(s.card);
    console.log('  info  Offene Karten nach Grund:');
    for (const [r, cards] of [...byReason].sort((a, b) => b[1].length - a[1].length))
      console.log(`        (${cards.length}) ${r}: ${cards.slice(0, 8).join(', ')}${cards.length > 8 ? ' …' : ''}`);
  }
}

console.log(fails ? `\n❌ ${fails} Regel(n) VERLETZT` : '\n✅ Alle Regeln erfüllt');
process.exit(fails ? 1 : 0);
