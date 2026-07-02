import { PERIODS } from './constants';

/**
 * Tatsächlich unterrichtete Stunden eines Blocks. Normale Karten: lückenlos
 * start…start+dur-1. Werkstatt: die Pause in der 5. Stunde wird übersprungen
 * (der Block reicht dadurch eine Stunde weiter). Bricht bei Stunde 9 ab –
 * passt der Block nicht mehr, ist das Ergebnis kürzer als `duration`.
 * AUSNAHME: Beginnt eine Werkstatt IN der 5. Stunde (Start = 5), gibt es keine
 * Pause davor – der Block läuft durch (pausenlose 4h-Werkstatt, z. B. AV1/AV2
 * auf 3.–6. = Karten mit Start 3 und Start 5).
 */
export function teachingPeriods(isWerkstatt: boolean, start: number, duration: number): number[] {
  if (!isWerkstatt || start === 5) {
    const a: number[] = [];
    for (let i = 0; i < duration; i++) a.push(start + i);
    return a;
  }
  const t: number[] = [];
  let p = start;
  while (t.length < duration && p <= PERIODS) {
    if (p !== 5) t.push(p);
    p++;
  }
  return t;
}

/**
 * Belegte Stunden inkl. Werkstatt-Pause (5.), wenn der Block sie umschließt –
 * der Raum/das Zeitfenster bleibt während der Pause belegt. Diese Funktion ist
 * die maßgebliche Quelle für Belegungs-/Kollisionsprüfungen (nicht `covers`,
 * das bei Werkstätten an der Pause ungenau ist).
 */
export function blockedPeriods(isWerkstatt: boolean, start: number, duration: number): number[] {
  const t = teachingPeriods(isWerkstatt, start, duration);
  // Start = 5 (pausenlos): Stunde 5 ist bereits unterrichtet, keine Pause zu belegen.
  if (isWerkstatt && t.length && start < 5 && t[t.length - 1] >= 5) return [...t, 5].sort((a, b) => a - b);
  return t;
}
