import type { CardProps } from './types';

/** Nur die Halbjahr-Flags – genügt für die Überschneidungsprüfung. */
export type SemesterFlags = Pick<CardProps, 'firstHalf' | 'secondHalf'>;

/** Deckt die Karte das 1. Halbjahr ab? Kein Häkchen = ganzes Jahr. */
export function coversFirstHalf(c: SemesterFlags): boolean {
  return c.firstHalf || !c.secondHalf;
}

/** Deckt die Karte das 2. Halbjahr ab? Kein Häkchen = ganzes Jahr. */
export function coversSecondHalf(c: SemesterFlags): boolean {
  return c.secondHalf || !c.firstHalf;
}

/**
 * Überschneiden sich zwei Karten zeitlich bzgl. Halbjahr? Karten in
 * disjunkten Halbjahren (1. vs. 2.) finden nie gleichzeitig statt und
 * kollidieren daher nicht – sie dürfen wie Labor-Karten nebeneinander liegen.
 */
export function sharesSemester(a: SemesterFlags, b: SemesterFlags): boolean {
  return (
    (coversFirstHalf(a) && coversFirstHalf(b)) ||
    (coversSecondHalf(a) && coversSecondHalf(b))
  );
}

/**
 * Gewichtung der Stunden: Karten für genau ein Halbjahr (nur 1. oder nur 2.)
 * zählen mit 0,5 (finden nur ein Halbjahr lang statt); ganzjährig = 1.
 */
export function semesterFactor(c: SemesterFlags): number {
  return c.firstHalf !== c.secondHalf ? 0.5 : 1;
}

/** Kurzlabel für die Karte: '1.HJ' / '2.HJ' / '' (ganzes Jahr). */
export function semesterLabel(c: SemesterFlags): string {
  const first = coversFirstHalf(c);
  const second = coversSecondHalf(c);
  if (first && !second) return '1.HJ';
  if (second && !first) return '2.HJ';
  return '';
}
