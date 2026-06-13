import { esc } from '../utils/html';

interface ClearOption {
  abbr: string;
  count: number;
}

/** Wert für „Alle Karten“ im Auswahlfeld. */
const ALL = '__all__';

/**
 * Dialog zum Löschen von Karten: Auswahl eines Kürzels oder „Alle Karten“,
 * anschließend eine zusätzliche Bestätigung vor dem endgültigen Löschen.
 */
export class ClearCardsModal {
  private readonly overlay: HTMLElement;
  private readonly select: HTMLSelectElement;

  private options: ClearOption[] = [];
  private total = 0;
  /** Callback: null = alle Karten, sonst das gewählte Kürzel. */
  private onConfirm: ((abbr: string | null) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('clear-modal')!;
    this.select = document.getElementById('clear-select') as HTMLSelectElement;

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.getElementById('clear-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('clear-confirm')!.addEventListener('click', () => this.submit());
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  open(options: ClearOption[], total: number, onConfirm: (abbr: string | null) => void): void {
    this.options = options;
    this.total = total;
    this.onConfirm = onConfirm;
    this.select.innerHTML =
      `<option value="${ALL}">Alle Karten (${total})</option>` +
      options.map((o) => `<option value="${esc(o.abbr)}">${esc(o.abbr)} (${o.count})</option>`).join('');
    this.overlay.classList.add('open');
  }

  private submit(): void {
    const value = this.select.value;
    const isAll = value === ALL;
    const count = isAll ? this.total : (this.options.find((o) => o.abbr === value)?.count ?? 0);
    const label = isAll ? `ALLE ${count} Karten` : `${count} Karte(n) mit Kürzel „${value}“`;
    if (!confirm(`Wirklich ${label} löschen?\n\nDas kann nicht rückgängig gemacht werden.`)) return;
    this.onConfirm?.(isAll ? null : value);
    this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
    this.onConfirm = null;
  }
}
