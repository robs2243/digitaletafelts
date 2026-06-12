/** Verwaltet die Klassennamen. Klassen werden über ihren Index referenziert. */
export class ClassList {
  private names: string[];

  constructor(names: string[]) {
    this.names = [...names];
  }

  static withDefaults(count = 10): ClassList {
    return new ClassList(Array.from({ length: count }, (_, i) => `Klasse ${i + 1}`));
  }

  get all(): readonly string[] {
    return this.names;
  }

  get count(): number {
    return this.names.length;
  }

  nameAt(idx: number): string {
    return this.names[idx] ?? `Klasse ${idx + 1}`;
  }

  /** Fügt eine Klasse hinzu und gibt deren Index zurück. */
  add(): number {
    this.names.push(`Klasse ${this.names.length + 1}`);
    return this.names.length - 1;
  }

  /** Benennt um; leere Eingaben werden ignoriert. */
  rename(idx: number, name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.names[idx] = trimmed;
  }

  removeAt(idx: number): void {
    this.names.splice(idx, 1);
  }
}
