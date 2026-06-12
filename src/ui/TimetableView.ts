import type { AppState } from '../domain/AppState';
import { DAYS, PERIODS, WEEKS } from '../domain/constants';
import type { Placement } from '../domain/Placement';
import type { PlacementPosition, Week } from '../domain/types';
import { ink } from '../utils/color';
import { esc } from '../utils/html';
import { DragController } from './DragController';

/** Gruppe sich überlappender Platzierungen in einer Klassen-/Wochenspalte. */
interface PlacementCluster {
  /** Erste Stunde des Clusters (Oberkante der Zelle). */
  start: number;
  /** Letzte Stunde des Clusters (auf PERIODS begrenzt). */
  end: number;
  cards: Placement[];
}

export interface TimetableHandlers {
  onDrop: (pos: PlacementPosition) => void;
  onDragEnd: () => void;
  onRemovePlacement: (placementId: string) => void;
  onRenameClass: (classIdx: number, name: string, commit: boolean) => void;
  onDeleteClass: (classIdx: number) => void;
  onAddClass: () => void;
}

/**
 * Das Stundenplan-Raster: Tage als Zeilenblöcke, Klassen als Spalten
 * (je u-/g-Woche). Rendert komplett neu; Events laufen über Delegation
 * auf dem Tabellen-Element und überleben so jedes Re-Rendern.
 */
export class TimetableView {
  private readonly el: HTMLTableElement;
  private readonly state: AppState;
  private readonly drag: DragController;
  private readonly handlers: TimetableHandlers;

  constructor(el: HTMLTableElement, state: AppState, drag: DragController, handlers: TimetableHandlers) {
    this.el = el;
    this.state = state;
    this.drag = drag;
    this.handlers = handlers;
    this.bindEvents();
  }

  // ── Events (Delegation) ─────────────────────────────────────────────────

  private bindEvents(): void {
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      const rmBtn = target.closest<HTMLElement>('.p-rm');
      if (rmBtn?.dataset.id) {
        e.stopPropagation();
        this.handlers.onRemovePlacement(rmBtn.dataset.id);
        return;
      }
      const delBtn = target.closest<HTMLElement>('.cls-del');
      if (delBtn?.dataset.c) {
        this.handlers.onDeleteClass(Number(delBtn.dataset.c));
        return;
      }
      if (target.closest('.btn-addcls-col')) this.handlers.onAddClass();
    });

    // Tippen: nur speichern (Fokus behalten); Verlassen des Felds: neu rendern
    this.el.addEventListener('input', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.cls-inp');
      if (inp?.dataset.c) this.handlers.onRenameClass(Number(inp.dataset.c), inp.value, false);
    });
    this.el.addEventListener('change', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.cls-inp');
      if (inp?.dataset.c) this.handlers.onRenameClass(Number(inp.dataset.c), inp.value, true);
    });

    this.el.addEventListener('dragstart', (e) => {
      const plEl = (e.target as HTMLElement).closest<HTMLElement>('.placed, .placed-mini');
      const id = plEl?.dataset.id;
      if (!plEl || !id) return;
      const placement = this.state.schedule.findById(id);
      if (!placement) return;
      this.drag.start({ source: 'grid', id, card: placement.cardSnapshot() });
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => plEl.classList.add('moving'), 0);
    });

    this.el.addEventListener('dragend', () => {
      this.drag.end();
      this.handlers.onDragEnd();
    });

    this.el.addEventListener('dragover', (e) => {
      const cell = this.cellFromEvent(e);
      if (!cell) return;
      e.preventDefault();
      const dragData = this.drag.active;
      if (!dragData) return;
      const pos = this.posFromCell(cell);
      const excludeId = dragData.source === 'grid' ? dragData.id : undefined;
      const collision = this.state.schedule.checkSlot(dragData.card.abbr, pos, dragData.card.duration, excludeId);

      cell.classList.remove('dv', 'ds', 'di');
      if (!collision) {
        cell.classList.add('dv');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      } else if (collision.type === 'class') {
        // Grün bei Labor-Karte (stapelt automatisch), sonst orange.
        // dropEffect muss zu effectAllowed ('move') passen, sonst
        // blockiert der Browser den Drop (🚫-Cursor).
        cell.classList.add(dragData.card.isLabor ? 'dv' : 'ds');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      } else {
        cell.classList.add('di');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      }
    });

    this.el.addEventListener('dragleave', (e) => {
      this.cellFromEvent(e)?.classList.remove('dv', 'ds', 'di');
    });

    this.el.addEventListener('drop', (e) => {
      const cell = this.cellFromEvent(e);
      if (!cell) return;
      e.preventDefault();
      cell.classList.remove('dv', 'ds', 'di');
      this.handlers.onDrop(this.posFromCell(cell));
    });
  }

  private cellFromEvent(e: Event): HTMLTableCellElement | null {
    return (e.target as HTMLElement).closest<HTMLTableCellElement>('td.cell');
  }

  private posFromCell(cell: HTMLTableCellElement): PlacementPosition {
    return {
      day: Number(cell.dataset.d),
      startPeriod: Number(cell.dataset.p),
      classIdx: Number(cell.dataset.c),
      week: cell.dataset.w as Week,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  render(): void {
    const classes = this.state.classes.all;
    let h = this.renderHead(classes);
    h += '<tbody>';
    for (let d = 0; d < DAYS.length; d++) {
      h += this.renderDay(d, classes);
      if (d < DAYS.length - 1) {
        h += `<tr class="day-sep"><td colspan="${2 + classes.length * 2 + 1}"></td></tr>`;
      }
    }
    h += '</tbody>';
    this.el.innerHTML = h;
  }

  private renderHead(classes: readonly string[]): string {
    let h = '<thead><tr>';
    h += '<th class="th-stub" rowspan="2"></th>';
    h += '<th class="th-per" rowspan="2"></th>';
    classes.forEach((name, c) => {
      h += `<th class="th-cls" colspan="2">
              <div class="cls-cell">
                <input class="cls-inp" value="${esc(name)}" data-c="${c}" title="Klicken zum Umbenennen">
                <button class="cls-del" data-c="${c}" title="Klasse löschen">×</button>
              </div>
            </th>`;
    });
    h += `<th class="th-addcls" rowspan="2">
            <button class="btn-addcls-col" title="Klasse hinzufügen">+</button>
          </th>`;
    h += '</tr><tr>';
    classes.forEach(() => {
      h += '<th class="th-wk u">u</th><th class="th-wk g">g</th>';
    });
    h += '</tr></thead>';
    return h;
  }

  private renderDay(day: number, classes: readonly string[]): string {
    const clusterAt = this.buildClusters(day);
    /** Zellen, die durch ein rowspan darüber bereits abgedeckt sind. */
    const blocked = new Set<string>();

    // Tages-Zwischenkopf mit wiederholten Klassennamen
    let h = '<tr class="day-hdr-row">';
    h += `<td class="dh-day" colspan="2">${DAYS[day]}</td>`;
    for (const name of classes) h += `<td class="dh-cls" colspan="2">${esc(name)}</td>`;
    h += '<td class="dh-add"></td></tr>';

    for (let p = 1; p <= PERIODS; p++) {
      h += '<tr>';
      h += '<td class="td-per-stub"></td>';
      h += `<td class="td-per">${p}</td>`;

      for (let c = 0; c < classes.length; c++) {
        for (const w of WEEKS) {
          const key = `${p}_${c}_${w}`;
          if (blocked.has(key)) continue;

          const cluster = clusterAt.get(key);
          let rowspan = 1;
          if (cluster) {
            rowspan = cluster.end - cluster.start + 1;
            for (let i = 1; i < rowspan; i++) blocked.add(`${p + i}_${c}_${w}`);
          }

          const weekClass = w === 'u' ? 'cu' : 'cg';
          h += `<td class="cell ${weekClass}" data-d="${day}" data-p="${p}" data-c="${c}" data-w="${w}"${
            rowspan > 1 ? ` rowspan="${rowspan}"` : ''
          }>`;
          if (cluster) {
            h += cluster.cards.length === 1 ? this.renderSingle(cluster.cards[0]) : this.renderStack(cluster);
          }
          h += '</td>';
        }
      }
      h += '<td class="td-add-empty"></td></tr>';
    }
    return h;
  }

  /**
   * Gruppiert die Platzierungen eines Tages je Klassen-/Wochenspalte zu
   * Clustern aus sich (transitiv) überlappenden Blöcken. Auch versetzt
   * startende parallele Blöcke landen so im selben Cluster und bleiben
   * sichtbar. Schlüssel: `start_classIdx_week` der Cluster-Oberkante.
   */
  private buildClusters(day: number): Map<string, PlacementCluster> {
    const byColumn = new Map<string, Placement[]>();
    for (const pl of this.state.schedule.forDay(day)) {
      const key = `${pl.classIdx}_${pl.week}`;
      const list = byColumn.get(key) ?? [];
      list.push(pl);
      byColumn.set(key, list);
    }

    const clusterAt = new Map<string, PlacementCluster>();
    for (const [colKey, list] of byColumn) {
      list.sort((a, b) => a.startPeriod - b.startPeriod);
      let current: PlacementCluster | null = null;
      for (const pl of list) {
        const end = Math.min(pl.endPeriod, PERIODS);
        if (current && pl.startPeriod <= current.end) {
          current.cards.push(pl);
          current.end = Math.max(current.end, end);
        } else {
          current = { start: pl.startPeriod, end, cards: [pl] };
          clusterAt.set(`${pl.startPeriod}_${colKey}`, current);
        }
      }
    }
    return clusterAt;
  }

  private renderSingle(pl: Placement): string {
    const fg = ink(pl.color);
    return `<div class="placed${pl.isLabor ? ' labor-card' : ''}" data-id="${pl.id}"
              style="background:${pl.color};color:${fg}" draggable="true">
        <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
        <div class="p-abbr">${esc(pl.abbr)}</div>
        ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
        ${pl.name && !pl.fach ? `<div class="p-name">${esc(pl.name)}</div>` : ''}
        ${pl.duration > 1 ? `<div class="p-range">Std.${pl.startPeriod}–${pl.endPeriod}</div>` : ''}
        ${pl.isLabor ? '<div class="p-range">⚗ Labor</div>' : ''}
      </div>`;
  }

  /**
   * Parallele Blöcke teilen die Zelle nebeneinander auf; jeder Block sitzt
   * innerhalb seiner Spalte vertikal dort, wo seine Stunden liegen
   * (relevant bei versetzt startenden Blöcken im selben Cluster).
   */
  private renderStack(cluster: PlacementCluster): string {
    const span = cluster.end - cluster.start + 1;
    let h = '<div class="stack-wrap">';
    for (const pl of cluster.cards) {
      const fg = ink(pl.color);
      const visibleEnd = Math.min(pl.endPeriod, cluster.end);
      const top = ((pl.startPeriod - cluster.start) / span) * 100;
      const height = ((visibleEnd - pl.startPeriod + 1) / span) * 100;
      h += `<div class="stack-col">
          <div class="placed-mini${pl.isLabor ? ' labor-card' : ''}" data-id="${pl.id}"
               style="background:${pl.color};color:${fg};top:${top}%;height:${height}%" draggable="true">
            <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
            <div class="p-abbr">${esc(pl.abbr)}</div>
            ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
            ${pl.duration > 1 ? `<div class="p-range">Std.${pl.startPeriod}–${pl.endPeriod}</div>` : ''}
          </div>
        </div>`;
    }
    h += '</div>';
    if (cluster.cards.every((x) => x.isLabor)) h += '<div class="stack-labor">⚗</div>';
    return h;
  }
}
