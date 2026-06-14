import type { AppState } from '../domain/AppState';
import { semesterLabel } from '../domain/semester';
import { ink } from '../utils/color';
import { esc } from '../utils/html';
import { DragController } from './DragController';

export interface PoolViewHandlers {
  onEdit: (cardId: string) => void;
  onComment: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onDragEnd: () => void;
}

/** Seitenleisten-Pool mit den noch nicht platzierten Karten. */
export class PoolView {
  private readonly el: HTMLElement;
  private readonly state: AppState;
  private readonly drag: DragController;
  private readonly handlers: PoolViewHandlers;

  constructor(el: HTMLElement, state: AppState, drag: DragController, handlers: PoolViewHandlers) {
    this.el = el;
    this.state = state;
    this.drag = drag;
    this.handlers = handlers;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const delBtn = target.closest<HTMLElement>('.tc-delbtn');
      const delCard = delBtn?.closest<HTMLElement>('.tc');
      if (delBtn && delCard?.dataset.id) {
        this.handlers.onDelete(delCard.dataset.id);
        return;
      }
      const editBtn = target.closest<HTMLElement>('.tc-editbtn');
      const editCard = editBtn?.closest<HTMLElement>('.tc');
      if (editBtn && editCard?.dataset.id) this.handlers.onEdit(editCard.dataset.id);
    });

    this.el.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.tc-editbtn') || target.closest('.tc-delbtn')) return;
      const cardEl = target.closest<HTMLElement>('.tc');
      if (cardEl?.dataset.id) this.handlers.onComment(cardEl.dataset.id);
    });

    this.el.addEventListener('dragstart', (e) => {
      const cardEl = (e.target as HTMLElement).closest<HTMLElement>('.tc');
      const id = cardEl?.dataset.id;
      if (!cardEl || !id) return;
      const card = this.state.pool.findById(id);
      if (!card) return;
      this.drag.start({ source: 'pool', id, card: card.snapshot() });
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      // Erst nach dem Erstellen des Drag-Abbilds ausblenden
      setTimeout(() => cardEl.classList.add('dragging'), 0);
    });

    this.el.addEventListener('dragend', () => {
      this.drag.end();
      this.handlers.onDragEnd();
    });
  }

  render(): void {
    if (this.state.pool.isEmpty) {
      this.el.innerHTML = '<div class="pool-empty">Pool leer.<br>Klicke <b>+</b> um eine<br>Karte zu erstellen.</div>';
      return;
    }
    this.el.innerHTML = this.state.pool.all
      .map((c) => {
        const fg = ink(c.color);
        const half = semesterLabel(c);
        const badge = c.isLabor ? '⚗' : c.isWerkstatt ? '🔧' : '';
        const cardCls = c.isLabor ? ' labor-card' : c.isWerkstatt ? ' werkstatt-card' : '';
        return `<div class="tc${cardCls}" data-id="${c.id}" data-abbr="${esc(c.abbr)}" data-room="${esc(c.room)}" data-labor="${c.isLabor ? '1' : '0'}" data-werkstatt="${c.isWerkstatt ? '1' : '0'}"
              style="background:${c.color};color:${fg}" draggable="true">
            <span class="tc-dur">${c.duration}h</span>
            ${badge ? `<span class="labor-badge">${badge}</span>` : ''}
            ${half ? `<span class="tc-half">${half}</span>` : ''}
            ${c.klasse ? `<div class="tc-klasse">${esc(c.klasse)}</div>` : ''}
            <div class="tc-abbr" style="${badge ? 'margin-top:10px' : ''}">${esc(c.abbr)}</div>
            ${c.fach ? `<div class="tc-sub">${esc(c.fach)}</div>` : ''}
            ${c.name && !c.fach ? `<div class="tc-sub">${esc(c.name)}</div>` : ''}
            ${c.name && c.fach ? `<div class="tc-sub2">${esc(c.name)}</div>` : ''}
            ${c.room ? `<div class="tc-sub2">${esc(c.room)}</div>` : ''}
            ${c.comment ? `<span class="tc-comment" title="${esc(c.comment)}">💬</span>` : ''}
            <button class="tc-editbtn" title="Bearbeiten">✎</button>
            <button class="tc-delbtn" title="Karte löschen">✕</button>
          </div>`;
      })
      .join('');
  }
}
