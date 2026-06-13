import type { PersistedState } from '../domain/types';

/** Ergebnis eines Speichervorgangs. */
export interface SaveResult {
  ok: boolean;
  /** Dateiname (sofern bekannt). */
  name: string | null;
  /** true, wenn der Nutzer den Dialog abgebrochen hat. */
  cancelled?: boolean;
}

/** Ergebnis eines Ladevorgangs. */
export interface OpenResult {
  data: PersistedState;
  name: string;
}

/** Minimaler Typ der File System Access API (nicht in jeder lib.dom enthalten). */
interface FileHandle {
  name?: string;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  getFile?: () => Promise<File>;
}
interface PickerWindow {
  showSaveFilePicker?: (opts?: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (opts?: unknown) => Promise<FileHandle[]>;
}

/**
 * Speichert den Stundenplan als JSON-Datei. Nutzt – wo verfügbar – die
 * File System Access API (echtes „Speichern“ in dieselbe Datei) und fällt
 * sonst auf einen normalen Download zurück.
 */
export class FileService {
  private handle: FileHandle | null = null;

  /** Ob bereits eine Zieldatei gewählt wurde (für „Speichern“). */
  get hasTarget(): boolean {
    return this.handle !== null;
  }

  /** „Speichern“: in die zuletzt gewählte Datei schreiben, sonst wie „Speichern unter“. */
  async save(state: PersistedState): Promise<SaveResult> {
    if (this.handle) {
      await this.write(this.handle, FileService.toJson(state));
      return { ok: true, name: this.handle.name ?? null };
    }
    return this.saveAs(state);
  }

  /** „Speichern unter“: Datei-Dialog (oder Download als Fallback). */
  async saveAs(state: PersistedState): Promise<SaveResult> {
    const json = FileService.toJson(state);
    const suggestedName = FileService.defaultName();
    const picker = window as unknown as PickerWindow;

    if (picker.showSaveFilePicker) {
      try {
        const handle = await picker.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Stundenplan (JSON)', accept: { 'application/json': ['.json'] } }],
        });
        await this.write(handle, json);
        this.handle = handle;
        return { ok: true, name: handle.name ?? suggestedName };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, name: null, cancelled: true };
        throw e;
      }
    }

    // Fallback ohne File System Access API: klassischer Download.
    FileService.download(json, suggestedName);
    return { ok: true, name: suggestedName };
  }

  /** Öffnet eine JSON-Datei und liefert den geparsten Zustand (null = abgebrochen). */
  async open(): Promise<OpenResult | null> {
    const picker = window as unknown as PickerWindow;

    if (picker.showOpenFilePicker) {
      let handles: FileHandle[];
      try {
        handles = await picker.showOpenFilePicker({
          types: [{ description: 'Stundenplan (JSON)', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
      }
      const handle = handles[0];
      if (!handle?.getFile) return null;
      const file = await handle.getFile();
      const data = FileService.parse(await file.text());
      // Geöffnete Datei als Ziel merken, damit „Speichern“ dorthin schreibt.
      this.handle = handle;
      return { data, name: handle.name ?? file.name };
    }

    // Fallback ohne File System Access API: verstecktes Datei-Auswahlfeld.
    const file = await FileService.pickFileFallback();
    if (!file) return null;
    const data = FileService.parse(await file.text());
    return { data, name: file.name };
  }

  private async write(handle: FileHandle, json: string): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
  }

  /** Parst und prüft grob, ob es ein Stundenplan-JSON ist. */
  private static parse(text: string): PersistedState {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || (!('classes' in obj) && !('cards' in obj) && !('placed' in obj))) {
      throw new Error('Kein gültiges Stundenplan-JSON');
    }
    return obj as unknown as PersistedState;
  }

  private static pickFileFallback(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
  }

  private static toJson(state: PersistedState): string {
    return JSON.stringify(state, null, 2);
  }

  private static defaultName(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Stundenplan-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  }

  private static download(json: string, filename: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
