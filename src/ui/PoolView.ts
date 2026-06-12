import type { AppState } from '../domain/AppState';
import { ink } from '../utils/color';
import { esc } from '../utils/html';
import { DragController } from './DragController';

export interface PoolViewHandlers {
  onEdit: (cardId: string) => void;
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
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.tc-editbtn');
      const cardEl = btn?.closest<HTMLElement>('.tc');
      if (btn && cardEl?.dataset.id) this.handlers.onEdit(cardEl.dataset.id);
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
        return `<div class="tc${c.isLabor ? ' labor-card' : ''}" data-id="${c.id}"
              style="background:${c.color};color:${fg}" draggable="true">
            <span class="tc-dur">${c.duration}h</span>
            ${c.isLabor ? '<span class="labor-badge">⚗</span>' : ''}
            <div class="tc-abbr" style="${c.isLabor ? 'margin-top:10px' : ''}">${esc(c.abbr)}</div>
            ${c.fach ? `<div class="tc-sub">${esc(c.fach)}</div>` : ''}
            ${c.name && !c.fach ? `<div class="tc-sub">${esc(c.name)}</div>` : ''}
            ${c.name && c.fach ? `<div class="tc-sub2">${esc(c.name)}</div>` : ''}
            <button class="tc-editbtn" title="Bearbeiten">✎</button>
          </div>`;
      })
      .join('');
  }
}
