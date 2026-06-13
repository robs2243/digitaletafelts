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
  | { type: 'teacher'; conflict: Placement };

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
   * Liefert null (frei) oder die erste gefundene Kollision.
   * Lehrer-Kollisionen gelten nur innerhalb desselben Wochentyps.
   * Karten in disjunkten Halbjahren (1. vs. 2.) überschneiden sich zeitlich
   * nicht und kollidieren daher nie – sie dürfen frei nebeneinander liegen.
   */
  checkSlot(card: CardProps, pos: PlacementPosition, excludeId?: string): Collision | null {
    for (let i = 0; i < card.duration; i++) {
      const period = pos.startPeriod + i;
      if (period > PERIODS) return { type: 'overflow', period };

      for (const pl of this.placements) {
        if (pl.id === excludeId) continue;
        if (pl.day !== pos.day || pl.week !== pos.week) continue;
        if (!pl.covers(period)) continue;
        if (!sharesSemester(card, pl)) continue;

        if (pl.classIdx === pos.classIdx) return { type: 'class', conflict: pl };
        if (pl.abbr === card.abbr) return { type: 'teacher', conflict: pl };
      }
    }
    return null;
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
