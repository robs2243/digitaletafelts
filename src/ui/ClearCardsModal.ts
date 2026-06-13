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

    if (value === ALL) {
      // „Alle löschen“ erfordert die ausdrückliche Eingabe von „Ja“.
      const answer = prompt(
        `ALLE ${this.total} Karten werden unwiderruflich gelöscht.\n\nZum Bestätigen „Ja“ eingeben:`,
      );
      if (answer === null) return; // abgebrochen
      if (answer.trim().toLowerCase() !== 'ja') {
        alert('Abgebrochen – es wurde nicht „Ja“ eingegeben.');
        return;
      }
      this.onConfirm?.(null);
      this.close();
      return;
    }

    const count = this.options.find((o) => o.abbr === value)?.count ?? 0;
    if (!confirm(`Wirklich ${count} Karte(n) mit Kürzel „${value}“ löschen?\n\nDas kann nicht rückgängig gemacht werden.`)) {
      return;
    }
    this.onConfirm?.(value);
    this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
    this.onConfirm = null;
  }
}
