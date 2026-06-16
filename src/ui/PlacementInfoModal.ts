/**
 * Karten-Info-Fenster (Doppelklick auf eine geplante Karte): zeigt ALLE Daten
 * der Platzierung an und erlaubt Raumänderung (Vorschläge = freie Räume im Slot)
 * sowie das Pflegen des Kommentars.
 */
export interface PlacementInfoData {
  /** Titelzeile, z. B. „AB – Mathematik". */
  label: string;
  /** Beschriftete Felder (Klasse, Tag/Stunde, Dauer, Turnus, Eigenschaften …). */
  rows: { label: string; value: string }[];
  /** Akzentfarbe der Karte (Kopf-Balken). */
  color: string;
  room: string;
  comment: string;
  /** Im Slot freie Räume (für die Auswahl-Liste). */
  freeRooms: string[];
}

export interface PlacementInfoResult {
  room: string;
  comment: string;
}

export class PlacementInfoModal {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly roomInput: HTMLInputElement;
  private readonly roomList: HTMLDataListElement;
  private readonly roomHint: HTMLElement;
  private readonly commentArea: HTMLTextAreaElement;

  private onSave: ((r: PlacementInfoResult) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('info-modal')!;
    this.title = document.getElementById('pi-title')!;
    this.grid = document.getElementById('pi-grid')!;
    this.roomInput = document.getElementById('pi-room') as HTMLInputElement;
    this.roomList = document.getElementById('pi-room-list') as HTMLDataListElement;
    this.roomHint = document.getElementById('pi-room-hint')!;
    this.commentArea = document.getElementById('pi-comment') as HTMLTextAreaElement;

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.getElementById('pi-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('pi-save')!.addEventListener('click', () => this.submit());
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  open(data: PlacementInfoData, onSave: (r: PlacementInfoResult) => void): void {
    this.onSave = onSave;
    this.title.textContent = `ℹ️ ${data.label}`;
    this.title.style.color = data.color || '#1a237e';
    this.grid.innerHTML = data.rows
      .map((r) => `<div class="pi-k">${esc(r.label)}</div><div class="pi-v">${esc(r.value)}</div>`)
      .join('');
    this.roomInput.value = data.room;
    this.roomList.innerHTML = data.freeRooms.map((r) => `<option value="${esc(r)}"></option>`).join('');
    this.roomHint.textContent = data.freeRooms.length
      ? `${data.freeRooms.length} Raum/Räume in diesem Slot frei`
      : 'Kein Raum in diesem Slot frei.';
    this.commentArea.value = data.comment;
    this.overlay.classList.add('open');
    setTimeout(() => this.roomInput.focus(), 80);
  }

  submit(): void {
    this.onSave?.({ room: this.roomInput.value.trim(), comment: this.commentArea.value.trim() });
    this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
    this.onSave = null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
