import { PALETTE } from '../domain/constants';
import type { Card } from '../domain/Card';
import type { CardProps } from '../domain/types';

export interface CardModalHandlers {
  /**
   * Speichern: editingId = null bedeutet „neue Karte“.
   * Rückgabe false hält das Modal offen (Validierung fehlgeschlagen).
   */
  onSave: (editingId: string | null, props: CardProps) => boolean;
  onDelete: (cardId: string) => void;
  /** Auto-Vervollständigung: bekannte Karte/Platzierung zum Kürzel suchen. */
  lookupAbbr: (abbr: string) => CardProps | null;
}

/** Dialog zum Anlegen und Bearbeiten von Pool-Karten. */
export class CardModal {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly abbrInput: HTMLInputElement;
  private readonly fachInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly durSelect: HTMLSelectElement;
  private readonly laborCheckbox: HTMLInputElement;
  private readonly swatchesEl: HTMLElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly handlers: CardModalHandlers;

  private pickedColor: string = PALETTE[0];
  private editingId: string | null = null;
  /** Kommentar der bearbeiteten Karte; wird hier nicht editiert, nur durchgereicht. */
  private existingComment = '';

  constructor(handlers: CardModalHandlers) {
    this.handlers = handlers;
    this.overlay = document.getElementById('add-modal')!;
    this.title = document.getElementById('am-title')!;
    this.abbrInput = document.getElementById('am-abbr') as HTMLInputElement;
    this.fachInput = document.getElementById('am-fach') as HTMLInputElement;
    this.nameInput = document.getElementById('am-name') as HTMLInputElement;
    this.durSelect = document.getElementById('am-dur') as HTMLSelectElement;
    this.laborCheckbox = document.getElementById('am-labor') as HTMLInputElement;
    this.swatchesEl = document.getElementById('am-swatches')!;
    this.deleteBtn = document.getElementById('am-delbtn') as HTMLButtonElement;

    this.buildDurationOptions();
    this.bindEvents();
  }

  private buildDurationOptions(): void {
    this.durSelect.innerHTML = Array.from({ length: 9 }, (_, i) => {
      const n = i + 1;
      return `<option value="${n}">${n} Stunde${n > 1 ? 'n' : ''}</option>`;
    }).join('');
  }

  private bindEvents(): void {
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.abbrInput.addEventListener('input', () => {
      this.abbrInput.value = this.abbrInput.value.toUpperCase();
      this.autoFill();
    });
    this.swatchesEl.addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.sw');
      if (sw?.dataset.color) this.renderSwatches(sw.dataset.color);
    });
    document.getElementById('am-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('am-save')!.addEventListener('click', () => this.submit());
    this.deleteBtn.addEventListener('click', () => {
      if (this.editingId) this.handlers.onDelete(this.editingId);
    });
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  openForCreate(suggestedColor: string): void {
    this.editingId = null;
    this.existingComment = '';
    this.title.textContent = 'Karte erstellen';
    this.deleteBtn.style.display = 'none';
    this.abbrInput.value = '';
    this.fachInput.value = '';
    this.nameInput.value = '';
    this.durSelect.value = '2';
    this.laborCheckbox.checked = false;
    this.renderSwatches(suggestedColor);
    this.open();
  }

  openForEdit(card: Card): void {
    this.editingId = card.id;
    this.existingComment = card.comment;
    this.title.textContent = 'Karte bearbeiten';
    this.deleteBtn.style.display = 'inline-flex';
    this.abbrInput.value = card.abbr;
    this.fachInput.value = card.fach;
    this.nameInput.value = card.name;
    this.durSelect.value = String(card.duration);
    this.laborCheckbox.checked = card.isLabor;
    this.renderSwatches(card.color);
    this.open();
  }

  submit(): void {
    const props: CardProps = {
      abbr: this.abbrInput.value.trim().toUpperCase(),
      fach: this.fachInput.value.trim(),
      name: this.nameInput.value.trim(),
      duration: parseInt(this.durSelect.value, 10),
      color: this.pickedColor,
      isLabor: this.laborCheckbox.checked,
      comment: this.existingComment,
    };
    if (this.handlers.onSave(this.editingId, props)) this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
  }

  private open(): void {
    this.overlay.classList.add('open');
    setTimeout(() => this.abbrInput.focus(), 80);
  }

  private renderSwatches(selected: string): void {
    this.pickedColor = selected;
    this.swatchesEl.innerHTML = PALETTE.map(
      (c) => `<div class="sw${c === selected ? ' on' : ''}" style="background:${c}" data-color="${c}"></div>`,
    ).join('');
  }

  /** Übernimmt Farbe/Fach/Name/Labor einer bekannten Karte mit gleichem Kürzel. */
  private autoFill(): void {
    const entry = this.handlers.lookupAbbr(this.abbrInput.value.trim().toUpperCase());
    if (!entry) return;
    this.renderSwatches(entry.color);
    if (!this.fachInput.value && entry.fach) this.fachInput.value = entry.fach;
    if (!this.nameInput.value && entry.name) this.nameInput.value = entry.name;
    if (entry.isLabor) this.laborCheckbox.checked = true;
  }
}
