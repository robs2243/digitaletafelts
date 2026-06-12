/**
 * Dialog zum Hinterlegen eines Freitext-Kommentars an einer Karte
 * (Pool oder Stundenplan). Geöffnet per Doppelklick auf die Karte.
 */
export class CommentModal {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly clearBtn: HTMLButtonElement;

  private onSave: ((comment: string) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('comment-modal')!;
    this.title = document.getElementById('cm-title')!;
    this.textarea = document.getElementById('cm-text') as HTMLTextAreaElement;
    this.clearBtn = document.getElementById('cm-clear') as HTMLButtonElement;

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.getElementById('cm-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('cm-save')!.addEventListener('click', () => this.submit());
    this.clearBtn.addEventListener('click', () => {
      this.textarea.value = '';
      this.submit();
    });
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  /** Öffnet den Dialog; onSave erhält den (ggf. leeren) neuen Kommentar. */
  open(cardLabel: string, comment: string, onSave: (comment: string) => void): void {
    this.onSave = onSave;
    this.title.textContent = `💬 Kommentar – ${cardLabel}`;
    this.textarea.value = comment;
    this.clearBtn.style.display = comment ? 'inline-flex' : 'none';
    this.overlay.classList.add('open');
    setTimeout(() => this.textarea.focus(), 80);
  }

  submit(): void {
    this.onSave?.(this.textarea.value.trim());
    this.close();
  }

  close(): void {
    this.overlay.classList.remove('open');
    this.onSave = null;
  }
}
