import type { CardProps, PersistedPlacement, PlacementPosition, Week } from './types';

/**
 * Eine im Stundenplan platzierte Karte. Hält eine eigene Kopie der
 * Karten-Eigenschaften (die Pool-Karte wird beim Platzieren verbraucht)
 * plus die Position im Raster.
 */
export class Placement {
  readonly id: string;
  readonly abbr: string;
  readonly fach: string;
  readonly name: string;
  readonly duration: number;
  readonly color: string;
  readonly isLabor: boolean;

  readonly day: number;
  readonly startPeriod: number;
  readonly week: Week;
  /** Klassen-Index; wird beim Löschen einer Klasse nachgezogen. */
  classIdx: number;

  constructor(id: string, card: CardProps, pos: PlacementPosition) {
    this.id = id;
    this.abbr = card.abbr;
    this.fach = card.fach;
    this.name = card.name;
    this.duration = card.duration;
    this.color = card.color;
    this.isLabor = card.isLabor;
    this.day = pos.day;
    this.startPeriod = pos.startPeriod;
    this.classIdx = pos.classIdx;
    this.week = pos.week;
  }

  /** Letzte belegte Stunde. */
  get endPeriod(): number {
    return this.startPeriod + this.duration - 1;
  }

  /** Belegt diese Platzierung die angegebene Stunde? */
  covers(period: number): boolean {
    return period >= this.startPeriod && period <= this.endPeriod;
  }

  /** Kopie der Karten-Eigenschaften (z. B. für Rückgabe in den Pool). */
  cardSnapshot(): CardProps {
    const { abbr, fach, name, duration, color, isLabor } = this;
    return { abbr, fach, name, duration, color, isLabor };
  }

  toJSON(): PersistedPlacement {
    return {
      id: this.id,
      ...this.cardSnapshot(),
      day: this.day,
      startPeriod: this.startPeriod,
      classIdx: this.classIdx,
      week: this.week,
    };
  }

  static fromJSON(raw: PersistedPlacement): Placement {
    return new Placement(
      raw.id,
      {
        abbr: raw.abbr ?? '',
        fach: raw.fach ?? '',
        name: raw.name ?? '',
        duration: raw.duration ?? 1,
        color: raw.color ?? '#3f51b5',
        isLabor: !!raw.isLabor,
      },
      {
        day: raw.day,
        startPeriod: raw.startPeriod,
        classIdx: raw.classIdx,
        week: raw.week,
      },
    );
  }
}
