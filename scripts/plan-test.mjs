/**
 * Headless-Test/Diagnose des Planers.
 *
 *   bun scripts/plan-test.mjs <pfad-zur-stundenplan.json> [budgetSekunden]
 *
 * Lädt eine im Programm gespeicherte Stundenplan-JSON (Datei → Speichern unter),
 * verplant alle nicht fixierten Karten automatisch und gibt einen Bericht aus:
 * verplant/offen (mit Gründen), Prüfbericht, Karten je Klasse, u/g & Hohlstunden.
 */
import * as fs from 'node:fs';
import { AppState } from '../src/domain/AppState.ts';

const path = process.argv[2];
const budgetS = Number(process.argv[3] ?? 15);
if (!path) {
  console.error('Aufruf: bun scripts/plan-test.mjs <stundenplan.json> [budgetSekunden]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const st = AppState.fromJSON(raw);

console.log('=== Ausgangslage ===');
console.log(`Pool (frei): ${st.pool.all.length} | verplant: ${st.schedule.all.length} | Klassen-Spalten: ${st.classes.count}`);

// Fehlende Klassen-Spalten anlegen (wie im Programm beim Verplanen).
st.ensureClassColumns([...new Set(st.pool.all.map((c) => c.klasse))]);

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
if (issues.length) {
  console.log('\n--- Prüfbericht ---');
  for (const v of issues) console.log(`  [${v.severity === 'error' ? 'FEHLER' : 'warn'}] ${v.text}`);
}

console.log('\n--- Karten je Klasse (Pool/verplant/gesamt) ---');
for (const r of st.cardCountByClass())
  console.log(`  ${r.klasse.padEnd(9)} Pool ${String(r.pool).padStart(3)} · verplant ${String(r.placed).padStart(3)} · gesamt ${r.total}`);
