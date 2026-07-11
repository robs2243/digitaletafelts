import type { PersistedState } from '../domain/types';

/** Benannter Plan-Stand (Sicherungspunkt) im Versionsverlauf. */
export interface PlanSnapshot {
  name: string;
  /** Zeitstempel (ms seit Epoch). */
  savedAt: number;
  state: PersistedState;
}

/**
 * Persistiert den App-Zustand im localStorage.
 * Schlüssel und Format sind kompatibel zur Vorgänger-App (Single-File-HTML).
 */
export class StorageService {
  private readonly key: string;
  private readonly snapshotKey: string;

  constructor(key = 'digitale-tafel-v5') {
    this.key = key;
    this.snapshotKey = `${key}-staende`;
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

  // ── Benannte Plan-Stände (Versionsverlauf) ────────────────────────────────

  loadSnapshots(): PlanSnapshot[] {
    try {
      const raw = localStorage.getItem(this.snapshotKey);
      return raw ? (JSON.parse(raw) as PlanSnapshot[]) : [];
    } catch {
      return [];
    }
  }

  /** Speichert einen benannten Stand (neuester zuerst). false = Speicher voll. */
  saveSnapshot(name: string, state: PersistedState): boolean {
    const list = this.loadSnapshots();
    list.unshift({ name, savedAt: Date.now(), state });
    try {
      localStorage.setItem(this.snapshotKey, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  deleteSnapshot(index: number): void {
    const list = this.loadSnapshots();
    list.splice(index, 1);
    try {
      localStorage.setItem(this.snapshotKey, JSON.stringify(list));
    } catch {
      // ignorieren
    }
  }
}
