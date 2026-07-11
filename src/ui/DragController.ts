import type { CardProps } from '../domain/types';

export type DragSource = 'pool' | 'grid';

/** Momentaufnahme einer laufenden Drag-Operation. */
export interface DragData {
  source: DragSource;
  /** Karten-ID (Pool) bzw. Platzierungs-ID (Raster). */
  id: string;
  /** Kopie der Karten-Eigenschaften – bleibt auch nach Drag-Ende gültig. */
  card: CardProps;
  /** u+g-verschmolzenes Schild: `id` = u-Platzierung, `pairId` = g-Platzierung.
   *  Beide werden gemeinsam gezogen und auf denselben Slot (u UND g) gelegt. */
  pairId?: string;
  /** Karten-Eigenschaften der g-Platzierung (kann sich im Raum unterscheiden –
   *  Kollisionsprüfungen der g-Woche laufen damit statt mit `card`). */
  pairCard?: CardProps;
}

/** Hält den geteilten Drag-Zustand zwischen Pool und Stundenplan. */
export class DragController {
  private current: DragData | null = null;

  start(data: DragData): void {
    this.current = data;
  }

  end(): void {
    this.current = null;
  }

  get active(): DragData | null {
    return this.current;
  }
}
