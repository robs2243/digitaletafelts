import type { AppState } from '../domain/AppState';
import { DAYS, PERIODS, WEEKS } from '../domain/constants';
import type { Placement } from '../domain/Placement';
import { coversFirstHalf, coversSecondHalf, semesterLabel } from '../domain/semester';
import type { LabelField, PlacementPosition, Week } from '../domain/types';
import { ink } from '../utils/color';
import { esc } from '../utils/html';
import { ColorPopover } from './ColorPopover';
import { DragController, type DragData } from './DragController';

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
  /** `pairId`: zweite Platzierung eines u+g-verschmolzenen Schilds (wirkt mit). */
  onRemovePlacement: (placementId: string, pairId?: string) => void;
  onCommentPlacement: (placementId: string) => void;
  onToggleLock: (placementId: string, pairId?: string) => void;
  /** Aufruf, wenn eine fixierte Karte verschoben/entfernt werden sollte. */
  onLockedBlocked: () => void;
  /** Setzt den Text; Rückgabe = automatisch übernommene Feldfarbe (oder null). */
  onSetClassLabel: (classIdx: number, day: number, field: LabelField, value: string) => string | null;
  onSetLabelColor: (classIdx: number, day: number, field: LabelField, color: string) => void;
  onDeleteClass: (classIdx: number) => void;
  onAddClass: (focus: boolean) => void;
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
        // u+g-verschmolzenes Schild: Fixieren wirkt auf beide Platzierungen.
        this.handlers.onToggleLock(lockBtn.dataset.id, lockBtn.closest<HTMLElement>('.placed, .placed-mini')?.dataset.pair);
        return;
      }
      const rmBtn = target.closest<HTMLElement>('.p-rm');
      if (rmBtn?.dataset.id) {
        e.stopPropagation();
        if (this.state.schedule.findById(rmBtn.dataset.id)?.locked) {
          this.handlers.onLockedBlocked();
          return;
        }
        // u+g-verschmolzenes Schild: beide Platzierungen zurück in den Pool.
        this.handlers.onRemovePlacement(rmBtn.dataset.id, rmBtn.closest<HTMLElement>('.placed, .placed-mini')?.dataset.pair);
        return;
      }
      const delBtn = target.closest<HTMLElement>('.cls-del');
      if (delBtn?.dataset.c) {
        this.handlers.onDeleteClass(Number(delBtn.dataset.c));
        return;
      }
      if (target.closest('.btn-addcls-col')) this.handlers.onAddClass(true);
      // Links: ohne Fokus/Scroll – damit man bequem mehrere Spalten anlegen kann.
      else if (target.closest('.btn-addcls-left')) this.handlers.onAddClass(false);
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
      } else if (!inp.value.trim()) {
        // Feld geleert → auch die Farbe zurücksetzen (Standard-Look).
        inp.style.background = '';
        inp.style.color = '';
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
      const pair = plEl.dataset.pair ? this.state.schedule.findById(plEl.dataset.pair) : null;
      this.drag.start({
        source: 'grid',
        id,
        card: placement.cardSnapshot(),
        pairId: pair?.id,
        pairCard: pair?.cardSnapshot(),
      });
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => plEl.classList.add('moving'), 0);
    });

    this.el.addEventListener('dragend', () => {
      this.drag.end();
      this.handlers.onDragEnd();
    });

    // Live-Drop-Hilfe: beim Start eines Drags (Pool oder Raster) ALLE Zellen
    // einfärben – grün = frei, orange = stapelbar, rot = Sperrzeit, grau = belegt.
    // Quelle setzt drag.active im eigenen Handler; das Bubbling erreicht uns danach.
    document.addEventListener('dragstart', () => {
      if (this.drag.active) this.highlightDropTargets(this.drag.active);
    });
    document.addEventListener('dragend', () => this.clearDropTargets());

    this.el.addEventListener('dragover', (e) => {
      const cell = this.cellFromEvent(e);
      if (!cell) return;
      e.preventDefault();
      const dragData = this.drag.active;
      if (!dragData) return;
      const pos = this.posFromCell(cell);
      cell.classList.remove('dv', 'ds', 'di');

      // Klassenbindung: Karte darf nur in die passende Klassen-Spalte.
      if (!this.dragFitsColumn(dragData, pos)) {
        cell.classList.add('di');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        return;
      }

      const collision = this.dragCollision(dragData, pos);

      if (!collision) {
        cell.classList.add('dv');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      } else if (collision.type === 'class') {
        // Grün bei Labor-Karte (stapelt automatisch), sonst orange.
        // dropEffect muss zu effectAllowed ('move') passen, sonst
        // blockiert der Browser den Drop (🚫-Cursor).
        cell.classList.add(
          dragData.card.isLabor || dragData.card.isWerkstatt || dragData.card.isVierwoechig ? 'dv' : 'ds',
        );
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

  /** Klassenbindung der gezogenen Karte – bei u+g-Paaren in BEIDEN Wochen. */
  private dragFitsColumn(dragData: DragData, pos: PlacementPosition): boolean {
    if (!dragData.pairId) return this.state.cardFitsColumn(dragData.card, pos);
    return (
      this.state.cardFitsColumn(dragData.card, { ...pos, week: 'u' }) &&
      this.state.cardFitsColumn(dragData.card, { ...pos, week: 'g' })
    );
  }

  /** Kollisionsprüfung der gezogenen Karte – bei u+g-Paaren in BEIDEN Wochen
   *  (jeweils ohne die eigene u- bzw. g-Platzierung). */
  private dragCollision(dragData: DragData, pos: PlacementPosition): ReturnType<AppState['schedule']['checkSlot']> {
    if (!dragData.pairId) {
      const excludeId = dragData.source === 'grid' ? dragData.id : undefined;
      return this.state.schedule.checkSlot(dragData.card, pos, excludeId);
    }
    return (
      this.state.schedule.checkSlot(dragData.card, { ...pos, week: 'u' }, dragData.id) ??
      this.state.schedule.checkSlot(dragData.pairCard ?? dragData.card, { ...pos, week: 'g' }, dragData.pairId)
    );
  }

  /** Sperrzeit-Treffer (Lehrkraft oder Klasse) – bei u+g-Paaren in BEIDEN Wochen. */
  private dragHitsBlock(dragData: DragData, pos: PlacementPosition): boolean {
    const weeks: Week[] = dragData.pairId ? ['u', 'g'] : [pos.week];
    return weeks.some(
      (week) =>
        this.state.cardHitsBlock(dragData.card, { ...pos, week }) ||
        this.state.cardHitsClassBlock(dragData.card, { ...pos, week }),
    );
  }

  /** Färbt beim Drag-Start alle Raster-Zellen nach Eignung für die gezogene Karte. */
  private highlightDropTargets(dragData: DragData): void {
    const stacksAuto =
      dragData.card.isLabor || dragData.card.isWerkstatt || dragData.card.isVierwoechig || dragData.card.noCount;
    for (const cell of this.el.querySelectorAll<HTMLTableCellElement>('td.cell')) {
      const pos = this.posFromCell(cell);
      if (!this.dragFitsColumn(dragData, pos)) continue; // andere Klasse → neutral
      const collision = this.dragCollision(dragData, pos);
      let cls: string;
      if (!collision) cls = this.dragHitsBlock(dragData, pos) ? 'gblk' : 'gdv';
      else if (collision.type === 'class') cls = stacksAuto ? 'gdv' : 'gds';
      else cls = 'gdi';
      cell.classList.add(cls);
    }
  }

  private clearDropTargets(): void {
    for (const cell of this.el.querySelectorAll('td.cell.gdv, td.cell.gds, td.cell.gdi, td.cell.gblk')) {
      cell.classList.remove('gdv', 'gds', 'gdi', 'gblk');
    }
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
    h += '<th class="th-stub" rowspan="2"><button class="btn-addcls-left" title="Klasse hinzufügen (mehrfach klicken für mehrere)">+ Klasse</button></th>';
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

    // Klassen-Sperrzeiten (z. B. Betriebstag) dieses Tages je Spalte auflösen:
    // schraffierte Zellen + Beschriftung senkrecht über den ganzen Bereich.
    const blockAt = new Map<string, { text: string; first: boolean; len: number }>();
    for (const b of this.state.getClassBlocks()) {
      if (b.day !== day) continue;
      for (let c = 0; c < count; c++) {
        if (this.state.classes.classNameAt(c, day, b.week).trim().toLowerCase() !== b.klasse.toLowerCase()) continue;
        for (let p = b.from; p <= b.to; p++) {
          blockAt.set(`${p}_${c}_${b.week}`, { text: b.text, first: p === b.from, len: b.to - b.from + 1 });
        }
      }
    }

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

          // u+g-Verschmelzung: identischer Unterricht in beiden Wochen (auch als
          // Stapel, Raum darf abweichen) → EIN breites Schild über beide Spalten
          // (nur Anzeige – im Modell bleiben je Woche eigene Platzierungen).
          if (w === 'u' && cluster) {
            const gCluster = clusterAt.get(`${p}_${c}_g`);
            const pairs =
              gCluster && !blockAt.has(key) && !blockAt.has(`${p}_${c}_g`)
                ? this.matchUG(cluster, gCluster, c, day)
                : null;
            if (pairs) {
              const span = cluster.end - cluster.start + 1;
              for (let i = 1; i < span; i++) blocked.add(`${p + i}_${c}_u`);
              for (let i = 0; i < span; i++) blocked.add(`${p + i}_${c}_g`);
              h += `<td class="cell cug" data-d="${day}" data-p="${p}" data-c="${c}" data-w="u" colspan="2"${
                span > 1 ? ` rowspan="${span}"` : ''
              }>`;
              h += cluster.cards.length === 1 ? this.renderSingle(cluster.cards[0], pairs[0]) : this.renderStack(cluster, pairs);
              h += '</td>';
              continue;
            }
          }

          let rowspan = 1;
          if (cluster) {
            rowspan = cluster.end - cluster.start + 1;
            for (let i = 1; i < rowspan; i++) blocked.add(`${p + i}_${c}_${w}`);
          }

          const weekClass = w === 'u' ? 'cu' : 'cg';
          const cb = blockAt.get(key);
          h += `<td class="cell ${weekClass}${cb ? ' cell-blocked' : ''}${cb?.first ? ' cell-blocked-first' : ''}" data-d="${day}" data-p="${p}" data-c="${c}" data-w="${w}"${
            rowspan > 1 ? ` rowspan="${rowspan}"` : ''
          }>`;
          if (cb?.first) {
            // Beschriftung über den GANZEN gesperrten Bereich (senkrecht; bei 1–2
            // Stunden waagrecht) – die Zelle liegt per z-index über den Folgezellen.
            h += `<div class="class-block-label${cb.len < 3 ? ' horiz' : ''}" style="height: calc(var(--cell-h) * ${cb.len} - 6px)"><span>${esc(cb.text || 'gesperrt')}</span></div>`;
          }
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
      // Wöchentlich erscheint in u UND g; sonst nur in seiner Woche.
      for (const w of pl.weeks) {
        const key = `${pl.classIdx}_${w}`;
        const list = byColumn.get(key) ?? [];
        list.push(pl);
        byColumn.set(key, list);
      }
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

  /**
   * Prüft, ob u- und g-Cluster derselben Spalte identischen Unterricht zeigen
   * (gleiche Lage, gleiche Karten – auch als Stapel; nur der RAUM darf sich
   * unterscheiden, er wird dann als „u | g" angezeigt).
   * Rückgabe: je u-Karte der g-Partner (in Reihenfolge von u.cards), sonst null.
   */
  private matchUG(u: PlacementCluster, g: PlacementCluster, c: number, day: number): Placement[] | null {
    if (u.cards.length === 0 || u.cards.length !== g.cards.length) return null;
    if (u.start !== g.start || u.end !== g.end) return null;
    if (
      this.state.classes.classNameAt(c, day, 'u').trim().toLowerCase() !==
      this.state.classes.classNameAt(c, day, 'g').trim().toLowerCase()
    )
      return null;
    const rest = [...g.cards];
    const pairs: Placement[] = [];
    for (const a of u.cards) {
      const i = rest.findIndex((b) => this.sameLesson(a, b));
      if (i < 0) return null;
      pairs.push(rest[i]);
      rest.splice(i, 1);
    }
    return pairs;
  }

  /** Gleiche Unterrichtskarte in u und g (alle fachlichen Merkmale und die
   *  Lage; nur der Raum darf abweichen). */
  private sameLesson(a: Placement, b: Placement): boolean {
    return (
      a.abbr === b.abbr &&
      a.fach === b.fach &&
      a.klasse === b.klasse &&
      a.name === b.name &&
      a.color === b.color &&
      a.duration === b.duration &&
      a.startPeriod === b.startPeriod &&
      a.locked === b.locked &&
      a.isLabor === b.isLabor &&
      a.labGroup === b.labGroup &&
      a.isWerkstatt === b.isWerkstatt &&
      a.isVierwoechig === b.isVierwoechig &&
      a.firstHalf === b.firstHalf &&
      a.secondHalf === b.secondHalf &&
      a.noCount === b.noCount &&
      a.teamTeaching === b.teamTeaching &&
      a.schiene === b.schiene &&
      a.comment === b.comment
    );
  }

  /** Feld-Anzeige eines u+g-Schilds: gleicher Wert normal, sonst „u | g"
   *  (Raum und Kopplungs-ID dürfen sich zwischen den Wochen unterscheiden). */
  private pairText(a: string, b: string | undefined): string {
    if (b === undefined || a === b) return a;
    return `${a || '–'} | ${b || '–'}`;
  }

  private renderSingle(pl: Placement, pair?: Placement): string {
    const fg = ink(pl.color);
    const half = semesterLabel(pl);
    const room = this.pairText(pl.room, pair?.room);
    const cardCls = pl.isLabor ? ' labor-card' : pl.isWerkstatt ? ' werkstatt-card' : '';
    return `<div class="placed${cardCls}${pl.locked ? ' locked' : ''}${room.trim() ? '' : ' no-room'}" data-id="${pl.id}"${pair ? ` data-pair="${pair.id}"` : ''} data-abbr="${esc(pl.abbr)}" data-room="${esc(pl.room)}" data-klasse="${esc(pl.klasse)}" data-coupling="${esc(pl.coupling)}" data-team="${esc(pl.teamTeaching)}" data-labor="${pl.isLabor ? '1' : '0'}" data-werkstatt="${pl.isWerkstatt ? '1' : '0'}"
              style="background:${pl.color};color:${fg}" draggable="true">
        <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
        <button class="p-lock" data-id="${pl.id}" title="${pl.locked ? 'Fixierung aufheben' : 'Karte fixieren'}">${pl.locked ? '🔒' : '🔓'}</button>
        ${pl.klasse ? `<div class="p-klasse">${esc(pl.klasse)}</div>` : ''}
        <div class="p-abbr">${esc(pl.abbr)}</div>
        ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
        ${pl.name && !pl.fach ? `<div class="p-name">${esc(pl.name)}</div>` : ''}
        ${room ? `<div class="p-room"${pair && pair.room !== pl.room ? ' title="Raum u-Woche | g-Woche"' : ''}>${esc(room)}</div>` : ''}
        ${half ? `<div class="p-range p-half">${half}</div>` : ''}
        ${pl.isLabor ? `<div class="p-range">⚗ Labor${pl.labGroup ? ` ${pl.labGroup}` : ''}</div>` : ''}
        ${pl.isWerkstatt ? '<div class="p-range">🔧 Werkstatt</div>' : ''}
        ${pl.isVierwoechig ? '<div class="p-range">¼ 4-wö.</div>' : ''}
        ${pl.schiene ? '<span class="schiene-badge" title="Schiene über mehrere Klassen">S</span>' : ''}
        ${pl.noCount ? '<div class="p-range">∅ zählt nicht</div>' : ''}
        ${pl.coupling || pair?.coupling ? `<div class="p-range"${pair && pair.coupling !== pl.coupling ? ' title="Kopplung u-Woche | g-Woche"' : ''}>⛓ ${esc(this.pairText(pl.coupling, pair?.coupling))}</div>` : ''}
        ${pl.teamTeaching ? `<div class="p-range">👥 ${esc(pl.teamTeaching)}</div>` : ''}
        ${pl.collision ? '<div class="p-range">💥 Kollision</div>' : ''}
        ${pl.comment ? `<span class="p-comment" title="${esc(pl.comment)}">💬</span>` : ''}
        ${pair ? '<span class="ug-badge" title="Gleicher Unterricht in u- und g-Woche – Ziehen/Entfernen/Fixieren wirkt auf beide">u+g</span>' : ''}
      </div>`;
  }

  /**
   * Parallele Blöcke teilen die Zelle nebeneinander auf; jeder Block sitzt
   * innerhalb seiner Spalte vertikal dort, wo seine Stunden liegen
   * (relevant bei versetzt startenden Blöcken im selben Cluster).
   */
  private renderStack(cluster: PlacementCluster, pairs?: Placement[]): string {
    const span = cluster.end - cluster.start + 1;
    let h = '<div class="stack-wrap">';
    for (let i = 0; i < cluster.cards.length; i++) {
      const pl = cluster.cards[i];
      const pair = pairs?.[i];
      const fg = ink(pl.color);
      const half = semesterLabel(pl);
      const room = this.pairText(pl.room, pair?.room);
      const visibleEnd = Math.min(pl.endPeriod, cluster.end);
      const top = ((pl.startPeriod - cluster.start) / span) * 100;
      const height = ((visibleEnd - pl.startPeriod + 1) / span) * 100;
      h += `<div class="stack-col">
          <div class="placed-mini${pl.isLabor ? ' labor-card' : pl.isWerkstatt ? ' werkstatt-card' : ''}${pl.locked ? ' locked' : ''}${room.trim() ? '' : ' no-room'}" data-id="${pl.id}"${pair ? ` data-pair="${pair.id}"` : ''} data-abbr="${esc(pl.abbr)}" data-room="${esc(pl.room)}" data-klasse="${esc(pl.klasse)}" data-coupling="${esc(pl.coupling)}" data-team="${esc(pl.teamTeaching)}" data-labor="${pl.isLabor ? '1' : '0'}" data-werkstatt="${pl.isWerkstatt ? '1' : '0'}"
               style="background:${pl.color};color:${fg};top:${top}%;height:${height}%" draggable="true">
            <button class="p-rm" data-id="${pl.id}" title="Zurück in Pool">✕</button>
            <button class="p-lock" data-id="${pl.id}" title="${pl.locked ? 'Fixierung aufheben' : 'Karte fixieren'}">${pl.locked ? '🔒' : '🔓'}</button>
            ${pl.klasse ? `<div class="p-klasse">${esc(pl.klasse)}</div>` : ''}
            <div class="p-abbr">${esc(pl.abbr)}</div>
            ${(pl.isLabor || pl.isWerkstatt) && pl.labGroup ? `<div class="p-grp" title="Gruppe ${esc(pl.labGroup)}">${esc(pl.labGroup)}</div>` : ''}
            ${pl.schiene ? '<span class="schiene-badge schiene-badge-mini" title="Schiene über mehrere Klassen">S</span>' : ''}
            ${pl.fach ? `<div class="p-name">${esc(pl.fach)}</div>` : ''}
            ${room ? `<div class="p-room"${pair && pair.room !== pl.room ? ' title="Raum u-Woche | g-Woche"' : ''}>${esc(room)}</div>` : ''}
            ${half ? `<div class="p-range p-half">${half}</div>` : ''}
            ${pl.isVierwoechig ? '<div class="p-range">¼</div>' : ''}
            ${pl.comment ? `<span class="p-comment" title="${esc(pl.comment)}">💬</span>` : ''}
            ${pair ? '<span class="ug-badge ug-badge-mini" title="Gleicher Unterricht in u- und g-Woche – wirkt auf beide">u+g</span>' : ''}
          </div>
        </div>`;
    }
    h += '</div>';
    if (cluster.cards.every((x) => x.isLabor)) h += '<div class="stack-labor">⚗</div>';
    else if (cluster.cards.every((x) => x.isWerkstatt)) h += '<div class="stack-labor">🔧</div>';
    else if (cluster.cards.every((x) => x.isVierwoechig)) h += '<div class="stack-labor">¼</div>';
    return h;
  }
}
