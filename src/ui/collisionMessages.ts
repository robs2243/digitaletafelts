import { DAYS, PERIODS } from '../domain/constants';
import type { Collision } from '../domain/Schedule';
import type { PlacementPosition, Week } from '../domain/types';
import { esc } from '../utils/html';

/** Liefert den Anzeigenamen einer Spalte für (Tag, Woche). */
type LabelFor = (classIdx: number, day: number, week: Week) => string;

/** Meldung, wenn die Klassenbindung der Karte nicht zur Spalte passt. */
export function classMismatchMessage(klasse: string): string {
  return `<strong>Falsche Klasse:</strong><br>
    Diese Karte gehört zur Klasse <em>${esc(klasse)}</em> und kann nur in eine Spalte
    mit identischem Klassennamen (am jeweiligen Tag / in der jeweiligen Woche) gelegt werden.`;
}

/** Formatiert eine Kollision als deutsche HTML-Meldung für das Warn-Modal. */
export function collisionMessage(
  collision: Collision,
  pos: PlacementPosition,
  abbr: string,
  labelFor: LabelFor,
): string {
  switch (collision.type) {
    case 'overflow':
      return `Stunde ${collision.period} existiert nicht – maximal ${PERIODS} Stunden pro Tag.`;

    case 'class': {
      const pl = collision.conflict;
      const label = pl.fach ? `${esc(pl.abbr)} – ${esc(pl.fach)}` : esc(pl.abbr);
      const range = pl.duration > 1 ? `${pl.startPeriod}–${pl.endPeriod}` : `${pl.startPeriod}`;
      return `<strong>Klassen-Kollision:</strong><br>
        ${esc(labelFor(pos.classIdx, pos.day, pos.week))} (${pos.week.toUpperCase()}-Wochen) hat in
        Std.&nbsp;${range} bereits <em>${label}</em> eingetragen.`;
    }

    case 'teacher': {
      const pl = collision.conflict;
      const range = pl.duration > 1 ? `${pl.startPeriod}–${pl.endPeriod}` : `${pl.startPeriod}`;
      return `<strong>Lehrer-Kollision:</strong><br>
        <em>${esc(abbr)}</em> unterrichtet am ${DAYS[pos.day]}
        in Std.&nbsp;${range} (${pos.week.toUpperCase()}-Wochen) bereits in
        <em>${esc(labelFor(pl.classIdx, pl.day, pl.week))}</em> –
        ein Lehrer kann nicht gleichzeitig zwei Klassen unterrichten.`;
    }

    case 'room': {
      const pl = collision.conflict;
      const range = pl.duration > 1 ? `${pl.startPeriod}–${pl.endPeriod}` : `${pl.startPeriod}`;
      return `<strong>Raum-Kollision:</strong><br>
        Raum <em>${esc(pl.room)}</em> ist am ${DAYS[pos.day]} in Std.&nbsp;${range}
        (${pos.week.toUpperCase()}-Wochen) bereits in
        <em>${esc(labelFor(pl.classIdx, pl.day, pl.week))}</em> belegt –
        ein Raum kann nicht gleichzeitig doppelt belegt werden.`;
    }
  }
}
