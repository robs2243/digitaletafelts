import type { CardProps, PersistedCard } from './types';

/**
 * Eine Karte im Lehrer-Pool: repräsentiert eine Lehrer/Fach-Einheit,
 * die in den Stundenplan gezogen werden kann.
 */
export class Card {
  readonly id: string;
  abbr: string;
  fach: string;
  name: string;
  duration: number;
  color: string;
  isLabor: boolean;

  constructor(id: string, props: CardProps) {
    this.id = id;
    this.abbr = props.abbr;
    this.fach = props.fach;
    this.name = props.name;
    this.duration = props.duration;
    this.color = props.color;
    this.isLabor = props.isLabor;
  }

  update(props: CardProps): void {
    this.abbr = props.abbr;
    this.fach = props.fach;
    this.name = props.name;
    this.duration = props.duration;
    this.color = props.color;
    this.isLabor = props.isLabor;
  }

  /** Kopie der fachlichen Eigenschaften (ohne id). */
  snapshot(): CardProps {
    const { abbr, fach, name, duration, color, isLabor } = this;
    return { abbr, fach, name, duration, color, isLabor };
  }

  toJSON(): PersistedCard {
    return { id: this.id, ...this.snapshot() };
  }

  static fromJSON(raw: PersistedCard): Card {
    return new Card(raw.id, {
      abbr: raw.abbr ?? '',
      fach: raw.fach ?? '',
      name: raw.name ?? '',
      duration: raw.duration ?? 1,
      color: raw.color ?? '#3f51b5',
      isLabor: !!raw.isLabor,
    });
  }
}
