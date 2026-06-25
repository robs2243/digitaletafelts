/**
 * Realistischer Headless-Test: Klassen-Tage-Struktur aus einer gespeicherten JSON
 * (welche Klasse an welchem Tag/Woche da ist) + Karten aus den Excel-Dateien.
 *
 *   bun scripts/plan-test-combined.mjs <layout.json> <excel-ordner> [budgetSekunden]
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import * as XLSX from 'xlsx';
import { parseCardRows } from '../src/services/cardImport.ts';
import { AppState } from '../src/domain/AppState.ts';
import { Card } from '../src/domain/Card.ts';
import { DAYS, WEEKS } from '../src/domain/constants.ts';

const [layoutPath, dir, budgetArg] = process.argv.slice(2);
const budgetS = Number(budgetArg ?? 30);
if (!layoutPath || !dir) {
  console.error('Aufruf: bun scripts/plan-test-combined.mjs <layout.json> <excel-ordner> [budgetSekunden]');
  process.exit(1);
}

const st = AppState.fromJSON(JSON.parse(fs.readFileSync(layoutPath, 'utf8')));

// Vorhandene Klassen-Spalten je (Klasse → an welchen Tagen/Wochen da).
const present = new Map();
for (let c = 0; c < st.classes.count; c++)
  for (let d = 0; d < DAYS.length; d++)
    for (const w of WEEKS) {
      const n = st.classes.classNameAt(c, d, w).trim();
      if (n) (present.get(n) ?? present.set(n, new Set()).get(n)).add(`${DAYS[d].slice(0, 2)}-${w}`);
    }

let nid = 1;
for (const f of fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
  const wb = XLSX.readFile(nodePath.join(dir, f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
  for (const c of parseCardRows(rows)) st.pool.add(new Card(String(nid++), c));
}

// Karten-Klassen, die in der Layout-Struktur NICHT vorkommen (würden Spalten ergänzt bekommen).
const cardClasses = [...new Set(st.pool.all.map((c) => c.klasse.trim()).filter(Boolean))].sort();
const missing = cardClasses.filter((k) => !present.has(k));
console.log(`Karten: ${st.pool.all.length} · Karten-Klassen: ${cardClasses.length} · Layout-Klassen: ${present.size}`);
if (missing.length) console.log(`\n⚠️ Karten-Klassen OHNE Spalte im Layout (bekommen volle Woche): ${missing.join(', ')}`);

st.ensureClassColumns(cardClasses);
const t0 = Date.now();
const res = await st.planBest({ budgetMs: budgetS * 1000, shouldStop: () => 'continue', onProgress: () => {} });
const total = res.placed + res.skipped.length;
console.log(`\n=== Planung (${Math.round((Date.now() - t0) / 1000)}s, ${res.attempts.toLocaleString('de-DE')} Versuche) ===`);
console.log(`Verplant: ${res.placed}/${total} | offen: ${res.skipped.length} | Pflichtstunden offen: ${res.openMandatory} | solved: ${res.solved}`);

if (res.skipped.length) {
  const byReason = new Map();
  for (const s of res.skipped) (byReason.get(s.reason) ?? byReason.set(s.reason, []).get(s.reason)).push(s.card);
  console.log('\n--- Nicht verplant (nach Grund) ---');
  for (const [r, cards] of [...byReason].sort((a, b) => b[1].length - a[1].length))
    console.log(`  (${cards.length}) ${r}\n      ${cards.slice(0, 25).join(', ')}${cards.length > 25 ? ' …' : ''}`);
}

const issues = st.validatePlan();
const errs = issues.filter((i) => i.severity === 'error');
console.log(`\n--- Prüfbericht: ${errs.length} Fehler, ${issues.length - errs.length} Warnungen ---`);
for (const v of errs.slice(0, 25)) console.log(`  [FEHLER] ${v.text}`);
const imbal = st.teacherWeekImbalance();
if (imbal.length) console.log(`\nu/g-Differenz > 2 bei ${imbal.length} Lehrkräften: ${imbal.slice(0, 12).map((t) => `${t.abbr}(${Math.abs(t.u - t.g)})`).join(', ')}${imbal.length > 12 ? ' …' : ''}`);
