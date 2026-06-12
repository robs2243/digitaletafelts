import type { AppState } from '../domain/AppState';
import { esc } from '../utils/html';

/** Stunden-Übersicht in der Seitenleiste: verplante Stunden je Kürzel. */
export class StatsView {
  private readonly el: HTMLElement;
  private readonly state: AppState;

  constructor(el: HTMLElement, state: AppState) {
    this.el = el;
    this.state = state;
  }

  render(): void {
    const rows = this.state.stats();
    if (!rows.length) {
      this.el.innerHTML = '<div class="stat-empty">Noch keine Daten</div>';
      return;
    }
    this.el.innerHTML = rows
      .map(
        (r) => `<div class="stat-row">
          <div class="stat-dot" style="background:${r.color}"></div>
          <div class="stat-abbr">${esc(r.abbr)}</div>
          <div class="stat-lbl">${esc(r.fach || r.name || '–')}</div>
          <div class="stat-hrs">${r.hours}h</div>
        </div>`,
      )
      .join('');
  }
}
