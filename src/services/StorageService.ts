import type { PersistedState } from '../domain/types';

/**
 * Persistiert den App-Zustand im localStorage.
 * Schlüssel und Format sind kompatibel zur Vorgänger-App (Single-File-HTML).
 */
export class StorageService {
  private readonly key: string;

  constructor(key = 'digitale-tafel-v5') {
    this.key = key;
  }

  load(): PersistedState | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? (JSON.parse(raw) as PersistedState) : null;
    } catch {
      return null;
    }
  }

  save(state: PersistedState): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch {
      // Speicher voll oder blockiert – Anwendung läuft ohne Persistenz weiter.
    }
  }
}
