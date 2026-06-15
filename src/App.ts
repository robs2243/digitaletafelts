import { AppState } from './domain/AppState';
import { DAYS } from './domain/constants';
import { semesterFactor } from './domain/semester';
import type { CardProps, LabelField, PlacementPosition } from './domain/types';
import { esc } from './utils/html';
import * as XLSX from 'xlsx';
import { parseCardRows, TEMPLATE_AOA } from './services/cardImport';
import { FileService } from './services/FileService';
import { StorageService } from './services/StorageService';
import { CardModal } from './ui/CardModal';
import { ClearCardsModal } from './ui/ClearCardsModal';
import { CollisionModal } from './ui/CollisionModal';
import { CommentModal } from './ui/CommentModal';
import { classMismatchMessage, collisionMessage } from './ui/collisionMessages';
import { DragController, type DragData } from './ui/DragController';
import { PoolView } from './ui/PoolView';
import { SaveBadge } from './ui/SaveBadge';
import { StatsView } from './ui/StatsView';
import { TimetableView } from './ui/TimetableView';
import { Toast } from './ui/Toast';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} nicht gefunden`);
  return el as T;
}

/**
 * Kompositionswurzel: lädt den Zustand, verdrahtet Domäne, Persistenz
 * und UI-Komponenten und steuert die Anwendungsfälle (Controller-Rolle).
 */
export class App {
  private readonly state: AppState;
  private readonly storage = new StorageService();
  private readonly fileService = new FileService();
  private readonly drag = new DragController();

  private readonly toast: Toast;
  private readonly saveBadge: SaveBadge;
  private readonly poolView: PoolView;
  private readonly statsView: StatsView;
  private readonly timetableView: TimetableView;
  private readonly cardModal: CardModal;
  private readonly collisionModal: CollisionModal;
  private readonly commentModal: CommentModal;
  private readonly clearModal: ClearCardsModal;

  /** Aktueller Kürzel-Suchbegriff (hebt passende Lehrer hervor, graut Rest aus). */
  private searchTerm = '';
  /** Raum-Suchbegriff (hebt passenden Raum hervor, graut Rest aus). */
  private roomTerm = '';
  /** Header-Filter: nur Labor- bzw. Werkstatt-Karten hervorheben. */
  private filterLabor = false;
  private filterWerkstatt = false;
  /** Zoomfaktor des Stundenplans (Strg+Mausrad / Buttons). */
  private zoom = 1;

  constructor() {
    const persisted = this.storage.load();
    this.state = persisted ? AppState.fromJSON(persisted) : AppState.createDefault();

    this.toast = new Toast(byId('toast'));
    this.saveBadge = new SaveBadge(byId('sbadge'));
    this.statsView = new StatsView(byId('stats'), this.state, {
      onSelect: (abbr) => this.openTeacherList(abbr),
    });
    this.collisionModal = new CollisionModal();
    this.commentModal = new CommentModal();
    this.clearModal = new ClearCardsModal();

    this.poolView = new PoolView(byId('pool'), this.state, this.drag, {
      onEdit: (id) => this.openEditCard(id),
      onComment: (id) => this.openCardComment(id),
      onDelete: (id) => this.handleDeleteCard(id),
      onOpenList: () => this.openPoolList(),
      onDragEnd: () => this.renderAll(),
    });

    this.timetableView = new TimetableView(byId<HTMLTableElement>('tt'), this.state, this.drag, {
      onDrop: (pos) => this.handleDrop(pos),
      onDragEnd: () => this.renderAll(),
      onRemovePlacement: (id) => this.handleRemovePlacement(id),
      onCommentPlacement: (id) => this.openPlacementComment(id),
      onToggleLock: (id) => this.handleToggleLock(id),
      onLockedBlocked: () =>
        this.toast.show('🔒 Karte ist fixiert – zum Verschieben erst die Fixierung aufheben.', 'inf'),
      onSetClassLabel: (c, d, field, value) => this.handleSetClassLabel(c, d, field, value),
      onSetLabelColor: (c, d, field, color) => this.state.setClassLabelColor(c, d, field, color),
      onDeleteClass: (idx) => this.handleDeleteClass(idx),
      onAddClass: () => this.handleAddClass(),
    });

    this.cardModal = new CardModal({
      onSave: (editingId, props) => this.handleSaveCard(editingId, props),
      onDelete: (id) => this.handleDeleteCard(id),
      lookupAbbr: (abbr) => this.state.findByAbbr(abbr),
    });

    this.bindGlobalControls();
  }

  start(): void {
    this.state.onChange((e) => {
      this.storage.save(this.state.toJSON());
      this.saveBadge.flash();
      if (e.render) this.renderAll();
    });
    this.renderAll();
  }

  private renderAll(): void {
    this.poolView.render();
    this.timetableView.render();
    this.statsView.render();
    this.applySearch();
  }

  /**
   * Hervorheben/Ausgrauen über Pool, Stundenplan und Übersicht. Kombiniert
   * Kürzel-Suche, Raum-Suche und die Kategorie-Filter (Labor/Werkstatt) für die
   * Karten; die Stunden-Übersicht reagiert nur auf die Kürzel-Suche. Arbeitet
   * direkt auf dem DOM (kein Re-Render), daher nach jedem renderAll erneut nötig.
   */
  private applySearch(): void {
    const abbrTerm = this.searchTerm.trim().toUpperCase();
    const roomTerm = this.roomTerm.trim().toUpperCase();
    const catActive = this.filterLabor || this.filterWerkstatt;
    const textActive = abbrTerm.length > 0 || roomTerm.length > 0;
    const cardFilterActive = textActive || catActive;

    // Karten (Pool + Plan): Kürzel UND Raum UND Kategorie.
    for (const el of document.querySelectorAll<HTMLElement>('.tc, .placed, .placed-mini')) {
      const abbr = (el.dataset.abbr ?? '').toUpperCase();
      const room = (el.dataset.room ?? '').toUpperCase();
      const okAbbr = !abbrTerm || abbr.includes(abbrTerm);
      const okRoom = !roomTerm || room.includes(roomTerm);
      const okCat =
        !catActive ||
        (this.filterLabor && el.dataset.labor === '1') ||
        (this.filterWerkstatt && el.dataset.werkstatt === '1');
      const hit = okAbbr && okRoom && okCat;
      el.classList.toggle('search-dim', cardFilterActive && !hit);
      el.classList.toggle('search-hit', textActive && hit);
    }

    // Stunden-Übersicht: nur Kürzel-Suche.
    for (const el of document.querySelectorAll<HTMLElement>('.stat-row')) {
      const match = abbrTerm.length > 0 && (el.dataset.abbr ?? '').toUpperCase().includes(abbrTerm);
      el.classList.toggle('search-hit', match);
      el.classList.toggle('search-dim', abbrTerm.length > 0 && !match);
    }
    if (abbrTerm.length > 0) {
      document.querySelector('.stats .stat-row.search-hit')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private bindGlobalControls(): void {
    byId('btn-planning').addEventListener('click', () => this.openPlanning());
    byId('btn-new-card').addEventListener('click', () => this.cardModal.openForCreate(this.state.suggestFreeColor()));
    byId('btn-clear-cards').addEventListener('click', () => this.openClearCards());
    byId('btn-comments').addEventListener('click', () => this.openComments());

    const roomsOnly = byId<HTMLInputElement>('rooms-only');
    roomsOnly.addEventListener('change', () => {
      document.body.classList.toggle('rooms-only', roomsOnly.checked);
    });
    byId('btn-open').addEventListener('click', () => void this.handleOpen());
    byId('btn-save').addEventListener('click', () => void this.handleSave(false));
    byId('btn-save-as').addEventListener('click', () => void this.handleSave(true));

    const filter1 = byId<HTMLInputElement>('filter-hj1');
    const filter2 = byId<HTMLInputElement>('filter-hj2');
    const applyFilter = () => {
      this.timetableView.setSemesterFilter(filter1.checked, filter2.checked);
      this.renderAll();
    };
    filter1.addEventListener('change', applyFilter);
    filter2.addEventListener('change', applyFilter);

    const labor = byId<HTMLInputElement>('filter-labor');
    const werk = byId<HTMLInputElement>('filter-werkstatt');
    const applyHighlight = () => {
      this.filterLabor = labor.checked;
      this.filterWerkstatt = werk.checked;
      this.applySearch();
    };
    labor.addEventListener('change', applyHighlight);
    werk.addEventListener('change', applyHighlight);

    const searchInput = byId<HTMLInputElement>('search');
    searchInput.addEventListener('input', () => {
      this.searchTerm = searchInput.value;
      this.applySearch();
    });
    byId('search-clear').addEventListener('click', () => {
      searchInput.value = '';
      this.searchTerm = '';
      this.applySearch();
      searchInput.focus();
    });

    const roomInput = byId<HTMLInputElement>('search-room');
    roomInput.addEventListener('input', () => {
      this.roomTerm = roomInput.value;
      this.applySearch();
    });
    byId('search-room-clear').addEventListener('click', () => {
      roomInput.value = '';
      this.roomTerm = '';
      this.applySearch();
      roomInput.focus();
    });

    this.bindZoom();

    const teacherOverlay = byId('teacher-modal');
    byId('tm-close').addEventListener('click', () => this.closeTeacherModal());
    teacherOverlay.addEventListener('click', (e) => {
      if (e.target === teacherOverlay) this.closeTeacherModal();
    });

    byId('pool-head').addEventListener('dblclick', () => this.openPoolList());
    byId('btn-pool-list').addEventListener('click', () => this.openPoolList());

    const planningOverlay = byId('planning-modal');
    byId('plan-cancel').addEventListener('click', () => this.closePlanning());
    planningOverlay.addEventListener('click', (e) => {
      if (e.target === planningOverlay) this.closePlanning();
    });
    byId('plan-unplace').addEventListener('click', () => this.handleUnplace());
    const poolListOverlay = byId('pool-list-modal');
    byId('pl-close').addEventListener('click', () => this.closePoolList());
    poolListOverlay.addEventListener('click', (e) => {
      if (e.target === poolListOverlay) this.closePoolList();
    });
    for (const id of ['pl-abbr', 'pl-klasse', 'pl-room']) {
      byId(id).addEventListener('input', () => this.renderPoolList());
    }
    for (const id of ['pl-labor', 'pl-werkstatt']) {
      byId(id).addEventListener('change', () => this.renderPoolList());
    }
    byId('pl-list').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.pl-item');
      if (row?.dataset.id) {
        this.closePoolList();
        this.openEditCard(row.dataset.id);
      }
    });
    byId('pl-template').addEventListener('click', () => this.downloadTemplate());
    const importFile = byId<HTMLInputElement>('pl-import-file');
    byId('pl-import').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files?.[0];
      if (file) void this.handleExcelImport(file);
      importFile.value = '';
    });

    const commentsOverlay = byId('comments-modal');
    byId('cmall-close').addEventListener('click', () => this.closeComments());
    commentsOverlay.addEventListener('click', (e) => {
      if (e.target === commentsOverlay) this.closeComments();
    });
    byId('cmall-list').addEventListener('click', (e) => {
      const del = (e.target as HTMLElement).closest<HTMLElement>('.cmall-del');
      if (!del?.dataset.id) return;
      if (del.dataset.kind === 'p') this.state.setPlacementComment(del.dataset.id, '');
      else this.state.setCardComment(del.dataset.id, '');
      this.renderCommentsList();
    });
    byId('cmall-clear-all').addEventListener('click', () => {
      if (!confirm('Wirklich ALLE Kommentare löschen?')) return;
      this.state.clearAllComments();
      this.renderCommentsList();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cardModal.close();
        this.collisionModal.close();
        this.commentModal.close();
        this.clearModal.close();
        this.closeTeacherModal();
        this.closeComments();
        this.closePoolList();
        this.closePlanning();
      }
      if (e.key === 'Enter' && this.cardModal.isOpen) this.cardModal.submit();
    });
  }

  // ── Lehrer-Stundenliste ─────────────────────────────────────────────────

  /** Zeigt alle Stunden einer Lehrkraft (sortiert) in einem Dialog. */
  private openTeacherList(abbr: string): void {
    const items = this.state.schedule.all
      .filter((p) => p.abbr === abbr)
      .sort((a, b) => a.day - b.day || a.startPeriod - b.startPeriod || a.week.localeCompare(b.week));

    let hoursU = 0;
    let hoursG = 0;
    for (const p of items) {
      const h = p.duration * semesterFactor(p) * (p.isVierwoechig ? 0.5 : 1);
      if (p.week === 'u') hoursU += h;
      else hoursG += h;
    }
    const avg = (hoursU + hoursG) / 2;
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');

    byId('tm-title').textContent = `Stunden – ${abbr}`;
    byId('tm-sub').textContent = `u: ${hoursU} · g: ${hoursG} · Schnitt (Deputat): ${fmt(avg)}`;

    const list = byId('tm-list');
    if (!items.length) {
      list.innerHTML = '<div class="tm-empty">Keine platzierten Stunden.</div>';
    } else {
      list.innerHTML = items
        .map((p) => {
          const range = p.duration > 1 ? `${p.startPeriod}–${p.endPeriod}` : `${p.startPeriod}`;
          const klass = this.state.classes.displayLabel(p.classIdx, p.day, p.week);
          const extra = [p.fach, p.room].filter(Boolean).map((x) => esc(x)).join(' · ');
          return `<div class="tm-item">
              <span class="tm-week tm-week-${p.week}">${p.week.toUpperCase()}</span>
              <span class="tm-day">${DAYS[p.day]}</span>
              <span class="tm-per">Std. ${range}</span>
              <span class="tm-cls">${esc(klass)}</span>
              ${extra ? `<span class="tm-extra">${extra}</span>` : ''}
            </div>`;
        })
        .join('');
    }
    byId('teacher-modal').classList.add('open');
  }

  private closeTeacherModal(): void {
    byId('teacher-modal').classList.remove('open');
  }

  // ── Alle Kommentare ─────────────────────────────────────────────────────

  /** Zeigt alle Karten-Kommentare (Pool + Plan) gesammelt in einem Dialog. */
  private openComments(): void {
    this.renderCommentsList();
    byId('comments-modal').classList.add('open');
  }

  private renderCommentsList(): void {
    const entries: { kind: 'p' | 'c'; id: string; head: string; comment: string }[] = [];
    for (const p of this.state.schedule.all) {
      if (!p.comment.trim()) continue;
      const range = p.duration > 1 ? `${p.startPeriod}–${p.endPeriod}` : `${p.startPeriod}`;
      const klass = this.state.classes.displayLabel(p.classIdx, p.day, p.week);
      entries.push({
        kind: 'p',
        id: p.id,
        head: `${p.abbr} · ${DAYS[p.day]} Std. ${range} (${p.week.toUpperCase()}) · ${klass}`,
        comment: p.comment,
      });
    }
    for (const c of this.state.pool.all) {
      if (c.comment.trim()) entries.push({ kind: 'c', id: c.id, head: `${c.abbr} · Pool`, comment: c.comment });
    }
    entries.sort((a, b) => a.head.localeCompare(b.head));

    byId('cmall-clear-all').style.display = entries.length ? 'inline-flex' : 'none';
    const list = byId('cmall-list');
    list.innerHTML = entries.length
      ? entries
          .map(
            (e) => `<div class="cmall-item">
              <div class="cmall-body">
                <div class="cmall-head">${esc(e.head)}</div>
                <div class="cmall-text">${esc(e.comment)}</div>
              </div>
              <button class="cmall-del" data-kind="${e.kind}" data-id="${esc(e.id)}" title="Diesen Kommentar löschen">✕</button>
            </div>`,
          )
          .join('')
      : '<div class="tm-empty">Keine Kommentare vorhanden.</div>';
  }

  private closeComments(): void {
    byId('comments-modal').classList.remove('open');
  }

  // ── Pool-Liste (nicht verplante Karten, mit Filter) ─────────────────────

  private openPoolList(): void {
    this.renderPoolList();
    byId('pool-list-modal').classList.add('open');
  }

  private renderPoolList(): void {
    const abbr = byId<HTMLInputElement>('pl-abbr').value.trim().toLowerCase();
    const klasse = byId<HTMLInputElement>('pl-klasse').value.trim().toLowerCase();
    const room = byId<HTMLInputElement>('pl-room').value.trim().toLowerCase();
    const onlyLabor = byId<HTMLInputElement>('pl-labor').checked;
    const onlyWerk = byId<HTMLInputElement>('pl-werkstatt').checked;

    const items = this.state.pool.all
      .filter(
        (c) =>
          (!abbr || c.abbr.toLowerCase().includes(abbr)) &&
          (!klasse || c.klasse.toLowerCase().includes(klasse)) &&
          (!room || c.room.toLowerCase().includes(room)) &&
          (!onlyLabor || c.isLabor) &&
          (!onlyWerk || c.isWerkstatt),
      )
      .sort((a, b) => a.abbr.localeCompare(b.abbr));

    const total = this.state.pool.all.length;
    byId('pl-sub').textContent =
      total === 0 ? 'Keine nicht verplanten Karten.' : `${items.length} von ${total} Karten`;

    const list = byId('pl-list');
    list.innerHTML = items
      .map((c) => {
        const badges =
          (c.isLabor ? '⚗' : '') + (c.isWerkstatt ? '🔧' : '') + (c.isVierwoechig ? '¼' : '');
        const meta = [c.klasse, c.fach, c.room].filter(Boolean).map((x) => esc(x)).join(' · ');
        return `<div class="pl-item" data-id="${esc(c.id)}" title="Klicken: bearbeiten">
            <span class="pl-chip" style="background:${c.color}"></span>
            <span class="pl-abbr">${esc(c.abbr)}</span>
            <span class="pl-meta">${meta}</span>
            <span class="pl-badges">${badges} ${c.duration}h</span>
          </div>`;
      })
      .join('');
  }

  private closePoolList(): void {
    byId('pool-list-modal').classList.remove('open');
  }

  /** Lädt eine Excel-/CSV-Datei und legt daraus Pool-Karten an. */
  private async handleExcelImport(file: File): Promise<void> {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }) as unknown[][];
      const cards = parseCardRows(rows);
      if (!cards.length) {
        this.toast.show('Keine gültigen Zeilen gefunden (Spalte „Kürzel"?).', 'inf');
        return;
      }
      this.state.importCards(cards);
      this.renderPoolList();
      this.toast.show(`✓ ${cards.length} Karten importiert`);
    } catch {
      this.toast.show('Datei konnte nicht gelesen werden (Excel/CSV?).', 'inf');
    }
  }

  /** Erzeugt eine Excel-Vorlage mit den passenden Spalten und Beispielzeilen. */
  private downloadTemplate(): void {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE_AOA), 'Karten');
    XLSX.writeFile(wb, 'Vorlage-Karten.xlsx');
  }

  // ── Zoom (Strg+Mausrad / Buttons / Strg +,-,0) ──────────────────────────

  private bindZoom(): void {
    const saved = parseFloat(localStorage.getItem('dt-zoom') ?? '1');
    if (Number.isFinite(saved)) this.zoom = this.clampZoom(saved);
    this.applyZoom();

    byId('zoom-in').addEventListener('click', () => this.setZoom(this.zoom + 0.1));
    byId('zoom-out').addEventListener('click', () => this.setZoom(this.zoom - 0.1));
    byId('zoom-reset').addEventListener('click', () => this.setZoom(1));

    // Strg + Mausrad: hinein-/herauszoomen (verhindert den Standard-Browserzoom).
    document.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
      },
      { passive: false },
    );

    // Strg + / − / 0
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.setZoom(this.zoom + 0.1);
      } else if (e.key === '-') {
        e.preventDefault();
        this.setZoom(this.zoom - 0.1);
      } else if (e.key === '0') {
        e.preventDefault();
        this.setZoom(1);
      }
    });
  }

  private clampZoom(z: number): number {
    return Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
  }

  private setZoom(z: number): void {
    this.zoom = this.clampZoom(z);
    this.applyZoom();
    try {
      localStorage.setItem('dt-zoom', String(this.zoom));
    } catch {
      // Speicher nicht verfügbar – Zoom wirkt dann nur in dieser Sitzung.
    }
  }

  /** Zoomt den Stundenplan (Tabelle); der Scrollbereich fängt den Überlauf ab. */
  private applyZoom(): void {
    byId('tt').style.setProperty('zoom', String(this.zoom));
    byId('zoom-reset').textContent = `${Math.round(this.zoom * 100)}%`;
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────

  private handleDrop(pos: PlacementPosition): void {
    const dragData = this.drag.active;
    if (!dragData) return;

    // Klassenbindung: Karte darf nur in eine Spalte mit passendem Klassennamen.
    if (!this.state.cardFitsColumn(dragData.card, pos)) {
      this.collisionModal.show({ messageHtml: classMismatchMessage(dragData.card.klasse), canStack: false });
      return;
    }

    const excludeId = dragData.source === 'grid' ? dragData.id : undefined;
    const collision = this.state.schedule.checkSlot(dragData.card, pos, excludeId);

    if (!collision) {
      this.placeDrag(dragData, pos);
      return;
    }
    if (collision.type === 'class') {
      if (dragData.card.isLabor || dragData.card.isWerkstatt || dragData.card.isVierwoechig) {
        // Labor-/Werkstatt-/4-wöchig-Karten stapeln ohne Rückfrage
        this.placeDrag(dragData, pos);
      } else {
        const msg = collisionMessage(collision, pos, dragData.card.abbr, (c, d, w) =>
          this.state.classes.displayLabel(c, d, w),
        );
        // dragData ist ein Snapshot und bleibt bis zur Bestätigung gültig
        this.collisionModal.show({ messageHtml: msg, canStack: true, onStack: () => this.placeDrag(dragData, pos) });
      }
      return;
    }
    const msg = collisionMessage(collision, pos, dragData.card.abbr, (c, d, w) =>
      this.state.classes.displayLabel(c, d, w),
    );
    this.collisionModal.show({ messageHtml: msg, canStack: false });
  }

  private placeDrag(dragData: DragData, pos: PlacementPosition): void {
    const placement =
      dragData.source === 'pool'
        ? this.state.placeFromPool(dragData.id, pos)
        : this.state.movePlacement(dragData.id, pos);
    if (!placement) return;
    const range = placement.duration > 1 ? `${placement.startPeriod}–${placement.endPeriod}` : `${placement.startPeriod}`;
    const fach = placement.fach ? ` – ${placement.fach}` : '';
    this.toast.show(`✓ ${placement.abbr}${fach} → ${DAYS[pos.day]}, Std.${range} (${pos.week.toUpperCase()})`);
  }

  private handleRemovePlacement(id: string): void {
    const placement = this.state.returnToPool(id);
    if (placement) this.toast.show(`${placement.abbr} zurück in den Pool`, 'inf');
  }

  private handleToggleLock(id: string): void {
    const locked = this.state.toggleLock(id);
    if (locked === null) return;
    this.toast.show(locked ? '🔒 Karte fixiert' : '🔓 Fixierung aufgehoben', 'inf');
  }

  // ── Klassen ─────────────────────────────────────────────────────────────

  /**
   * Setzt den Beschriftungstext und übernimmt – falls der Name woanders schon
   * eine Farbe hat und das Feld noch keine eigene – automatisch diese Farbe.
   * Gibt die ggf. übernommene Farbe zurück (für sofortige Anzeige ohne Re-Render).
   */
  private handleSetClassLabel(classIdx: number, day: number, field: LabelField, value: string): string | null {
    this.state.setClassLabel(classIdx, day, field, value);
    if (!value.trim() || this.state.classes.color(classIdx, day, field)) return null;
    const color = this.state.classes.colorForName(value);
    if (!color) return null;
    this.state.setClassLabelColor(classIdx, day, field, color, false);
    return color;
  }

  private handleAddClass(): void {
    const idx = this.state.addClass();
    // Frisch angelegte Spalte: erstes Beschriftungsfeld (Montag, u+g) fokussieren
    setTimeout(() => {
      const first = document.querySelector<HTMLInputElement>(`.dh-comb[data-c="${idx}"][data-d="0"]`);
      if (first) {
        first.focus();
        first.select();
      }
    }, 60);
  }

  private handleDeleteClass(idx: number): void {
    const name = this.state.classes.columnLabel(idx);
    const hasEntries = this.state.hasPlacementsForClass(idx);
    const warning = hasEntries ? '\n\n⚠️ Bestehende Einträge werden mitgelöscht!' : '';
    if (!confirm(`Spalte „${name}" löschen?${warning}`)) return;
    this.state.deleteClass(idx);
    this.toast.show(`${name} entfernt`, 'inf');
  }

  // ── Kommentare ──────────────────────────────────────────────────────────

  private openCardComment(id: string): void {
    const card = this.state.pool.findById(id);
    if (!card) return;
    const label = card.fach ? `${card.abbr} – ${card.fach}` : card.abbr;
    this.commentModal.open(label, card.comment, (text) => {
      this.state.setCardComment(id, text);
      this.toast.show(text ? '💬 Kommentar gespeichert' : 'Kommentar entfernt', text ? 'ok' : 'inf');
    });
  }

  private openPlacementComment(id: string): void {
    const placement = this.state.schedule.findById(id);
    if (!placement) return;
    const label = placement.fach ? `${placement.abbr} – ${placement.fach}` : placement.abbr;
    this.commentModal.open(label, placement.comment, (text) => {
      this.state.setPlacementComment(id, text);
      this.toast.show(text ? '💬 Kommentar gespeichert' : 'Kommentar entfernt', text ? 'ok' : 'inf');
    });
  }

  // ── Karten-Modal ────────────────────────────────────────────────────────

  private openEditCard(id: string): void {
    const card = this.state.pool.findById(id);
    if (card) this.cardModal.openForEdit(card);
  }

  private handleSaveCard(editingId: string | null, props: CardProps): boolean {
    if (!props.abbr) {
      this.toast.show('Bitte ein Kürzel eingeben.', 'inf');
      return false;
    }
    if (editingId) this.state.updateCard(editingId, props);
    else this.state.createCard(props);
    const tag = props.isLabor ? ' ⚗' : props.isWerkstatt ? ' 🔧' : '';
    const fach = props.fach ? ` – ${props.fach}` : '';
    this.toast.show(`✓ ${props.abbr}${fach}${tag} gespeichert`);
    return true;
  }

  /** Lädt einen Plan aus einer Datei und ersetzt den aktuellen Zustand. */
  private async handleOpen(): Promise<void> {
    if (this.state.totalCardCount > 0 &&
        !confirm('Beim Öffnen wird der aktuelle Plan ersetzt. Fortfahren?')) {
      return;
    }
    try {
      const result = await this.fileService.open();
      if (!result) return; // abgebrochen
      this.state.loadFrom(result.data);
      this.toast.show(`✓ Geladen: ${result.name}`);
    } catch {
      this.toast.show('Datei konnte nicht geladen werden (ungültiges Format?).', 'inf');
    }
  }

  /** Speichert den Plan in eine Datei. forceNew = true → „Speichern unter“. */
  private async handleSave(forceNew: boolean): Promise<void> {
    try {
      const state = this.state.toJSON();
      const res = forceNew ? await this.fileService.saveAs(state) : await this.fileService.save(state);
      if (res.cancelled) return;
      this.toast.show(res.name ? `✓ Gespeichert: ${res.name}` : '✓ Datei gespeichert');
    } catch {
      this.toast.show('Speichern fehlgeschlagen.', 'inf');
    }
  }

  // ── Planung (entplanen) ─────────────────────────────────────────────────

  /** Öffnet das Planungsfenster mit der Entplan-Auswahl (alle / je Kürzel). */
  private openPlanning(): void {
    const total = this.state.totalPlacedCount;
    const select = byId<HTMLSelectElement>('plan-select');
    if (!total) {
      select.innerHTML = '<option value="">Keine Karten platziert</option>';
    } else {
      select.innerHTML =
        `<option value="__all__">Alle Karten entplanen (${total})</option>` +
        this.state
          .placedCountsByAbbr()
          .map((o) => `<option value="${esc(o.abbr)}">${esc(o.abbr)} (${o.count})</option>`)
          .join('');
    }
    byId('planning-modal').classList.add('open');
  }

  private closePlanning(): void {
    byId('planning-modal').classList.remove('open');
  }

  /** Führt die im Planungsfenster gewählte Entplanung aus (alle: „Ja"-Bestätigung). */
  private handleUnplace(): void {
    if (!this.state.totalPlacedCount) {
      this.closePlanning();
      return;
    }
    const value = byId<HTMLSelectElement>('plan-select').value;
    if (!value) return;

    if (value === '__all__') {
      const answer = prompt(
        `Alle ${this.state.totalPlacedCount} platzierten Karten zurück in den Pool (entplanen)?\n\nZum Bestätigen „Ja" eingeben:`,
      );
      if (answer === null) return;
      if (answer.trim().toLowerCase() !== 'ja') {
        this.toast.show('Abgebrochen – es wurde nicht „Ja" eingegeben.', 'inf');
        return;
      }
      const n = this.state.unplaceAll();
      this.toast.show(`↩ ${n} Karten entplant`, 'inf');
    } else {
      if (!confirm(`Alle Karten von „${value}" entplanen (zurück in den Pool)?`)) return;
      const n = this.state.unplaceByAbbr(value);
      this.toast.show(`↩ ${n} Karten von „${value}" entplant`, 'inf');
    }
    this.closePlanning();
  }

  private openClearCards(): void {
    if (this.state.totalCardCount === 0) {
      this.toast.show('Keine Karten zum Löschen vorhanden.', 'inf');
      return;
    }
    this.clearModal.open(this.state.cardCountsByAbbr(), this.state.totalCardCount, (abbr) => {
      if (abbr === null) {
        this.state.deleteAllCards();
        this.toast.show('Alle Karten gelöscht', 'inf');
      } else {
        this.state.deleteCardsByAbbr(abbr);
        this.toast.show(`Karten „${abbr}“ gelöscht`, 'inf');
      }
    });
  }

  private handleDeleteCard(id: string): void {
    const card = this.state.pool.findById(id);
    if (!card) return;
    const label = card.fach ? `${card.abbr} – ${card.fach}` : card.abbr;
    if (!confirm(`Karte „${label}" löschen?`)) return;
    this.state.deleteCard(id);
    this.cardModal.close();
    this.toast.show(`${card.abbr} gelöscht`, 'inf');
  }
}
