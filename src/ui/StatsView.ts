import type { AppState } from '../domain/AppState';
import { esc } from '../utils/html';

export interface StatsViewHandlers {
  /** Klick auf eine Zeile: alle Stunden dieser Lehrkraft anzeigen. */
  onSelect: (abbr: string) => void;
}

/** Zahl deutsch formatieren: ganze Zahl oder eine Nachkommastelle mit Komma. */
function fmt(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');
}

/** Stunden-Übersicht: je Kürzel Stunden in u- und g-Woche + Schnitt (Deputat). */
export class StatsView {
  private readonly el: HTMLElement;
  private readonly state: AppState;
  private readonly handlers: StatsViewHandlers;

  constructor(el: HTMLElement, state: AppState, handlers: StatsViewHandlers) {
    this.el = el;
    this.state = state;
    this.handlers = handlers;
    this.el.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.stat-row');
      if (row?.dataset.abbr) this.handlers.onSelect(row.dataset.abbr);
    });
  }

  render(): void {
    const rows = this.state.stats();
    if (!rows.length) {
      this.el.innerHTML = '<div class="stat-empty">Noch keine Daten</div>';
      return;
    }
    this.el.innerHTML = rows
      .map((r) => {
        const avg = (r.hoursU + r.hoursG) / 2;
        return `<div class="stat-row" data-abbr="${esc(r.abbr)}" title="Klicken: alle Stunden von ${esc(r.abbr)}">
          <div class="stat-dot" style="background:${r.color}"></div>
          <div class="stat-abbr">${esc(r.abbr)}</div>
          <div class="stat-ug">u ${r.hoursU} · g ${r.hoursG}</div>
          <div class="stat-hrs" title="Schnitt aus u/g – Deputat">Ø ${fmt(avg)}</div>
        </div>`;
      })
      .join('');
  }
}
