export type ToastType = 'ok' | 'inf';

/** Kurzlebige Benachrichtigung am unteren Bildschirmrand. */
export class Toast {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  show(msg: string, type: ToastType = 'ok'): void {
    this.el.textContent = msg;
    this.el.className = `toast ${type} show`;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.className = `toast ${type}`;
    }, 3000);
  }
}
