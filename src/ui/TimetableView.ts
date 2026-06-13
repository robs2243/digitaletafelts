import type { AppState } from '../domain/AppState';
import { DAYS, PERIODS, WEEKS } from '../domain/constants';
import type { Placement } from '../domain/Placement';
import { coversFirstHalf, coversSecondHalf, semesterLabel } from '../domain/semester';
import type { LabelField, PlacementPosition, Week } from '../domain/types';
import { ink } from '../utils/color';
import { esc } from '../utils/html';
import { ColorPopover } from './ColorPopover';
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
  onCommentPlacement: (placementId: string) => void;
  onToggleLock: (placementId: string) => void;
  /** Aufruf, wenn eine fixierte Karte verschoben/entfernt werden sollte. */
  onLockedBlocked: () => void;
  /** Setzt den Text; Rückgabe = automatisch übernommene Feldfarbe (oder null). */
  onSetClassLabel: (classIdx: number, day: number, field: LabelField, value: string) => string | null;
  onSetLabelColor: (classIdx: number, day: number, field: LabelField, color: string) => void;
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

  /** Anzeigefilter je Halbjahr (rein visuell; Daten/Kollision unberührt). */
  private filterFirst = true;
  private filterSecond = true;
  private readonly colorPopover = new ColorPopover();

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

      const lockBtn = target.closest<HTMLElement>('.p-lock');
      if (lockBtn?.dataset.id) {
        e.stopPropagation();
        this.handlers.onToggleLock(lockBtn.dataset.id);
        return;
      }
      const rmBtn = target.closest<HTMLElement>('.p-rm');
      if (rmBtn?.dataset.id) {
        e.stopPropagation();
        if (this.state.schedule.findById(rmBtn.dataset.id)?.locked) {
          this.handlers.onLockedBlocked();
          return;
        }
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

    this.el.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;

      // Doppelklick auf ein Beschriftungsfeld: Farb-Auswahl öffnen.
      const inp = target.closest<HTMLInputElement>('.dh-inp');
      if (inp?.dataset.c && inp.dataset.d && inp.dataset.f) {
        e.preventDefault();
        const c = Number(inp.dataset.c);
        const d = Number(inp.dataset.d);
        const field = inp.dataset.f as LabelField;
        const current = this.state.classes.color(c, d, field);
        this.colorPopover.open(inp, current, (color) => this.handlers.onSetLabelColor(c, d, field, color));
        return;
      }

      if (target.closest('.p-rm') || target.closest('.p-lock')) return;
      const plEl = target.closest<HTMLElement>('.placed, .placed-mini');
      if (plEl?.dataset.id) this.handlers.onCommentPlacement(plEl.dataset.id);
    });

    // Tagesbeschriftung tippen: nur speichern, nicht neu rendern (Fokus behalten)
    this.el.addEventListener('input', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.dh-inp');
      if (!inp?.dataset.c || !inp.dataset.d || !inp.dataset.f) return;
      const c = Number(inp.dataset.c);
      const d = Number(inp.dataset.d);
      const color = this.handlers.onSetClassLabel(c, d, inp.dataset.f as LabelField, inp.value);
      // Automatisch übernommene Farbe sofort anzeigen (ohne Re-Render) – außer Zeile 1 ist „muted“.
      if (color && !inp.classList.contains('dh-comb-muted')) {
        inp.style.background = color;
        inp.style.color = ink(color);
      }
      this.refreshCombinedMuted(c, d, inp);
    });

    this.el.addEventListener('dragstart', (e) => {
      const plEl = (e.target as HTMLElement).closest<HTMLElement>('.placed, .placed-mini');
      const id = plEl?.dataset.id;
      if (!plEl || !id) return;
      const placement = this.state.schedule.findById(id);
      if (!placement) return;
      if (placement.locked) {
        e.preventDefault();
        this.handlers.onLockedBlocked();
        return;
      }
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
      const collision = this.state.schedule.checkSlot(dragData.card, pos, excludeId);

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

  /**
   * Setzt den Halbjahr-Anzeigefilter. Wirkt erst beim nächsten render().
   * Eine Platzierung ist sichtbar, wenn sie zu einem aktiven Halbjahr gehört.
   */
  setSemesterFilter(showFirst: boolean, showSecond: boolean): void {
    this.filterFirst = showFirst;
    this.filterSecond = showSecond;
  }

  private passesFilter(pl: Placement): boolean {
    return (this.filterFirst && coversFirstHalf(pl)) || (this.filterSecond && coversSecondHalf(pl));
  }

  render(): void {
    const count = this.state.classes.count;
    let h = this.renderHead(count);
    h += '<tbody>';
    for (let d = 0; d < DAYS.length; d++) {
      h += this.renderDay(d, count);
      if (d < DAYS.length - 1) {
        h += `<tr class="day-sep"><td colspan="${2 + count * 2 + 1}"></td></tr>`;
      }
    }
    h += '</tbody>';
    this.el.innerHTML = h;
  }

  private renderHead(count: number): string {
    let h = '<thead><tr>';
    h += '<th class="th-stub" rowspan="2"></th>';
    h += '<th class="th-per" rowspan="2"></th>';
    for (let c = 0; c < count; c++) {
      h += `<th class="th-cls" colspan="2">
              <div class="cls-cell">
                <span class="cls-num">${c + 1}</span>
                <button class="cls-del" data-c="${c}" title="Spalte löschen">×</button>
              </div>
            </th>`;
    }
    h += `<th class="th-addcls" rowspan="2">
            <button class="btn-addcls-col" title="Spalte hinzufügen">+</button>
          </th>`;
    h += '</tr><tr>';
    for (let c = 0; c < count; c++) {
      h += '<th class="th-wk u">u</th><th class="th-wk g">g</th>';
    }
    h += '</tr></thead>';
    return h;
  }

  /** Beschriftungsblock einer Spalte für einen Wochentag (Zeile 1: u+g, Zeile 2: u | g). */
  private renderDayLabel(c: number, day: number): string {
    const comb = this.state.classes.label(c, day, 'combined');
    const u = this.state.classes.label(c, day, 'u');
    const g = this.state.classes.label(c, day, 'g');
    const ugUsed = !!(u.trim() || g.trim());

    const styleFor = (color: string): string =>
      color ? ` style="background:${color};color:${ink(color)}"` : '';
    // Zeile 1 wird zurückgenommen, wenn u/g belegt sind – dann auch ohne eigene Farbe.
    const combCls = 'dh-inp dh-comb' + (ugUsed ? ' dh-comb-muted' : '');
    const combStyle = ugUsed ? '' : styleFor(this.state.classes.color(c, day, 'combined'));

    return `<td class="dh-cls" colspan="2">
        <div class="dh-labels">
          <input class="${combCls}" data-c="${c}" data-d="${day}" data-f="combined"
                 value="${esc(comb)}" placeholder="u + g" title="Name für u- und g-Woche gemeinsam – Doppelklick: Farbe"${combStyle}>
          <div class="dh-ug">
            <input class="dh-inp dh-u" data-c="${c}" data-d="${day}" data-f="u"
                   value="${esc(u)}" placeholder="u" title="Nur ungerade Woche – Doppelklick: Farbe"${styleFor(this.state.classes.color(c, day, 'u'))}>
            <input class="dh-inp dh-g" data-c="${c}" data-d="${day}" data-f="g"
                   value="${esc(g)}" placeholder="g" title="Nur gerade Woche – Doppelklick: Farbe"${styleFor(this.state.classes.color(c, day, 'g'))}>
          </div>
        </div>
      </td>`;
  }

  /**
   * Schaltet Zeile 1 (u+g) je nach Belegung von u/g live „muted“ – ohne
   * Re-Render, damit der Fokus beim Tippen erhalten bleibt.
   */
  private refreshCombinedMuted(c: number, day: number, within: HTMLElement): void {
    const labels = within.closest('.dh-labels');
    const comb = labels?.querySelector<HTMLInputElement>('.dh-comb');
    const u = labels?.querySelector<HTMLInputElement>('.dh-u');
    const g = labels?.querySelector<HTMLInputElement>('.dh-g');
    if (!comb || !u || !g) return;
    const muted = !!(u.value.trim() || g.value.trim());
    comb.classList.toggle('dh-comb-muted', muted);
    if (muted) {
      comb.style.background = '';
      comb.style.color = '';
    } else {
      const cc = this.state.classes.color(c, day, 'combined');
      comb.style.background = cc || '';
      comb.style.color = cc ? ink(cc) : '';
    }
  }

  private renderDay(day: number, count: number): string {
    const clusterAt = this.buildClusters(day);
    /** Zellen, die durch ein rowspan darüber bereits abgedeckt sind. */
    const blocked = new Set<string>();

    // Tageskopf: senkrechter Wochentag in Spalte 1 (über Kopf + alle Stunden),
    // dann Stunden-Kopfzelle und die Klassen-Beschriftungen (u+g / u | g).
    let h = '<tr class="day-hdr-row">';
    h += `<td class="dh-day-vert" rowspan="${PERIODS + 1}"><span>${DAYS[day]}</span></td>`;
    h += '<td class="dh-perhead"></td>';
    for (let c = 0; c < count; c++) h += this.renderDayLabel(c, day);
    h += '<td class="dh-add"></td></tr>';

    for (let p = 1; p <= PERIODS; p++) {
      h += '<tr>';
      // Spalte 1 ist durch das rowspan des Wochentags abgedeckt.
      h += `<td class="td-per">${p}</td>`;

      for (let c = 0; c < count; c++) {
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
      if (!this.passesFilter(pl)) continue;
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
    const half = semesterLabel(pl);
    return `<div class="placed${pl.isLabor ? ' labor-card' : ''}${pl.locked ? ' locked' : ''}" data-id="${pl.id}" data-abbr="${esc(pl.abbr)}"
              style="background:${pl.color};color:${fg}" draggable="true">
        <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
        <button class="p-lock" data-id="${pl.id}" title="${pl.locked ? 'Fixierung aufheben' : 'Karte fixieren'}">${pl.locked ? '🔒' : '🔓'}</button>
        <div class="p-abbr">${esc(pl.abbr)}</div>
        ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
        ${pl.name && !pl.fach ? `<div class="p-name">${esc(pl.name)}</div>` : ''}
        ${pl.room ? `<div class="p-range">📍 ${esc(pl.room)}</div>` : ''}
        ${pl.duration > 1 ? `<div class="p-range">Std.${pl.startPeriod}–${pl.endPeriod}</div>` : ''}
        ${half ? `<div class="p-range p-half">${half}</div>` : ''}
        ${pl.isLabor ? '<div class="p-range">⚗ Labor</div>' : ''}
        ${pl.comment ? `<span class="p-comment" title="${esc(pl.comment)}">💬</span>` : ''}
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
      const half = semesterLabel(pl);
      const visibleEnd = Math.min(pl.endPeriod, cluster.end);
      const top = ((pl.startPeriod - cluster.start) / span) * 100;
      const height = ((visibleEnd - pl.startPeriod + 1) / span) * 100;
      h += `<div class="stack-col">
          <div class="placed-mini${pl.isLabor ? ' labor-card' : ''}${pl.locked ? ' locked' : ''}" data-id="${pl.id}" data-abbr="${esc(pl.abbr)}"
               style="background:${pl.color};color:${fg};top:${top}%;height:${height}%" draggable="true">
            <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
            <button class="p-lock" data-id="${pl.id}" title="${pl.locked ? 'Fixierung aufheben' : 'Karte fixieren'}">${pl.locked ? '🔒' : '🔓'}</button>
            <div class="p-abbr">${esc(pl.abbr)}</div>
            ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
            ${pl.room ? `<div class="p-range">📍 ${esc(pl.room)}</div>` : ''}
            ${pl.duration > 1 ? `<div class="p-range">Std.${pl.startPeriod}–${pl.endPeriod}</div>` : ''}
            ${half ? `<div class="p-range p-half">${half}</div>` : ''}
            ${pl.comment ? `<span class="p-comment" title="${esc(pl.comment)}">💬</span>` : ''}
          </div>
        </div>`;
    }
    h += '</div>';
    if (cluster.cards.every((x) => x.isLabor)) h += '<div class="stack-labor">⚗</div>';
    return h;
  }
}
