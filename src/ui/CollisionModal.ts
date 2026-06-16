export interface CollisionModalOptions {
  messageHtml: string;
  /** true: Klassen-Kollision, Nutzer darf stapeln. */
  canStack: boolean;
  onStack?: () => void;
  /** true: harte Sperre (Lehrer/Raum) darf bewusst übergangen werden. */
  canForce?: boolean;
  onForce?: () => void;
}

/** Warn-Dialog bei Kollisionen; bietet bei Klassen-Kollisionen „Stapeln“ an. */
export class CollisionModal {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly hintBox: HTMLElement;
  private readonly btns: HTMLElement;

  constructor() {
    this.overlay = document.getElementById('warn-modal')!;
    this.title = document.getElementById('warn-title')!;
    this.msg = document.getElementById('warn-msg')!;
    this.hintBox = document.getElementById('warn-hint-box')!;
    this.btns = document.getElementById('warn-btns')!;

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  show(opts: CollisionModalOptions): void {
    this.title.textContent = opts.canStack ? 'Kollision – Stapeln?' : 'Kollision erkannt!';
    this.msg.innerHTML = opts.messageHtml;
    this.hintBox.innerHTML = opts.canStack
      ? `<div class="warn-hint">
          💡 <strong>Stapeln</strong> erlaubt mehrere Fächer / Lehrkräfte gleichzeitig in einer Klasse
          (z.B. Laborteilung). Die Karten werden übereinander angezeigt.
        </div>`
      : '';

    this.btns.innerHTML = '';
    if (opts.canStack) {
      this.btns.append(
        this.button('btn btn-sec', 'Abbrechen', () => this.close()),
        this.button('btn btn-stack', '↕ Stapeln', () => {
          opts.onStack?.();
          this.close();
        }),
      );
    } else if (opts.canForce) {
      this.hintBox.innerHTML = `<div class="warn-hint">
          ⚠️ <strong>Trotzdem platzieren</strong> übergeht bewusst eine harte Regel
          (Lehrkraft/Raum doppelt). Nur nutzen, wenn du das so willst – der
          „✅ Plan prüfen"-Bericht weist den Konflikt danach aus.
        </div>`;
      this.btns.append(
        this.button('btn btn-sec', 'Abbrechen', () => this.close()),
        this.button('btn btn-del', '⚠ Trotzdem platzieren', () => {
          opts.onForce?.();
          this.close();
        }),
      );
    } else {
      this.btns.append(this.button('btn btn-del', 'Verstanden', () => this.close()));
    }
    this.overlay.classList.add('open');
  }

  close(): void {
    this.overlay.classList.remove('open');
  }

  private button(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }
}
