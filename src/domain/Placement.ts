import { isWerkstattRoom } from './Card';
import { blockedPeriods } from './periods';
import type { CardProps, PersistedPlacement, PlacementPosition, Week } from './types';

/**
 * Eine im Stundenplan platzierte Karte. Hält eine eigene Kopie der
 * Karten-Eigenschaften (die Pool-Karte wird beim Platzieren verbraucht)
 * plus die Position im Raster.
 */
export class Placement {
  readonly id: string;
  readonly klasse: string;
  readonly abbr: string;
  readonly fach: string;
  readonly name: string;
  readonly room: string;
  readonly duration: number;
  readonly color: string;
  readonly isLabor: boolean;
  readonly labGroup: string;
  readonly isWerkstatt: boolean;
  readonly isVierwoechig: boolean;
  readonly firstHalf: boolean;
  readonly secondHalf: boolean;
  readonly noCount: boolean;
  readonly coupling: string;
  readonly teamTeaching: string;
  readonly collision: boolean;
  readonly mainSubject: boolean;
  readonly schiene: boolean;
  /** Freitext-Kommentar; per Doppelklick auf die platzierte Karte änderbar. */
  comment: string;
  /** Gegen versehentliches Verschieben/Entfernen fixiert. */
  locked: boolean;

  readonly day: number;
  readonly startPeriod: number;
  readonly week: Week;
  /** Klassen-Index; wird beim Löschen einer Klasse nachgezogen. */
  classIdx: number;

  constructor(id: string, card: CardProps, pos: PlacementPosition, locked = false) {
    this.id = id;
    this.klasse = card.klasse;
    this.abbr = card.abbr;
    this.fach = card.fach;
    this.name = card.name;
    this.room = card.room;
    this.duration = card.duration;
    this.color = card.color;
    this.isLabor = card.isLabor;
    this.labGroup = card.labGroup;
    this.isWerkstatt = card.isWerkstatt || isWerkstattRoom(card.room);
    this.isVierwoechig = card.isVierwoechig;
    this.firstHalf = card.firstHalf;
    this.secondHalf = card.secondHalf;
    this.noCount = card.noCount;
    this.coupling = card.coupling;
    this.teamTeaching = card.teamTeaching;
    this.collision = card.collision;
    this.mainSubject = card.mainSubject;
    this.schiene = card.schiene;
    this.comment = card.comment;
    this.locked = locked;
    this.day = pos.day;
    this.startPeriod = pos.startPeriod;
    this.classIdx = pos.classIdx;
    this.week = pos.week;
  }

  /** Letzte belegte Stunde. */
  get endPeriod(): number {
    return this.startPeriod + this.duration - 1;
  }

  /** Wochen, in denen die Platzierung liegt (genau die eine Woche). */
  get weeks(): Week[] {
    return [this.week];
  }

  /** Liegt die Platzierung in dieser Woche? */
  occupiesWeek(w: Week): boolean {
    return this.week === w;
  }

  /** Belegt diese Platzierung die angegebene Stunde? */
  covers(period: number): boolean {
    return period >= this.startPeriod && period <= this.endPeriod;
  }

  /**
   * Tatsächlich belegte Stunden. Normale Karten: lückenlos start…end.
   * Werkstatt: die Pause in der 5. Stunde wird übersprungen (der Block reicht
   * dadurch eine Stunde weiter), bleibt aber raumbelegt. `endPeriod`/`covers`
   * sind hier ungenau – für Belegungsprüfungen diese Methode verwenden.
   */
  occupiedPeriods(): number[] {
    return blockedPeriods(this.isWerkstatt, this.startPeriod, this.duration);
  }

  /** Kopie der Karten-Eigenschaften (z. B. für Rückgabe in den Pool). */
  cardSnapshot(): CardProps {
    const { klasse, abbr, fach, name, room, duration, color, isLabor, labGroup, isWerkstatt, isVierwoechig, firstHalf, secondHalf, noCount, coupling, teamTeaching, collision, mainSubject, schiene, comment } = this;
    return { klasse, abbr, fach, name, room, duration, color, isLabor, labGroup, isWerkstatt, isVierwoechig, firstHalf, secondHalf, noCount, coupling, teamTeaching, collision, mainSubject, schiene, comment };
  }

  toJSON(): PersistedPlacement {
    return {
      id: this.id,
      ...this.cardSnapshot(),
      day: this.day,
      startPeriod: this.startPeriod,
      classIdx: this.classIdx,
      week: this.week,
      locked: this.locked,
    };
  }

  static fromJSON(raw: PersistedPlacement): Placement {
    return new Placement(
      raw.id,
      {
        klasse: raw.klasse ?? '',
        abbr: raw.abbr ?? '',
        fach: raw.fach ?? '',
        name: raw.name ?? '',
        room: raw.room ?? '',
        duration: raw.duration ?? 1,
        color: raw.color ?? '#3f51b5',
        isLabor: !!raw.isLabor,
        labGroup: raw.labGroup ?? '',
        isWerkstatt: !!raw.isWerkstatt,
        isVierwoechig: !!raw.isVierwoechig,
        firstHalf: !!raw.firstHalf,
        secondHalf: !!raw.secondHalf,
        noCount: !!raw.noCount,
        coupling: raw.coupling ?? '',
        teamTeaching: raw.teamTeaching ?? '',
        collision: !!raw.collision,
        mainSubject: !!raw.mainSubject,
        schiene: !!raw.schiene,
        comment: raw.comment ?? '',
      },
      {
        day: raw.day,
        startPeriod: raw.startPeriod,
        classIdx: raw.classIdx,
        week: raw.week,
      },
      !!raw.locked,
    );
  }
}
