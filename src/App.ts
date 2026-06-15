import { AppState } from './domain/AppState';
import { DAYS, PERIODS } from './domain/constants';
import type { Placement } from './domain/Placement';
import { ink } from './utils/color';
import { semesterFactor } from './domain/semester';
import type { CardProps, CardWithPlace, LabelField, PlacementPosition, PlanProgress, PlanRunResult } from './domain/types';
import { esc } from './utils/html';
import * as XLSX from 'xlsx';
import { parseCardRows, TEMPLATE_AOA } from './services/cardImport';
import planningRulesText from '../PLANUNGSREGELN.md?raw';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
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
  /** Klassen-Suchbegriff (hebt passende Klasse hervor, graut Rest aus). */
  private klasseTerm = '';
  /** Steuerflag für den laufenden Planungslauf (Abbrechen / vorzeitig übernehmen). */
  private planStop: 'continue' | 'accept' | 'cancel' = 'continue';
  /** Stundenplan-Ansicht: Modus und aktuelle Auswahl (Kürzel bzw. Klassenname). */
  private schedMode: 'teacher' | 'class' = 'teacher';
  private schedSel = '';
  private schedZoom = 1;
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
    const klasseTerm = this.klasseTerm.trim().toUpperCase();
    const catActive = this.filterLabor || this.filterWerkstatt;
    const textActive = abbrTerm.length > 0 || roomTerm.length > 0 || klasseTerm.length > 0;
    const cardFilterActive = textActive || catActive;

    // Karten (Pool + Plan): Kürzel UND Raum UND Klasse UND Kategorie.
    for (const el of document.querySelectorAll<HTMLElement>('.tc, .placed, .placed-mini')) {
      const abbr = (el.dataset.abbr ?? '').toUpperCase();
      const room = (el.dataset.room ?? '').toUpperCase();
      const klasse = (el.dataset.klasse ?? '').toUpperCase();
      const okAbbr = !abbrTerm || abbr.includes(abbrTerm);
      const okRoom = !roomTerm || room.includes(roomTerm);
      const okKlasse = !klasseTerm || klasse.includes(klasseTerm);
      const okCat =
        !catActive ||
        (this.filterLabor && el.dataset.labor === '1') ||
        (this.filterWerkstatt && el.dataset.werkstatt === '1');
      const hit = okAbbr && okRoom && okKlasse && okCat;
      el.classList.toggle('search-dim', cardFilterActive && !hit);
      el.classList.toggle('search-hit', textActive && hit);
    }

    // Treffer im Lehrer-Pool ganz nach oben sortieren (Suche aktiv).
    this.reorderPoolHits(textActive || catActive);

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

  /** Schiebt die Treffer-Karten im Lehrer-Pool nach oben (Reihenfolge bleibt erhalten). */
  private reorderPoolHits(active: boolean): void {
    if (!active) return;
    const pool = byId('pool');
    const hits = pool.querySelectorAll<HTMLElement>('.tc.search-hit');
    for (let i = hits.length - 1; i >= 0; i--) pool.prepend(hits[i]);
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

    const klasseInput = byId<HTMLInputElement>('search-klasse');
    klasseInput.addEventListener('input', () => {
      this.klasseTerm = klasseInput.value;
      this.applySearch();
    });
    byId('search-klasse-clear').addEventListener('click', () => {
      klasseInput.value = '';
      this.klasseTerm = '';
      this.applySearch();
      klasseInput.focus();
    });

    this.bindZoom();

    const teacherOverlay = byId('teacher-modal');
    byId('tm-close').addEventListener('click', () => this.closeTeacherModal());
    teacherOverlay.addEventListener('click', (e) => {
      if (e.target === teacherOverlay) this.closeTeacherModal();
    });

    byId('pool-head').addEventListener('dblclick', () => this.openPoolList());
    byId('btn-pool-list').addEventListener('click', () => this.openPoolList());

    // Beim Überfahren einer gekoppelten Karte alle Karten gleicher Kopplung hervorheben.
    document.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-coupling]');
      const id = el?.dataset.coupling;
      if (!id) return;
      for (const m of document.querySelectorAll(`[data-coupling="${CSS.escape(id)}"]`)) m.classList.add('coupling-hl');
    });
    document.addEventListener('mouseout', (e) => {
      if (!(e.target as HTMLElement).closest('[data-coupling]')) return;
      for (const m of document.querySelectorAll('.coupling-hl')) m.classList.remove('coupling-hl');
    });

    byId('btn-couplings').addEventListener('click', () => this.openCouplings());
    const couplingsOverlay = byId('couplings-modal');
    byId('cpl-close').addEventListener('click', () => couplingsOverlay.classList.remove('open'));
    couplingsOverlay.addEventListener('click', (e) => {
      if (e.target === couplingsOverlay) couplingsOverlay.classList.remove('open');
    });

    byId('btn-collisions').addEventListener('click', () => this.openCollisions());
    const collisionsOverlay = byId('collisions-modal');
    byId('col-close').addEventListener('click', () => collisionsOverlay.classList.remove('open'));
    collisionsOverlay.addEventListener('click', (e) => {
      if (e.target === collisionsOverlay) collisionsOverlay.classList.remove('open');
    });

    const planningOverlay = byId('planning-modal');
    byId('plan-cancel').addEventListener('click', () => this.closePlanning());
    planningOverlay.addEventListener('click', (e) => {
      if (e.target === planningOverlay) this.closePlanning();
    });
    byId('plan-unplace').addEventListener('click', () => this.handleUnplace());
    byId('plan-unplace-all').addEventListener('click', () => this.handleUnplaceAll());
    byId('plan-unplace-unlocked').addEventListener('click', () => this.handleUnplaceUnlocked());
    byId('plan-reset-classes').addEventListener('click', () => this.handleResetClasses());
    byId('plan-export').addEventListener('click', () => this.downloadCardsExport());
    byId('plan-rooms').addEventListener('click', () => this.openRooms());
    byId('plan-roomplan').addEventListener('click', () => this.openRoomPlan());

    byId('plan-roomlist').addEventListener('click', () => this.openRoomList());
    const roomlistOverlay = byId('roomlist-modal');
    byId('rl-close').addEventListener('click', () => roomlistOverlay.classList.remove('open'));
    roomlistOverlay.addEventListener('click', (e) => {
      if (e.target === roomlistOverlay) roomlistOverlay.classList.remove('open');
    });
    const rlInput = byId<HTMLInputElement>('rl-input');
    const addRoom = (): void => {
      const name = rlInput.value.trim();
      if (!name) return;
      if (this.state.addRoom(name)) {
        this.toast.show(`✓ Raum „${name}" hinzugefügt`);
      } else {
        this.toast.show(`Raum „${name}" gibt es schon.`, 'inf');
      }
      rlInput.value = '';
      rlInput.focus();
      this.renderRoomList();
    };
    byId('rl-add').addEventListener('click', addRoom);
    rlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addRoom();
    });
    byId('rl-list').addEventListener('click', (e) => {
      const del = (e.target as HTMLElement).closest<HTMLElement>('.rl-del');
      if (!del?.dataset.room) return;
      this.state.removeRoom(del.dataset.room);
      this.renderRoomList();
    });
    byId('rl-template').addEventListener('click', () => this.downloadRoomListTemplate());
    const roomListFile = byId<HTMLInputElement>('rl-import-file');
    byId('rl-import').addEventListener('click', () => roomListFile.click());
    roomListFile.addEventListener('change', () => {
      const file = roomListFile.files?.[0];
      if (file) void this.handleRoomListImport(file);
      roomListFile.value = '';
    });
    const roomplanOverlay = byId('roomplan-modal');
    byId('rp-close').addEventListener('click', () => roomplanOverlay.classList.remove('open'));
    roomplanOverlay.addEventListener('click', (e) => {
      if (e.target === roomplanOverlay) roomplanOverlay.classList.remove('open');
    });

    byId('plan-sched-teacher').addEventListener('click', () => this.openSchedules('teacher'));
    byId('plan-sched-class').addEventListener('click', () => this.openSchedules('class'));
    const schedOverlay = byId('sched-modal');
    byId('sched-close').addEventListener('click', () => schedOverlay.classList.remove('open'));
    schedOverlay.addEventListener('click', (e) => {
      if (e.target === schedOverlay) schedOverlay.classList.remove('open');
    });
    byId('sched-list').addEventListener('click', (e) => {
      const entry = (e.target as HTMLElement).closest<HTMLElement>('.sched-entry');
      if (entry?.dataset.key === undefined) return;
      this.schedSel = entry.dataset.key;
      this.renderSchedList();
      this.renderSchedGrid();
    });
    byId('sched-zoom-out').addEventListener('click', () => this.setSchedZoom(this.schedZoom - 0.15));
    byId('sched-zoom-in').addEventListener('click', () => this.setSchedZoom(this.schedZoom + 0.15));
    byId('sched-zoom-reset').addEventListener('click', () => this.setSchedZoom(1));

    const roomsOverlay = byId('rooms-modal');
    byId('rm-close').addEventListener('click', () => roomsOverlay.classList.remove('open'));
    roomsOverlay.addEventListener('click', (e) => {
      if (e.target === roomsOverlay) roomsOverlay.classList.remove('open');
    });
    byId('rm-list').addEventListener('input', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.room-set');
      if (!inp?.dataset.id) return;
      // Vorschläge: Räume, die mit der Eingabe beginnen und zu dieser Zeit frei sind.
      const rooms = this.state.availableRooms(inp.dataset.id, inp.value);
      byId('rm-room-list').innerHTML = rooms.map((r) => `<option value="${esc(r)}"></option>`).join('');
    });
    byId('rm-list').addEventListener('change', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.room-set');
      if (inp?.dataset.id) this.handleSetRoom(inp.dataset.id, inp.value);
    });
    byId('plan-abbr').addEventListener('input', () => this.updatePlanHint());
    byId('plan-auto').addEventListener('click', () => this.handleAutoPlan());
    byId('plan-replan').addEventListener('click', () => this.handleReplan());
    byId('pp-cancel').addEventListener('click', () => {
      this.planStop = 'cancel';
    });
    byId('pp-accept').addEventListener('click', () => {
      this.planStop = 'accept';
    });
    byId('plan-rules').addEventListener('click', (e) => {
      e.preventDefault();
      void this.downloadPlanningRules();
    });
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
      // Klick ins Kopplungs-Feld nicht als „Karte bearbeiten" werten.
      if ((e.target as HTMLElement).closest('.pl-coupling')) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('.pl-item');
      if (row?.dataset.id) {
        this.closePoolList();
        this.openEditCard(row.dataset.id);
      }
    });
    byId('pl-list').addEventListener('change', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.pl-coupling');
      if (inp?.dataset.id) this.state.setCardCoupling(inp.dataset.id, inp.value);
    });
    byId('pl-template').addEventListener('click', () => this.downloadTemplate());
    const importFile = byId<HTMLInputElement>('pl-import-file');
    byId('pl-import').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files?.[0];
      if (file) void this.handleExcelImport(file);
      importFile.value = '';
    });
    byId('pl-del-abbr').addEventListener('click', () => this.handleDeletePoolByAbbr());
    byId('pl-del-all').addEventListener('click', () => this.handleDeleteAllPool());

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

  // ── Kopplungen ──────────────────────────────────────────────────────────

  private openCouplings(): void {
    this.renderCouplings();
    byId('couplings-modal').classList.add('open');
  }

  private renderCouplings(): void {
    const groups = this.state.couplingGroups();
    byId('cpl-sub').textContent = groups.length
      ? `${groups.length} Kopplung(en) – gleiche ID = gleiche Lehrkraft gleichzeitig in mehreren Klassen`
      : '';
    const list = byId('cpl-list');
    list.innerHTML = groups.length
      ? groups
          .map((g) => {
            const members = g.members.map((m) => this.memberLine(m)).join('<br>');
            return `<div class="cmall-item">
              <div class="cmall-body">
                <div class="cmall-head">🔗 ${esc(g.id)}</div>
                <div class="cmall-text">${members}</div>
              </div>
            </div>`;
          })
          .join('')
      : '<div class="tm-empty">Keine Kopplungen vorhanden.<br>Im Fenster „Nicht verplante Karten" je Karte hinten eine Kopplungs-ID vergeben (gleiche ID = gekoppelt).</div>';
  }

  /** Eine Karten-Zeile mit Klasse/Fach und – falls platziert – Tag und Stunde. */
  private memberLine(m: CardWithPlace): string {
    const head = `${esc(m.abbr)}${m.fach ? ` ${esc(m.fach)}` : ''}${m.klasse ? ` · ${esc(m.klasse)}` : ''}`;
    let where: string;
    if (m.day === undefined || m.startPeriod === undefined) {
      where = 'im Pool';
    } else {
      const end = m.startPeriod + (m.duration ?? 1) - 1;
      const range = end > m.startPeriod ? `${m.startPeriod}.–${end}.` : `${m.startPeriod}.`;
      where = `${DAYS[m.day]}, ${range} Std.${m.week ? ` (${m.week})` : ''}`;
    }
    return `${head} <span style="color:var(--muted)">→ ${where}</span>`;
  }

  // ── Kollisionen ─────────────────────────────────────────────────────────

  private openCollisions(): void {
    const cards = this.state.collisionCards();
    byId('col-sub').textContent = cards.length ? `${cards.length} Karte(n) mit erlaubter Kollision` : '';
    byId('col-list').innerHTML = cards.length
      ? cards
          .map(
            (m) => `<div class="cmall-item"><div class="cmall-body">
              <div class="cmall-text">💥 ${this.memberLine(m)}</div>
            </div></div>`,
          )
          .join('')
      : '<div class="tm-empty">Keine Karten mit aktiver Kollision.<br>Beim Erstellen einer Karte die Checkbox „💥 Kollision erlaubt" aktivieren.</div>';
    byId('collisions-modal').classList.add('open');
  }

  // ── Räume (Karten ohne Raum) ────────────────────────────────────────────

  private openRooms(): void {
    this.renderRooms();
    byId('rooms-modal').classList.add('open');
  }

  private renderRooms(): void {
    const cards = this.state.roomlessCards();
    byId('rm-sub').textContent = cards.length
      ? `${cards.length} Karte(n) ohne Raum – Raum eintragen (verplante werden auf Verfügbarkeit geprüft)`
      : '';
    byId('rm-list').innerHTML = cards.length
      ? cards
          .map(
            (m) => `<div class="pl-item" style="cursor:default">
              <span class="pl-meta" style="flex:1">${this.memberLine(m)}</span>
              <input class="room-set" data-id="${esc(m.id)}" placeholder="Raum (tippen: freie Räume)" list="rm-room-list" autocomplete="off" />
            </div>`,
          )
          .join('')
      : '<div class="tm-empty">Alle Karten haben einen Raum. 🎉</div>';
  }

  /** Setzt den Raum einer Karte und meldet ggf. einen Belegungs-Konflikt. */
  private handleSetRoom(id: string, room: string): void {
    const res = this.state.setRoom(id, room);
    if (!res.ok) return;
    if (res.conflictAbbr) {
      this.toast.show(`⚠️ Raum „${room.trim()}" ist zu dieser Zeit schon bei ${res.conflictAbbr} belegt.`, 'inf');
    } else if (room.trim()) {
      this.toast.show(`✓ Raum „${room.trim()}" gesetzt`);
    }
    this.renderRooms();
  }

  /** Excel-Vorlage für die Raumliste: eine Spalte „Raum" (mit den aktuellen Räumen). */
  private downloadRoomListTemplate(): void {
    const rooms = this.state.roomList();
    const aoa: (string | number)[][] = [['Raum'], ...(rooms.length ? rooms.map((r) => [r]) : [['C103'], ['A12'], ['Halle']])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Räume');
    XLSX.writeFile(wb, 'Raumliste-Vorlage.xlsx');
  }

  /** Liest eine Excel-Tabelle (eine Spalte mit Raumnamen) in die Raumliste ein. */
  private async handleRoomListImport(file: File): Promise<void> {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' }) as unknown[][];
      let added = 0;
      for (const row of rows) {
        const name = String(row?.[0] ?? '').trim();
        // Überschrift „Raum"/„Räume"/„Room" überspringen.
        if (!name || ['raum', 'räume', 'raeume', 'room', 'rooms'].includes(name.toLowerCase())) continue;
        if (this.state.addRoom(name)) added++;
      }
      this.renderRoomList();
      this.toast.show(added ? `✓ ${added} Räume importiert` : 'Keine neuen Räume gefunden.', added ? 'ok' : 'inf');
    } catch {
      this.toast.show('Datei konnte nicht gelesen werden (Excel/CSV?).', 'inf');
    }
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
            <input class="pl-coupling" data-id="${esc(c.id)}" value="${esc(c.coupling)}" placeholder="🔗 Kopplung" autocomplete="off"
                   title="Kopplungs-ID – gleiche ID = gleichzeitig in mehreren Klassen (zählt 1×)" />
          </div>`;
      })
      .join('');
  }

  private closePoolList(): void {
    byId('pool-list-modal').classList.remove('open');
  }

  /** Sicherheitsabfrage: erfordert die Eingabe von „Ja". */
  private confirmJa(message: string): boolean {
    const answer = prompt(`${message}\n\nZum Bestätigen „Ja" eingeben:`);
    if (answer === null) return false;
    if (answer.trim().toLowerCase() !== 'ja') {
      this.toast.show('Abgebrochen – es wurde nicht „Ja" eingegeben.', 'inf');
      return false;
    }
    return true;
  }

  /** Löscht die zum gesuchten Kürzel passenden nicht verplanten Karten. */
  private handleDeletePoolByAbbr(): void {
    const term = byId<HTMLInputElement>('pl-abbr').value.trim().toLowerCase();
    if (!term) {
      this.toast.show('Bitte oben ein Kürzel eingeben.', 'inf');
      return;
    }
    const matches = this.state.pool.all.filter((c) => c.abbr.toLowerCase().includes(term));
    if (!matches.length) {
      this.toast.show(`Keine nicht verplanten Karten zu „${term}".`, 'inf');
      return;
    }
    if (!this.confirmJa(`${matches.length} nicht verplante Karten zu „${term}" löschen?`)) return;
    const n = this.state.deletePoolCards(matches.map((c) => c.id));
    this.renderPoolList();
    this.toast.show(`🗑 ${n} Karten gelöscht`, 'inf');
  }

  /** Löscht alle nicht verplanten (Pool-)Karten. */
  private handleDeleteAllPool(): void {
    const all = this.state.pool.all;
    if (!all.length) {
      this.toast.show('Keine nicht verplanten Karten vorhanden.', 'inf');
      return;
    }
    if (!this.confirmJa(`Alle ${all.length} nicht verplanten Karten löschen?`)) return;
    const n = this.state.deletePoolCards(all.map((c) => c.id));
    this.renderPoolList();
    this.toast.show(`🗑 ${n} Karten gelöscht`, 'inf');
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
      this.state.fillCardColors(cards);
      this.state.importCards(cards);
      this.renderPoolList();
      this.toast.show(`✓ ${cards.length} Karten importiert`);
    } catch {
      this.toast.show('Datei konnte nicht gelesen werden (Excel/CSV?).', 'inf');
    }
  }

  /** Lädt die Planungsregeln als Word-Dokument (.docx) herunter. */
  private async downloadPlanningRules(): Promise<void> {
    // Markdown-Zeilen grob in Word-Absätze übersetzen (Überschriften, Listen, Text).
    const paragraphs = planningRulesText.split(/\r?\n/).map((raw) => {
      const line = raw.replace(/\*\*/g, '').trimEnd();
      if (line.startsWith('### ')) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 });
      if (line.startsWith('## ')) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 });
      if (line.startsWith('# ')) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 });
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) return new Paragraph({ text: bullet[1], bullet: { level: 0 } });
      return new Paragraph({ children: [new TextRun(line)] });
    });

    const doc = new Document({ sections: [{ children: paragraphs }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Planungsregeln.docx';
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('📄 Planungsregeln (Word) heruntergeladen');
  }

  /** Exportiert alle Karten (Pool + Plan) als Excel, sortiert nach Klasse und Lehrer. */
  private downloadCardsExport(): void {
    const rows = this.state.allCardsForExport();
    if (!rows.length) {
      this.toast.show('Keine Karten zum Exportieren vorhanden.', 'inf');
      return;
    }
    const yn = (b: boolean): string => (b ? 'x' : '');
    const header = [
      'Klasse', 'Kürzel', 'Fach', 'Raum', 'Dauer', 'Labor', 'Gruppe a/b', 'Werkstatt', '4-wöchig',
      '1. Halbjahr', '2. Halbjahr', 'Kopplung', 'Nicht zählen', 'Kollision', 'Status', 'Tag', 'Stunde', 'Woche', 'Kommentar',
    ];
    const aoa: (string | number)[][] = [header];
    for (const r of rows) {
      const stunde =
        r.startPeriod === null ? '' : r.duration > 1 ? `${r.startPeriod}–${r.startPeriod + r.duration - 1}` : `${r.startPeriod}`;
      aoa.push([
        r.klasse, r.abbr, r.fach, r.room, r.duration, yn(r.isLabor), r.labGroup, yn(r.isWerkstatt), yn(r.isVierwoechig),
        yn(r.firstHalf), yn(r.secondHalf), r.coupling, yn(r.noCount), yn(r.collision),
        r.placed ? 'verplant' : 'Pool', r.day === null ? '' : DAYS[r.day], stunde, r.week ?? '', r.comment,
      ]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Karten');
    XLSX.writeFile(wb, 'Karten-Export.xlsx');
    this.toast.show(`📤 ${rows.length} Karten exportiert`);
  }

  // ── Raumliste ───────────────────────────────────────────────────────────

  private openRoomList(): void {
    this.renderRoomList();
    byId('roomlist-modal').classList.add('open');
  }

  private renderRoomList(): void {
    const rooms = this.state.roomList();
    const usage = new Map<string, number>();
    const bump = (r: string): void => {
      const k = r.trim();
      if (k) usage.set(k, (usage.get(k) ?? 0) + 1);
    };
    for (const c of this.state.pool.all) bump(c.room);
    for (const p of this.state.schedule.all) bump(p.room);
    byId('rl-sub').textContent = rooms.length ? `${rooms.length} Räume (verwendete können nicht gelöscht werden)` : '';
    byId('rl-list').innerHTML = rooms.length
      ? rooms
          .map((r) => {
            const n = usage.get(r) ?? 0;
            const right =
              n > 0
                ? `<span class="pl-badges">${n}× verwendet</span>`
                : `<button class="rl-del btn btn-del" data-room="${esc(r)}" style="padding:3px 10px">Löschen</button>`;
            return `<div class="pl-item" style="cursor:default"><span class="pl-abbr" style="flex:1">${esc(r)}</span>${right}</div>`;
          })
          .join('')
      : '<div class="tm-empty">Noch keine Räume. Oben einen Raum hinzufügen.</div>';
  }

  // ── Raumplan ────────────────────────────────────────────────────────────

  private openRoomPlan(): void {
    this.renderRoomPlan();
    byId('roomplan-modal').classList.add('open');
  }

  /** Read-only-Überblick: Belegung aller Räume (Räume als Spalten, Tag/Stunde als Zeilen). */
  private renderRoomPlan(): void {
    const placed = this.state.schedule.all.filter((p) => p.room.trim());
    const rooms = this.state.roomList();
    byId('rp-sub').textContent = rooms.length
      ? `${rooms.length} Räume · ${placed.length} verplante Karten mit Raum`
      : '';
    if (!rooms.length) {
      byId('rp-body').innerHTML =
        '<div class="tm-empty">Noch keine Räume vorhanden.<br>Räume unter „🏫 Raumliste" anlegen oder Karten einen Raum geben.</div>';
      return;
    }
    const side = (arr: typeof placed): string =>
      arr
        .map(
          (pl) =>
            `<span class="rp-chip${arr.length > 1 ? ' rp-multi' : ''}" style="background:${pl.color};color:${ink(pl.color)}"` +
            ` title="${esc(pl.klasse || pl.abbr)}${pl.abbr ? ` · ${esc(pl.abbr)}` : ''}${pl.fach ? ` · ${esc(pl.fach)}` : ''} – ${DAYS[pl.day]} ${pl.startPeriod}. Std (${pl.week})">${esc(pl.klasse || pl.abbr)}</span>`,
        )
        .join('');
    let body =
      '<table class="rp-table"><thead><tr><th class="rp-corner" colspan="2">Tag / Std</th>' +
      rooms.map((r) => `<th class="rp-room">${esc(r)}</th>`).join('') +
      '</tr></thead><tbody>';
    for (let d = 0; d < DAYS.length; d++) {
      for (let p = 1; p <= PERIODS; p++) {
        body += '<tr>';
        if (p === 1) body += `<td class="rp-day" rowspan="${PERIODS}">${esc(DAYS[d])}</td>`;
        body += `<td class="rp-per">${p}</td>`;
        for (const r of rooms) {
          const u = placed.filter((pl) => pl.room.trim() === r && pl.day === d && pl.week === 'u' && pl.covers(p));
          const g = placed.filter((pl) => pl.room.trim() === r && pl.day === d && pl.week === 'g' && pl.covers(p));
          body += `<td class="rp-cell"><div class="rp-ug"><div class="rp-side rp-u">${side(u)}</div><div class="rp-side rp-g">${side(g)}</div></div></td>`;
        }
        body += '</tr>';
      }
    }
    byId('rp-body').innerHTML = body + '</tbody></table>';
  }

  // ── Stundenpläne (je Lehrkraft / Klasse) ────────────────────────────────

  private openSchedules(mode: 'teacher' | 'class'): void {
    this.schedMode = mode;
    byId('sched-title').textContent =
      mode === 'teacher' ? '👩‍🏫 Stundenpläne der Lehrkräfte' : '🎓 Stundenpläne der Klassen';
    const entries = this.schedEntries();
    this.schedSel = entries.length ? entries[0].key : '';
    this.renderSchedList();
    this.renderSchedGrid();
    byId('sched-modal').classList.add('open');
  }

  /** Listeneinträge links: Lehrkräfte (Kürzel + Name) bzw. Klassennamen. */
  private schedEntries(): { key: string; label: string }[] {
    if (this.schedMode === 'teacher') {
      const map = new Map<string, string>();
      for (const c of this.state.pool.all) if (!map.has(c.abbr)) map.set(c.abbr, c.name);
      for (const p of this.state.schedule.all) if (!map.has(p.abbr)) map.set(p.abbr, p.name);
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'de'))
        .map(([abbr, name]) => ({ key: abbr, label: name ? `${esc(abbr)} <small>– ${esc(name)}</small>` : esc(abbr) }));
    }
    const set = new Set<string>();
    for (const p of this.state.schedule.all) if (p.klasse.trim()) set.add(p.klasse.trim());
    for (let c = 0; c < this.state.classes.count; c++) {
      for (let d = 0; d < DAYS.length; d++) {
        for (const w of ['u', 'g'] as const) {
          const n = this.state.classes.classNameAt(c, d, w).trim();
          if (n) set.add(n);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'de')).map((n) => ({ key: n, label: esc(n) }));
  }

  private renderSchedList(): void {
    const entries = this.schedEntries();
    if (entries.length && !entries.some((e) => e.key === this.schedSel)) this.schedSel = entries[0].key;
    byId('sched-list').innerHTML = entries.length
      ? entries
          .map((e) => `<div class="sched-entry${e.key === this.schedSel ? ' on' : ''}" data-key="${esc(e.key)}">${e.label}</div>`)
          .join('')
      : `<div class="tm-empty">${this.schedMode === 'teacher' ? 'Keine Lehrkräfte' : 'Keine Klassen'} vorhanden.</div>`;
  }

  /** Stundenplan-Raster der aktuellen Auswahl: Stunden × Tage (u | g). */
  private renderSchedGrid(): void {
    const grid = byId('sched-grid');
    if (!this.schedSel) {
      grid.innerHTML = '<div class="tm-empty">Links auswählen …</div>';
      return;
    }
    const teacher = this.schedMode === 'teacher';
    const sel = this.schedSel;
    const placed = this.state.schedule.all.filter((p) => (teacher ? p.abbr === sel : p.klasse.trim() === sel));
    const side = (arr: Placement[]): string =>
      arr
        .map((pl) => {
          const main = teacher ? pl.klasse || '—' : pl.abbr;
          const sub = [pl.fach, pl.room].filter(Boolean).map((x) => esc(x)).join(' · ');
          const tip = `${esc(pl.abbr)}${pl.klasse ? ` · ${esc(pl.klasse)}` : ''}${pl.fach ? ` · ${esc(pl.fach)}` : ''}${pl.room ? ` · ${esc(pl.room)}` : ''} – ${DAYS[pl.day]} ${pl.startPeriod}. Std (${pl.week})`;
          return `<span class="sched-chip" style="background:${pl.color};color:${ink(pl.color)}" title="${tip}">${esc(main)}${sub ? `<small>${sub}</small>` : ''}</span>`;
        })
        .join('');
    // Feste, gleiche Spaltenbreiten (sonst wird eine leere Spalte riesig).
    const cols = `<colgroup><col style="width:42px" />${DAYS.map(() => '<col style="width:66px" /><col style="width:66px" />').join('')}</colgroup>`;
    const totalW = 42 + DAYS.length * 2 * 66;
    let body =
      `<table class="sched-table" style="width:${totalW}px">${cols}<thead><tr><th class="sched-head" rowspan="2">Std</th>` +
      DAYS.map((d) => `<th class="sched-head" colspan="2">${esc(d)}</th>`).join('') +
      '</tr><tr>' +
      DAYS.map(() => '<th class="sched-sub">u</th><th class="sched-sub">g</th>').join('') +
      '</tr></thead><tbody>';
    for (let p = 1; p <= PERIODS; p++) {
      body += `<tr><td class="sched-per">${p}</td>`;
      for (let d = 0; d < DAYS.length; d++) {
        const u = placed.filter((pl) => pl.day === d && pl.week === 'u' && pl.covers(p));
        const g = placed.filter((pl) => pl.day === d && pl.week === 'g' && pl.covers(p));
        body += `<td class="sched-cell"><div class="sched-ug"><div class="sched-side u">${side(u)}</div><div class="sched-side g">${side(g)}</div></div></td>`;
      }
      body += '</tr>';
    }
    grid.innerHTML = body + '</tbody></table>';
    this.applySchedZoom();
  }

  /** Stellt den Zoom des Stundenplan-Rasters ein (CSS-Zoom auf der Tabelle). */
  private setSchedZoom(z: number): void {
    this.schedZoom = Math.min(2.5, Math.max(0.5, Math.round(z * 100) / 100));
    this.applySchedZoom();
  }

  private applySchedZoom(): void {
    const table = byId('sched-grid').querySelector<HTMLElement>('table');
    if (table) table.style.zoom = String(this.schedZoom);
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
    // Kollisions-Karten dürfen bewusst auf belegte Stellen (außer über Stunde 9).
    if (dragData.card.collision && collision.type !== 'overflow') {
      this.placeDrag(dragData, pos);
      return;
    }
    if (collision.type === 'class') {
      if (dragData.card.isLabor || dragData.card.isWerkstatt || dragData.card.isVierwoechig || dragData.card.noCount) {
        // Labor-/Werkstatt-/4-wöchig-/Block-Karten stapeln ohne Rückfrage
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

  /** Öffnet das Planungsfenster mit Kürzel-Suche fürs Entplanen. */
  private openPlanning(): void {
    const input = byId<HTMLInputElement>('plan-abbr');
    input.value = '';
    byId('plan-abbr-list').innerHTML = this.state
      .placedCountsByAbbr()
      .map((o) => `<option value="${esc(o.abbr)}">${esc(o.abbr)} (${o.count})</option>`)
      .join('');
    this.updatePlanHint();
    byId('planning-modal').classList.add('open');
  }

  private closePlanning(): void {
    byId('planning-modal').classList.remove('open');
  }

  /** Zeigt unter dem Suchfeld, wie viele Karten zum Kürzel entplant würden. */
  private updatePlanHint(): void {
    const total = this.state.totalPlacedCount;
    const term = byId<HTMLInputElement>('plan-abbr').value.trim().toLowerCase();
    const hint = byId('plan-sub');
    if (!total) {
      hint.textContent = 'Keine Karten platziert.';
      return;
    }
    if (!term) {
      hint.textContent = `${total} Karten platziert. Kürzel eingeben oder „Alle entplanen".`;
      return;
    }
    const n = this.state.schedule.all.filter((p) => p.abbr.toLowerCase().includes(term)).length;
    hint.textContent = n ? `${n} Karten zu „${term}" werden entplant.` : `Keine platzierten Karten zu „${term}".`;
  }

  /** Entplant alle platzierten Karten, deren Kürzel zur Suche passt. */
  private handleUnplace(): void {
    const term = byId<HTMLInputElement>('plan-abbr').value.trim().toLowerCase();
    if (!term) {
      this.toast.show('Bitte ein Kürzel eingeben (oder „Alle entplanen").', 'inf');
      return;
    }
    const matches = this.state.schedule.all.filter((p) => p.abbr.toLowerCase().includes(term));
    if (!matches.length) {
      this.toast.show(`Keine platzierten Karten zu „${term}".`, 'inf');
      return;
    }
    if (!this.confirmJa(`${matches.length} Karten zu „${term}" entplanen (zurück in den Pool)?`)) return;
    const abbrs = [...new Set(matches.map((p) => p.abbr))];
    let n = 0;
    for (const abbr of abbrs) n += this.state.unplaceByAbbr(abbr);
    this.closePlanning();
    this.toast.show(`↩ ${n} Karten entplant`, 'inf');
  }

  /** Entplant alle platzierten Karten („Ja"-Bestätigung). */
  private handleUnplaceAll(): void {
    if (!this.state.totalPlacedCount) {
      this.closePlanning();
      return;
    }
    if (!this.confirmJa(`Alle ${this.state.totalPlacedCount} platzierten Karten zurück in den Pool (entplanen)?`)) return;
    const n = this.state.unplaceAll();
    this.closePlanning();
    this.toast.show(`↩ ${n} Karten entplant`, 'inf');
  }

  /** Setzt alle Klassen-Spalten auf den leeren Standard zurück („Ja"-Bestätigung). */
  private handleResetClasses(): void {
    if (
      !this.confirmJa(
        'Alle Klassennamen und -farben zurücksetzen?\nDie Spalten zeigen dann wieder den Standard (u+g / u / g). Platzierte Karten bleiben erhalten.',
      )
    )
      return;
    this.state.resetAllClasses();
    this.closePlanning();
    this.toast.show('🧹 Klassen zurückgesetzt', 'inf');
  }

  /** Entplant alle Karten außer den fixierten („Ja"-Bestätigung). */
  private handleUnplaceUnlocked(): void {
    const total = this.state.totalPlacedCount;
    const locked = this.state.lockedPlacedCount;
    const toUnplace = total - locked;
    if (!toUnplace) {
      this.toast.show(locked ? 'Alle platzierten Karten sind fixiert.' : 'Keine Karten platziert.', 'inf');
      return;
    }
    if (!this.confirmJa(`${toUnplace} Karten entplanen? ${locked} fixierte Karte(n) bleiben liegen.`)) return;
    const n = this.state.unplaceUnlocked();
    this.closePlanning();
    this.toast.show(`↩ ${n} Karten entplant (${locked} fixiert behalten)`, 'inf');
  }

  /** Verplant die freien Pool-Karten automatisch und meldet das Ergebnis. */
  private handleAutoPlan(): void {
    if (this.state.pool.isEmpty) {
      this.toast.show('Keine freien Karten im Pool.', 'inf');
      return;
    }
    const free = this.state.pool.all.length;
    if (!confirm(`${free} freie Karten automatisch nach den Planungsregeln verplanen?`)) return;
    void this.runPlanning(false);
  }

  /**
   * Plant erneut: entplant alle nicht fixierten Karten und verteilt anschließend
   * alles neu. Nur fixierte (Schloss) Karten bleiben unverändert liegen.
   */
  private handleReplan(): void {
    if (!this.state.totalPlacedCount && this.state.pool.isEmpty) {
      this.toast.show('Keine Karten vorhanden.', 'inf');
      return;
    }
    const locked = this.state.lockedPlacedCount;
    const lockedNote = locked ? ` ${locked} fixierte Karte(n) bleiben liegen.` : '';
    if (!this.confirmJa(`Erneut planen? Alle nicht fixierten Karten werden neu verteilt.${lockedNote}`)) return;
    void this.runPlanning(true);
  }

  /**
   * Führt einen (ggf. minutenlangen) Planungslauf aus: optional vorher alles außer
   * fixierte entplanen, dann asynchron rechnen lassen (UI bleibt bedienbar über das
   * Fortschritts-Fenster). Abbruch stellt den Ausgangszustand wieder her.
   */
  private async runPlanning(replan: boolean): Promise<void> {
    this.closePlanning();
    const snapshot = this.state.toJSON(); // für „Abbrechen"
    if (replan) this.state.unplaceUnlocked();
    if (this.state.pool.isEmpty) {
      this.toast.show('Keine freien Karten zum Verplanen.', 'inf');
      return;
    }

    this.planStop = 'continue';
    byId('pp-status').textContent = 'Starte…';
    byId('plan-progress').classList.add('open');

    const budgetMs = 10 * 60 * 1000; // bis zu 10 Minuten suchen
    let res: PlanRunResult;
    try {
      res = await this.state.planBest({
        budgetMs,
        shouldStop: () => this.planStop,
        onProgress: (p) => this.updatePlanProgress(p),
      });
    } finally {
      byId('plan-progress').classList.remove('open');
    }

    if (res.cancelled) {
      this.state.loadFrom(snapshot); // Ausgangszustand wiederherstellen
      this.toast.show('Planung abgebrochen.', 'inf');
      return;
    }

    const total = res.placed + res.skipped.length;
    const parts = [`✓ ${res.placed} von ${total} verplant`];
    if (res.skipped.length) parts.push(`${res.skipped.length} nicht platzierbar`);
    if (res.openMandatory) parts.push(`${res.openMandatory} Pflichtstunden offen`);
    this.toast.show(parts.join(' · '), res.solved ? 'ok' : 'inf');

    if (!res.solved) {
      const mins = Math.round(res.elapsedMs / 60000);
      alert(
        `⚠️ Es wurde keine Lösung gefunden, die alle Bedingungen erfüllt` +
          (mins >= 1 ? ` (Suche ${mins} Min)` : '') +
          `.\nDas beste gefundene Ergebnis wurde übernommen – siehe folgende Hinweise.`,
      );
    }

    if (res.skipped.length) {
      // Gründe gebündelt ausgeben, damit der Nutzer nachbessern kann.
      const byReason = new Map<string, string[]>();
      for (const s of res.skipped) {
        const list = byReason.get(s.reason) ?? [];
        list.push(s.card);
        byReason.set(s.reason, list);
      }
      const lines = [...byReason.entries()].map(([reason, cards]) => `• ${reason}: ${cards.join(', ')}`);
      alert(`Nicht platzierbare Karten (bleiben im Pool):\n\n${lines.join('\n')}`);
    }

    if (res.weekImbalance.length) {
      const lines = res.weekImbalance.map(
        (t) => `• ${t.abbr}: u ${t.u} Std / g ${t.g} Std (Differenz ${Math.abs(t.u - t.g)})`,
      );
      alert(
        `⚠️ Unausgeglichene u/g-Verteilung (Differenz > 2 Stunden):\n\n${lines.join('\n')}\n\n` +
          'Bitte diese Lehrkräfte von Hand ausgleichen.',
      );
    }

    if (res.weekGaps.length) {
      const lines = res.weekGaps.map((t) => `• ${t.abbr} (${t.week}-Woche): ${t.gaps} Hohlstunden`);
      alert(
        `⚠️ Zu viele Hohlstunden (mehr als 6 pro Woche):\n\n${lines.join('\n')}\n\n` +
          'Bitte diese Lehrkräfte von Hand entzerren.',
      );
    }
  }

  /** Aktualisiert das Fortschritts-Fenster während der Planung. */
  private updatePlanProgress(p: PlanProgress): void {
    const sec = Math.floor(p.elapsedMs / 1000);
    const time = sec >= 60 ? `${Math.floor(sec / 60)} Min ${sec % 60} s` : `${sec} s`;
    byId('pp-status').textContent =
      `Zeit: ${time} · Versuche: ${p.attempts.toLocaleString('de-DE')}\n` +
      `Beste Lösung: ${p.placed}/${p.total} Karten verplant` +
      (p.skipped ? `, ${p.skipped} noch offen` : '') +
      `\nu/g-Differenz über Limit: ${p.imbalance} Std` +
      `\nHohlstunden über Limit: ${p.gaps} Std`;
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
