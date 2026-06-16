import { PERIODS } from './constants';
import { Placement } from './Placement';
import { sharesSemester } from './semester';
import type { CardProps, PlacementPosition } from './types';

/** Ergebnis der Kollisionsprüfung – strukturiert, die UI formatiert die Meldung. */
export type Collision =
  /** Karte ragt über die letzte Stunde des Tages hinaus. */
  | { type: 'overflow'; period: number }
  /** Slot der Klasse ist belegt – Stapeln möglich. */
  | { type: 'class'; conflict: Placement }
  /** Lehrer unterrichtet zeitgleich in einer anderen Klasse – harte Sperre. */
  | { type: 'teacher'; conflict: Placement }
  /** Raum ist zeitgleich in einer anderen Klasse belegt – harte Sperre. */
  | { type: 'room'; conflict: Placement };

/** Der Stundenplan: verwaltet alle Platzierungen und prüft Kollisionen. */
export class Schedule {
  private placements: Placement[] = [];

  get all(): readonly Placement[] {
    return this.placements;
  }

  add(placement: Placement): void {
    this.placements.push(placement);
  }

  findById(id: string): Placement | undefined {
    return this.placements.find((p) => p.id === id);
  }

  /** Entfernt die Platzierung und gibt sie zurück. */
  remove(id: string): Placement | undefined {
    const placement = this.findById(id);
    if (placement) this.placements = this.placements.filter((p) => p.id !== id);
    return placement;
  }

  forDay(day: number): Placement[] {
    return this.placements.filter((p) => p.day === day);
  }

  /**
   * Prüft, ob eine Karte an der Position platziert werden kann.
   * Liefert null (frei) oder die gefundene Kollision.
   *
   * Harte Sperren haben Vorrang vor der stapelbaren Klassen-Kollision und
   * werden über ALLE überlappenden Karten geprüft (auch bei Stapelung in
   * derselben Klasse):
   * - *Raum*: derselbe (gesetzte) Raum zeitgleich – zwei Gruppen können nicht
   *   im selben Raum sein, daher harte Sperre, egal ob gleiche oder andere Klasse.
   * - *Lehrer*: dasselbe Kürzel zeitgleich in einer anderen Klasse.
   * Kollisionen gelten nur im selben Wochentyp; disjunkte Halbjahre (1. vs. 2.)
   * überschneiden sich zeitlich nicht und kollidieren daher nie.
   */
  checkSlot(card: CardProps, pos: PlacementPosition, excludeId?: string): Collision | null {
    let classConflict: Placement | null = null;
    for (let i = 0; i < card.duration; i++) {
      const period = pos.startPeriod + i;
      if (period > PERIODS) return { type: 'overflow', period };

      for (const pl of this.placements) {
        if (pl.id === excludeId) continue;
        if (pl.day !== pos.day || pl.week !== pos.week) continue;
        if (!pl.covers(period)) continue;
        if (!sharesSemester(card, pl)) continue;
        // Gekoppelte Karten (gleiche Kopplungs-ID) dürfen sich überschneiden
        // (gleiche Lehrkraft, andere Klasse, ggf. gleicher Raum) – keine Kollision.
        if (card.coupling && pl.coupling === card.coupling) continue;
        // Teamteaching (gleiche Team-ID): mehrere Lehrkräfte gleichzeitig – keine Kollision.
        if (card.teamTeaching && pl.teamTeaching === card.teamTeaching) continue;

        // Harte Sperren zuerst – auch innerhalb derselben Klasse.
        if (card.room && pl.room === card.room) return { type: 'room', conflict: pl };
        if (pl.classIdx !== pos.classIdx && pl.abbr === card.abbr) return { type: 'teacher', conflict: pl };
        // Stapelbare Klassen-Kollision nur merken und weitersuchen,
        // damit eine harte Sperre an einer anderen Karte nicht übersehen wird.
        if (pl.classIdx === pos.classIdx && !classConflict) classConflict = pl;
      }
    }
    return classConflict ? { type: 'class', conflict: classConflict } : null;
  }

  /** Entfernt alle Platzierungen einer Klasse und zieht höhere Indizes nach. */
  removeClass(classIdx: number): void {
    this.placements = this.placements.filter((p) => p.classIdx !== classIdx);
    for (const p of this.placements) {
      if (p.classIdx > classIdx) p.classIdx -= 1;
    }
  }

  /** Summe der verplanten Stunden je Kürzel. */
  hoursByAbbr(): Map<string, number> {
    const map = new Map<string, number>();
    for (const p of this.placements) {
      map.set(p.abbr, (map.get(p.abbr) ?? 0) + p.duration);
    }
    return map;
  }

  replaceAll(placements: Placement[]): void {
    this.placements = placements;
  }
}
