import { PALETTE } from '../domain/constants';

/**
 * Kleines Farb-Auswahlfenster, das an einem Element verankert geöffnet wird.
 * Liefert die gewählte Palettenfarbe oder '' (keine Farbe) zurück.
 */
export class ColorPopover {
  private readonly el: HTMLElement;
  private onPick: ((color: string) => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'color-pop';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);

    this.el.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus im Feld behalten
    this.el.addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
      if (!sw) return;
      this.onPick?.(sw.dataset.color ?? '');
      this.close();
    });
  }

  open(anchor: HTMLElement, current: string, onPick: (color: string) => void): void {
    this.onPick = onPick;
    this.el.innerHTML =
      `<button class="color-pop-none${current ? '' : ' on'}" data-color="" title="Keine Farbe">✕</button>` +
      PALETTE.map(
        (c) => `<span class="color-pop-sw${c === current ? ' on' : ''}" style="background:${c}" data-color="${c}"></span>`,
      ).join('');

    this.el.style.display = 'flex';
    const r = anchor.getBoundingClientRect();
    const top = Math.min(r.bottom + 4, window.innerHeight - this.el.offsetHeight - 4);
    const left = Math.min(r.left, window.innerWidth - this.el.offsetWidth - 4);
    this.el.style.top = `${Math.max(4, top)}px`;
    this.el.style.left = `${Math.max(4, left)}px`;

    // Schließen bei Klick außerhalb / Escape / Scrollen.
    setTimeout(() => {
      document.addEventListener('mousedown', this.onDocMouseDown);
      document.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('scroll', this.onScroll, true);
    }, 0);
  }

  close(): void {
    if (this.el.style.display === 'none') return;
    this.el.style.display = 'none';
    this.onPick = null;
    document.removeEventListener('mousedown', this.onDocMouseDown);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('scroll', this.onScroll, true);
  }

  private readonly onDocMouseDown = (e: MouseEvent): void => {
    if (!this.el.contains(e.target as Node)) this.close();
  };
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };
  private readonly onScroll = (): void => this.close();
}
