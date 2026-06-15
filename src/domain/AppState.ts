import { Card } from './Card';
import { CardPool } from './CardPool';
import { ClassList } from './ClassList';
import { PALETTE } from './constants';
import { Placement } from './Placement';
import { Schedule } from './Schedule';
import { semesterFactor } from './semester';
import type { CardProps, LabelField, PersistedState, PlacementPosition, StatRow } from './types';

export interface ChangeEvent {
  /** false: nur persistieren, UI nicht neu rendern (z. B. Tippen im Klassennamen). */
  render: boolean;
}

type ChangeListener = (e: ChangeEvent) => void;

/**
 * Aggregat-Wurzel: bündelt Pool, Klassenliste und Stundenplan und bietet
 * alle fachlichen Operationen an. Jede Änderung benachrichtigt die Listener
 * (App-Schicht: speichern + rendern).
 */
export class AppState {
  pool: CardPool;
  classes: ClassList;
  schedule: Schedule;
  private nid: number;
  private listeners: ChangeListener[] = [];

  constructor(pool: CardPool, classes: ClassList, schedule: Schedule, nid = 1) {
    this.pool = pool;
    this.classes = classes;
    this.schedule = schedule;
    this.nid = nid;
  }

  static createDefault(): AppState {
    return new AppState(new CardPool(), ClassList.withDefaults(), new Schedule());
  }

  /** Ersetzt den gesamten Zustand durch geladene Daten (Datei öffnen). */
  loadFrom(raw: PersistedState): void {
    const fresh = AppState.fromJSON(raw);
    this.pool = fresh.pool;
    this.classes = fresh.classes;
    this.schedule = fresh.schedule;
    this.nid = fresh.nid;
    this.emit();
  }

  // ── Beobachter ──────────────────────────────────────────────────────────

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(render = true): void {
    for (const fn of this.listeners) fn({ render });
  }

  private nextId(): string {
    return `x${this.nid++}_${Math.random().toString(36).slice(2, 5)}`;
  }

  // ── Karten (Pool) ───────────────────────────────────────────────────────

  createCard(props: CardProps): Card {
    const card = new Card(this.nextId(), props);
    this.pool.add(card);
    this.emit();
    return card;
  }

  updateCard(id: string, props: CardProps): void {
    this.pool.findById(id)?.update(props);
    this.emit();
  }

  /** Erstellt mehrere Pool-Karten auf einmal (z. B. Excel-Import). */
  importCards(list: CardProps[]): number {
    for (const props of list) this.pool.add(new Card(this.nextId(), props));
    if (list.length) this.emit();
    return list.length;
  }

  deleteCard(id: string): void {
    this.pool.remove(id);
    this.emit();
  }

  // ── Massen-Löschung ─────────────────────────────────────────────────────

  /** Gesamtzahl der Karten (Pool + Plan). */
  get totalCardCount(): number {
    return this.pool.all.length + this.schedule.all.length;
  }

  /** Verschiedene Kürzel mit Anzahl Karten (Pool + Plan), alphabetisch. */
  cardCountsByAbbr(): { abbr: string; count: number }[] {
    const map = new Map<string, number>();
    for (const c of this.pool.all) map.set(c.abbr, (map.get(c.abbr) ?? 0) + 1);
    for (const p of this.schedule.all) map.set(p.abbr, (map.get(p.abbr) ?? 0) + 1);
    return [...map.entries()]
      .map(([abbr, count]) => ({ abbr, count }))
      .sort((a, b) => a.abbr.localeCompare(b.abbr));
  }

  /** Löscht alle Karten eines Kürzels – im Pool und im Plan. */
  deleteCardsByAbbr(abbr: string): void {
    this.pool.replaceAll(this.pool.all.filter((c) => c.abbr !== abbr));
    this.schedule.replaceAll(this.schedule.all.filter((p) => p.abbr !== abbr));
    this.emit();
  }

  /** Löscht alle Karten (Pool und Plan); Klassen-Spalten bleiben erhalten. */
  deleteAllCards(): void {
    this.pool.replaceAll([]);
    this.schedule.replaceAll([]);
    this.emit();
  }

  // ── Kommentare ──────────────────────────────────────────────────────────

  setCardComment(id: string, comment: string): void {
    const card = this.pool.findById(id);
    if (!card) return;
    card.comment = comment;
    this.emit();
  }

  setPlacementComment(id: string, comment: string): void {
    const placement = this.schedule.findById(id);
    if (!placement) return;
    placement.comment = comment;
    this.emit();
  }

  /** Entfernt alle Kommentare (Pool + Plan). */
  clearAllComments(): void {
    for (const c of this.pool.all) c.comment = '';
    for (const p of this.schedule.all) p.comment = '';
    this.emit();
  }

  // ── Platzierungen ───────────────────────────────────────────────────────

  /** Pool-Karte in den Plan legen; die Pool-Karte wird verbraucht. */
  placeFromPool(cardId: string, pos: PlacementPosition): Placement | null {
    const card = this.pool.remove(cardId);
    if (!card) return null;
    const placement = new Placement(this.nextId(), card.snapshot(), pos);
    this.schedule.add(placement);
    this.emit();
    return placement;
  }

  /** Platzierung innerhalb des Plans verschieben. */
  movePlacement(placementId: string, pos: PlacementPosition): Placement | null {
    const old = this.schedule.remove(placementId);
    if (!old) return null;
    const placement = new Placement(this.nextId(), old.cardSnapshot(), pos);
    this.schedule.add(placement);
    this.emit();
    return placement;
  }

  /** Fixierung umschalten; gibt den neuen Zustand zurück (null = nicht gefunden). */
  toggleLock(placementId: string): boolean | null {
    const placement = this.schedule.findById(placementId);
    if (!placement) return null;
    placement.locked = !placement.locked;
    this.emit();
    return placement.locked;
  }

  /** Platzierung entfernen und als Karte zurück in den Pool legen. */
  returnToPool(placementId: string): Placement | null {
    const placement = this.schedule.remove(placementId);
    if (!placement) return null;
    this.pool.add(new Card(this.nextId(), placement.cardSnapshot()));
    this.emit();
    return placement;
  }

  /** Entplant alle Karten: jede Platzierung wandert zurück in den Pool. */
  unplaceAll(): number {
    const count = this.schedule.all.length;
    for (const p of this.schedule.all) this.pool.add(new Card(this.nextId(), p.cardSnapshot()));
    this.schedule.replaceAll([]);
    this.emit();
    return count;
  }

  // ── Klassen ─────────────────────────────────────────────────────────────

  addClass(): number {
    const idx = this.classes.add();
    this.emit();
    return idx;
  }

  /** Beschriftung setzen; rendert nicht neu, damit der Fokus im Feld bleibt. */
  setClassLabel(classIdx: number, day: number, field: LabelField, value: string): void {
    this.classes.setLabel(classIdx, day, field, value);
    this.emit(false);
  }

  /** Feldfarbe setzen (leer = keine). render=false z. B. bei Auto-Farbe (Fokus halten). */
  setClassLabelColor(classIdx: number, day: number, field: LabelField, color: string, render = true): void {
    this.classes.setColor(classIdx, day, field, color);
    this.emit(render);
  }

  hasPlacementsForClass(idx: number): boolean {
    return this.schedule.all.some((p) => p.classIdx === idx);
  }

  deleteClass(idx: number): void {
    this.schedule.removeClass(idx);
    this.classes.removeAt(idx);
    this.emit();
  }

  /**
   * Passt die Klassenbindung der Karte zur Spalte an dieser Position?
   * Ohne gesetzte Klasse (leer) ist die Karte überall erlaubt.
   */
  cardFitsColumn(card: CardProps, pos: PlacementPosition): boolean {
    const need = card.klasse.trim().toLowerCase();
    if (!need) return true;
    return this.classes.classNameAt(pos.classIdx, pos.day, pos.week).toLowerCase() === need;
  }

  // ── Abfragen ────────────────────────────────────────────────────────────

  /** Sucht Karte oder Platzierung mit dem Kürzel (für Auto-Vervollständigung). */
  findByAbbr(abbr: string): CardProps | null {
    const card = this.pool.all.find((c) => c.abbr === abbr);
    if (card) return card.snapshot();
    const placement = this.schedule.all.find((p) => p.abbr === abbr);
    return placement ? placement.cardSnapshot() : null;
  }

  /** Erste noch unbenutzte Palettenfarbe (für neue Karten). */
  suggestFreeColor(): string {
    const used = new Set<string>([
      ...this.pool.all.map((c) => c.color),
      ...this.schedule.all.map((p) => p.color),
    ]);
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
  }

  /** Stunden-Übersicht: verplante Stunden je Kürzel, Pool-Karten mit 0h. */
  stats(): StatRow[] {
    const map = new Map<string, StatRow>();
    for (const p of this.schedule.all) {
      const row =
        map.get(p.abbr) ?? { abbr: p.abbr, fach: p.fach, name: p.name, color: p.color, hoursU: 0, hoursG: 0 };
      const h = p.duration * semesterFactor(p) * (p.isVierwoechig ? 0.5 : 1);
      if (p.week === 'u') row.hoursU += h;
      else row.hoursG += h;
      map.set(p.abbr, row);
    }
    for (const c of this.pool.all) {
      if (!map.has(c.abbr)) {
        map.set(c.abbr, { abbr: c.abbr, fach: c.fach, name: c.name, color: c.color, hoursU: 0, hoursG: 0 });
      }
    }
    return [...map.values()].sort((a, b) => a.abbr.localeCompare(b.abbr));
  }

  // ── Serialisierung (Format kompatibel zur Vorgänger-App) ───────────────

  toJSON(): PersistedState {
    return {
      classes: this.classes.toPersisted(),
      cards: this.pool.all.map((c) => c.toJSON()),
      placed: this.schedule.all.map((p) => p.toJSON()),
      nid: this.nid,
    };
  }

  static fromJSON(raw: PersistedState): AppState {
    const pool = new CardPool();
    pool.replaceAll((raw.cards ?? []).map(Card.fromJSON));
    const schedule = new Schedule();
    schedule.replaceAll((raw.placed ?? []).map(Placement.fromJSON));
    const classes = ClassList.fromPersisted(raw.classes);
    return new AppState(pool, classes, schedule, raw.nid ?? 1);
  }
}
