/**
 * Headless-Test/Diagnose aus EXCEL-Karten (Vorlage-Format, ein Ordner mit .xlsx je Klasse).
 *
 *   bun scripts/plan-test-xlsx.mjs <ordner> [budgetSekunden]
 *
 * Liest alle .xlsx im Ordner (wie der Excel-Import im Programm), legt alle Karten in
 * einen Pool, verplant automatisch und gibt einen Bericht aus. HINWEIS: Klassen-Spalten
 * werden für ALLE Tage angelegt (volle Verfügbarkeit) – die echte Tages-Belegung je
 * Klasse (z. B. „Klasse X nur Montag") wird im Programm gesetzt und hier nicht abgebildet.
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import * as XLSX from 'xlsx';
import { parseCardRows } from '../src/services/cardImport.ts';
import { AppState } from '../src/domain/AppState.ts';
import { Card } from '../src/domain/Card.ts';

const dir = process.argv[2];
const budgetS = Number(process.argv[3] ?? 20);
if (!dir) {
  console.error('Aufruf: bun scripts/plan-test-xlsx.mjs <ordner> [budgetSekunden]');
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'));
const st = AppState.createDefault();
let nid = 1;
console.log('=== Geladene Dateien ===');
for (const f of files) {
  const wb = XLSX.readFile(nodePath.join(dir, f));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
  const cards = parseCardRows(rows);
  for (const c of cards) st.pool.add(new Card(String(nid++), c));
  console.log(`  ${f}: ${cards.length} Karten`);
}

const klassen = [...new Set(st.pool.all.map((c) => c.klasse).filter(Boolean))].sort();
console.log(`\nGesamt: ${st.pool.all.length} Karten · Klassen (${klassen.length}): ${klassen.join(', ')}`);

st.ensureClassColumns(klassen);
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
    console.log(`  (${cards.length}) ${r}\n      ${cards.join(', ')}`);
}

const issues = st.validatePlan();
const errs = issues.filter((i) => i.severity === 'error');
console.log(`\n--- Prüfbericht: ${errs.length} Fehler, ${issues.length - errs.length} Warnungen ---`);
for (const v of issues.slice(0, 40)) console.log(`  [${v.severity === 'error' ? 'FEHLER' : 'warn'}] ${v.text}`);
if (issues.length > 40) console.log(`  … (+${issues.length - 40} weitere)`);

console.log('\n--- Karten je Klasse (Pool/verplant/gesamt) ---');
for (const r of st.cardCountByClass())
  console.log(`  ${r.klasse.padEnd(10)} Pool ${String(r.pool).padStart(3)} · verplant ${String(r.placed).padStart(3)} · gesamt ${r.total}`);
