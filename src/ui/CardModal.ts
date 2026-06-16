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
  private readonly klasseInput: HTMLInputElement;
  private readonly abbrInput: HTMLInputElement;
  private readonly fachInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly durSelect: HTMLSelectElement;
  private readonly laborCheckbox: HTMLInputElement;
  private readonly labGroupSelect: HTMLSelectElement;
  private readonly werkstattCheckbox: HTMLInputElement;
  private readonly vierwoechigCheckbox: HTMLInputElement;
  private readonly half1Checkbox: HTMLInputElement;
  private readonly half2Checkbox: HTMLInputElement;
  private readonly noCountCheckbox: HTMLInputElement;
  private readonly collisionCheckbox: HTMLInputElement;
  private readonly mainSubjectCheckbox: HTMLInputElement;
  private readonly couplingInput: HTMLInputElement;
  private readonly teamCheckbox: HTMLInputElement;
  private readonly teamInput: HTMLInputElement;
  private readonly swatchesEl: HTMLElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly handlers: CardModalHandlers;

  private pickedColor: string = PALETTE[0];
  private editingId: string | null = null;
  /** Kommentar bzw. Name der bearbeiteten Karte; hier nicht editiert, nur durchgereicht. */
  private existingComment = '';
  private existingName = '';

  constructor(handlers: CardModalHandlers) {
    this.handlers = handlers;
    this.overlay = document.getElementById('add-modal')!;
    this.title = document.getElementById('am-title')!;
    this.klasseInput = document.getElementById('am-klasse') as HTMLInputElement;
    this.abbrInput = document.getElementById('am-abbr') as HTMLInputElement;
    this.fachInput = document.getElementById('am-fach') as HTMLInputElement;
    this.roomInput = document.getElementById('am-room') as HTMLInputElement;
    this.durSelect = document.getElementById('am-dur') as HTMLSelectElement;
    this.laborCheckbox = document.getElementById('am-labor') as HTMLInputElement;
    this.labGroupSelect = document.getElementById('am-labgroup') as HTMLSelectElement;
    this.werkstattCheckbox = document.getElementById('am-werkstatt') as HTMLInputElement;
    this.vierwoechigCheckbox = document.getElementById('am-vierwoechig') as HTMLInputElement;
    this.half1Checkbox = document.getElementById('am-half1') as HTMLInputElement;
    this.half2Checkbox = document.getElementById('am-half2') as HTMLInputElement;
    this.noCountCheckbox = document.getElementById('am-nocount') as HTMLInputElement;
    this.collisionCheckbox = document.getElementById('am-collision') as HTMLInputElement;
    this.mainSubjectCheckbox = document.getElementById('am-mainsubject') as HTMLInputElement;
    this.couplingInput = document.getElementById('am-coupling') as HTMLInputElement;
    this.teamCheckbox = document.getElementById('am-teamteaching') as HTMLInputElement;
    this.teamInput = document.getElementById('am-team') as HTMLInputElement;
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
    this.existingName = '';
    this.title.textContent = 'Karte erstellen';
    this.deleteBtn.style.display = 'none';
    this.klasseInput.value = '';
    this.abbrInput.value = '';
    this.fachInput.value = '';
    this.roomInput.value = '';
    this.durSelect.value = '2';
    this.laborCheckbox.checked = false;
    this.labGroupSelect.value = '';
    this.werkstattCheckbox.checked = false;
    this.vierwoechigCheckbox.checked = false;
    this.half1Checkbox.checked = false;
    this.half2Checkbox.checked = false;
    this.noCountCheckbox.checked = false;
    this.collisionCheckbox.checked = false;
    this.mainSubjectCheckbox.checked = false;
    this.couplingInput.value = '';
    this.teamCheckbox.checked = false;
    this.teamInput.value = '';
    this.renderSwatches(suggestedColor);
    this.open();
  }

  openForEdit(card: Card): void {
    this.editingId = card.id;
    this.existingComment = card.comment;
    this.existingName = card.name;
    this.title.textContent = 'Karte bearbeiten';
    this.deleteBtn.style.display = 'inline-flex';
    this.klasseInput.value = card.klasse;
    this.abbrInput.value = card.abbr;
    this.fachInput.value = card.fach;
    this.roomInput.value = card.room;
    this.durSelect.value = String(card.duration);
    this.laborCheckbox.checked = card.isLabor;
    this.labGroupSelect.value = card.labGroup;
    this.werkstattCheckbox.checked = card.isWerkstatt;
    this.vierwoechigCheckbox.checked = card.isVierwoechig;
    this.half1Checkbox.checked = card.firstHalf;
    this.half2Checkbox.checked = card.secondHalf;
    this.noCountCheckbox.checked = card.noCount;
    this.collisionCheckbox.checked = card.collision;
    this.mainSubjectCheckbox.checked = card.mainSubject;
    this.couplingInput.value = card.coupling;
    this.teamCheckbox.checked = !!card.teamTeaching;
    this.teamInput.value = card.teamTeaching;
    this.renderSwatches(card.color);
    this.open();
  }

  submit(): void {
    const props: CardProps = {
      klasse: this.klasseInput.value.trim(),
      abbr: this.abbrInput.value.trim().toUpperCase(),
      fach: this.fachInput.value.trim(),
      name: this.existingName,
      room: this.roomInput.value.trim(),
      duration: parseInt(this.durSelect.value, 10),
      color: this.pickedColor,
      isLabor: this.laborCheckbox.checked,
      labGroup: this.labGroupSelect.value,
      isWerkstatt: this.werkstattCheckbox.checked,
      isVierwoechig: this.vierwoechigCheckbox.checked,
      firstHalf: this.half1Checkbox.checked,
      secondHalf: this.half2Checkbox.checked,
      noCount: this.noCountCheckbox.checked,
      coupling: this.couplingInput.value.trim(),
      teamTeaching: this.teamCheckbox.checked ? this.teamInput.value.trim() : '',
      collision: this.collisionCheckbox.checked,
      mainSubject: this.mainSubjectCheckbox.checked,
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
    if (!this.roomInput.value && entry.room) this.roomInput.value = entry.room;
    if (!this.existingName && entry.name) this.existingName = entry.name;
    if (entry.isLabor) this.laborCheckbox.checked = true;
    if (entry.isWerkstatt) this.werkstattCheckbox.checked = true;
    if (entry.isVierwoechig) this.vierwoechigCheckbox.checked = true;
  }
}
