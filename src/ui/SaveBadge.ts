/** „✓ Gespeichert“-Anzeige im Header; leuchtet nach jedem Speichern kurz auf. */
export class SaveBadge {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  flash(): void {
    this.el.className = 'sbadge ok';
    this.el.textContent = '✓ Gespeichert';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.className = 'sbadge';
    }, 1800);
  }
}
