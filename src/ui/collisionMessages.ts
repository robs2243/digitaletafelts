import { DAYS, PERIODS } from '../domain/constants';
import type { Collision } from '../domain/Schedule';
import type { PlacementPosition } from '../domain/types';
import { esc } from '../utils/html';

/** Formatiert eine Kollision als deutsche HTML-Meldung für das Warn-Modal. */
export function collisionMessage(
  collision: Collision,
  pos: PlacementPosition,
  abbr: string,
  classNames: readonly string[],
): string {
  switch (collision.type) {
    case 'overflow':
      return `Stunde ${collision.period} existiert nicht – maximal ${PERIODS} Stunden pro Tag.`;

    case 'class': {
      const pl = collision.conflict;
      const label = pl.fach ? `${esc(pl.abbr)} – ${esc(pl.fach)}` : esc(pl.abbr);
      const range = pl.duration > 1 ? `${pl.startPeriod}–${pl.endPeriod}` : `${pl.startPeriod}`;
      return `<strong>Klassen-Kollision:</strong><br>
        ${esc(classNames[pos.classIdx])} (${pos.week.toUpperCase()}-Wochen) hat in
        Std.&nbsp;${range} bereits <em>${label}</em> eingetragen.`;
    }

    case 'teacher': {
      const pl = collision.conflict;
      const range = pl.duration > 1 ? `${pl.startPeriod}–${pl.endPeriod}` : `${pl.startPeriod}`;
      return `<strong>Lehrer-Kollision:</strong><br>
        <em>${esc(abbr)}</em> unterrichtet am ${DAYS[pos.day]}
        in Std.&nbsp;${range} (${pos.week.toUpperCase()}-Wochen) bereits in
        <em>${esc(classNames[pl.classIdx])}</em> –
        ein Lehrer kann nicht gleichzeitig zwei Klassen unterrichten.`;
    }
  }
}
