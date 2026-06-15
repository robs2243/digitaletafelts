import type { CardProps, PersistedCard } from './types';

/**
 * Eine Karte im Lehrer-Pool: repräsentiert eine Lehrer/Fach-Einheit,
 * die in den Stundenplan gezogen werden kann.
 */
export class Card {
  readonly id: string;
  klasse: string;
  abbr: string;
  fach: string;
  name: string;
  room: string;
  duration: number;
  color: string;
  isLabor: boolean;
  labGroup: string;
  isWerkstatt: boolean;
  isVierwoechig: boolean;
  firstHalf: boolean;
  secondHalf: boolean;
  noCount: boolean;
  coupling: string;
  comment: string;

  constructor(id: string, props: CardProps) {
    this.id = id;
    this.klasse = props.klasse;
    this.abbr = props.abbr;
    this.fach = props.fach;
    this.name = props.name;
    this.room = props.room;
    this.duration = props.duration;
    this.color = props.color;
    this.isLabor = props.isLabor;
    this.labGroup = props.labGroup;
    this.isWerkstatt = props.isWerkstatt;
    this.isVierwoechig = props.isVierwoechig;
    this.firstHalf = props.firstHalf;
    this.secondHalf = props.secondHalf;
    this.noCount = props.noCount;
    this.coupling = props.coupling;
    this.comment = props.comment;
  }

  update(props: CardProps): void {
    this.klasse = props.klasse;
    this.abbr = props.abbr;
    this.fach = props.fach;
    this.name = props.name;
    this.room = props.room;
    this.duration = props.duration;
    this.color = props.color;
    this.isLabor = props.isLabor;
    this.labGroup = props.labGroup;
    this.isWerkstatt = props.isWerkstatt;
    this.isVierwoechig = props.isVierwoechig;
    this.firstHalf = props.firstHalf;
    this.secondHalf = props.secondHalf;
    this.noCount = props.noCount;
    this.coupling = props.coupling;
    this.comment = props.comment;
  }

  /** Kopie der fachlichen Eigenschaften (ohne id). */
  snapshot(): CardProps {
    const { klasse, abbr, fach, name, room, duration, color, isLabor, labGroup, isWerkstatt, isVierwoechig, firstHalf, secondHalf, noCount, coupling, comment } = this;
    return { klasse, abbr, fach, name, room, duration, color, isLabor, labGroup, isWerkstatt, isVierwoechig, firstHalf, secondHalf, noCount, coupling, comment };
  }

  toJSON(): PersistedCard {
    return { id: this.id, ...this.snapshot() };
  }

  static fromJSON(raw: PersistedCard): Card {
    return new Card(raw.id, {
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
      comment: raw.comment ?? '',
    });
  }
}
