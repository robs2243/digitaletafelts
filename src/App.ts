import { AppState } from './domain/AppState';
import { DAYS } from './domain/constants';
import type { CardProps, PlacementPosition } from './domain/types';
import { StorageService } from './services/StorageService';
import { CardModal } from './ui/CardModal';
import { CollisionModal } from './ui/CollisionModal';
import { CommentModal } from './ui/CommentModal';
import { collisionMessage } from './ui/collisionMessages';
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
  private readonly drag = new DragController();

  private readonly toast: Toast;
  private readonly saveBadge: SaveBadge;
  private readonly poolView: PoolView;
  private readonly statsView: StatsView;
  private readonly timetableView: TimetableView;
  private readonly cardModal: CardModal;
  private readonly collisionModal: CollisionModal;
  private readonly commentModal: CommentModal;

  constructor() {
    const persisted = this.storage.load();
    this.state = persisted ? AppState.fromJSON(persisted) : AppState.createDefault();

    this.toast = new Toast(byId('toast'));
    this.saveBadge = new SaveBadge(byId('sbadge'));
    this.statsView = new StatsView(byId('stats'), this.state);
    this.collisionModal = new CollisionModal();
    this.commentModal = new CommentModal();

    this.poolView = new PoolView(byId('pool'), this.state, this.drag, {
      onEdit: (id) => this.openEditCard(id),
      onComment: (id) => this.openCardComment(id),
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
      onRenameClass: (idx, name, commit) => this.state.renameClass(idx, name, { render: commit }),
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
  }

  private bindGlobalControls(): void {
    byId('btn-add-class').addEventListener('click', () => this.handleAddClass());
    byId('btn-new-card').addEventListener('click', () => this.cardModal.openForCreate(this.state.suggestFreeColor()));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cardModal.close();
        this.collisionModal.close();
        this.commentModal.close();
      }
      if (e.key === 'Enter' && this.cardModal.isOpen) this.cardModal.submit();
    });
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────

  private handleDrop(pos: PlacementPosition): void {
    const dragData = this.drag.active;
    if (!dragData) return;

    const excludeId = dragData.source === 'grid' ? dragData.id : undefined;
    const collision = this.state.schedule.checkSlot(dragData.card, pos, excludeId);

    if (!collision) {
      this.placeDrag(dragData, pos);
      return;
    }
    if (collision.type === 'class') {
      if (dragData.card.isLabor) {
        // Labor-Karten stapeln ohne Rückfrage
        this.placeDrag(dragData, pos);
      } else {
        const msg = collisionMessage(collision, pos, dragData.card.abbr, this.state.classes.all);
        // dragData ist ein Snapshot und bleibt bis zur Bestätigung gültig
        this.collisionModal.show({ messageHtml: msg, canStack: true, onStack: () => this.placeDrag(dragData, pos) });
      }
      return;
    }
    const msg = collisionMessage(collision, pos, dragData.card.abbr, this.state.classes.all);
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

  private handleAddClass(): void {
    this.state.addClass();
    // Frisch angelegte Klasse direkt zum Umbenennen fokussieren
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('.cls-inp');
      const last = inputs[inputs.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    }, 60);
  }

  private handleDeleteClass(idx: number): void {
    const name = this.state.classes.nameAt(idx);
    const hasEntries = this.state.hasPlacementsForClass(idx);
    const warning = hasEntries ? '\n\n⚠️ Bestehende Einträge werden mitgelöscht!' : '';
    if (!confirm(`Klasse „${name}" löschen?${warning}`)) return;
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
    const labor = props.isLabor ? ' ⚗' : '';
    const fach = props.fach ? ` – ${props.fach}` : '';
    this.toast.show(`✓ ${props.abbr}${fach}${labor} gespeichert`);
    return true;
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
