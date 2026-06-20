import { esc } from '../utils/html';

interface ClearOption {
  label: string;
  count: number;
}

/** Auswahl-Ergebnis: alle Karten, ein Kürzel oder eine Klasse. */
export type ClearSelection = { kind: 'all' } | { kind: 'abbr'; value: string } | { kind: 'class'; value: string };

/** Wert für „Alle Karten“ im Auswahlfeld. */
const ALL = '__all__';

/**
 * Dialog zum Löschen von Karten (Pool + Plan): per Suchfeld ein Kürzel ODER eine
 * Klasse wählen (oder „Alle Karten“), anschließend eine zusätzliche Bestätigung.
 */
export class ClearCardsModal {
  private readonly overlay: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly search: HTMLInputElement;

  private abbrs: ClearOption[] = [];
  private classes: ClearOption[] = [];
  private total = 0;
  private onConfirm: ((sel: ClearSelection) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('clear-modal')!;
    this.select = document.getElementById('clear-select') as HTMLSelectElement;
    this.search = document.getElementById('clear-search') as HTMLInputElement;

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.search.addEventListener('input', () => this.render());
    // Enter im Suchfeld → löschen (falls genau eine Option getroffen ist).
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    document.getElementById('clear-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('clear-confirm')!.addEventListener('click', () => this.submit());
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  open(abbrs: ClearOption[], classes: ClearOption[], total: number, onConfirm: (sel: ClearSelection) => void): void {
    this.abbrs = abbrs;
    this.classes = classes;
    this.total = total;
    this.onConfirm = onConfirm;
    this.search.value = '';
    this.render();
    this.overlay.classList.add('open');
    this.search.focus();
  }

  /** Baut die Optionsliste, gefiltert über das Suchfeld (Kürzel + Klassen). */
  private render(): void {
    const term = this.search.value.trim().toLowerCase();
    const hit = (o: ClearOption): boolean => !term || o.label.toLowerCase().includes(term);
    const opt = (prefix: string, o: ClearOption): string =>
      `<option value="${prefix}${esc(o.label)}">${esc(o.label)} (${o.count})</option>`;
    const abbrHits = this.abbrs.filter(hit);
    const classHits = this.classes.filter(hit);
    let html = term ? '' : `<option value="${ALL}">Alle Karten (${this.total})</option>`;
    if (abbrHits.length) html += `<optgroup label="Nach Kürzel">${abbrHits.map((o) => opt('a:', o)).join('')}</optgroup>`;
    if (classHits.length) html += `<optgroup label="Nach Klasse">${classHits.map((o) => opt('c:', o)).join('')}</optgroup>`;
    if (!html) html = '<option value="" disabled>Kein Treffer</option>';
    this.select.innerHTML = html;
    // Bei aktiver Suche die erste echte Option vorwählen → Enter löscht direkt.
    if (term) {
      const first = this.select.querySelector('option:not([disabled])') as HTMLOptionElement | null;
      if (first) first.selected = true;
    }
  }

  private submit(): void {
    const value = this.select.value;
    if (!value) return;

    if (value === ALL) {
      // Electron unterstützt kein prompt – daher confirm (mit Strg+Z rückgängig machbar).
      if (!confirm(`ALLE ${this.total} Karten werden gelöscht.\n\nFortfahren? (mit Strg+Z rückgängig machbar)`)) return;
      this.onConfirm?.({ kind: 'all' });
      this.close();
      return;
    }

    const kind = value.startsWith('c:') ? 'class' : 'abbr';
    const name = value.slice(2);
    const opts = kind === 'class' ? this.classes : this.abbrs;
    const count = opts.find((o) => o.label === name)?.count ?? 0;
    const was = kind === 'class' ? 'Klasse' : 'Kürzel';
    if (!confirm(`Wirklich ${count} Karte(n) der ${was} „${name}“ löschen (Pool + Plan)?\n\n(Mit Strg+Z rückgängig machbar.)`)) return;
    this.onConfirm?.(kind === 'class' ? { kind: 'class', value: name } : { kind: 'abbr', value: name });
    this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
    this.onConfirm = null;
  }
}
