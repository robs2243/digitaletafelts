import { Card } from './Card';
import { CardPool } from './CardPool';
import { ClassList } from './ClassList';
import { DAYS, PALETTE, PERIODS, WEEKS } from './constants';
import { Placement } from './Placement';
import { blockedPeriods as blockedPeriodsOf, teachingPeriods } from './periods';
import { Schedule } from './Schedule';
import { semesterFactor } from './semester';
import { DEFAULT_PLAN_SETTINGS } from './types';
import type { CardProps, CardWithPlace, ClassBlock, LabelField, PersistedState, PlacementPosition, PlanProgress, PlanRunResult, PlanSettings, StatRow, Week } from './types';

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
  /** Manuell gepflegte Raumliste (zentrale Quelle für Vorschläge & Raumplan). */
  rooms: string[];
  /** Lehrer-Sperrzeiten: Kürzel (lowercase) → Set gesperrter Slots `tag|woche|stunde`. */
  private teacherBlocks: Map<string, Set<string>>;
  /** Teilzeit: Kürzel (lowercase) → max. Anwesenheitstage (0/fehlt = unbegrenzt). */
  private teacherMaxDays = new Map<string, number>();
  /** Dauerhafte Farbzuordnung: Kürzel (lowercase) → Hex (über Importe hinweg stabil). */
  private teacherColors = new Map<string, string>();
  /** Klassen-Sperrzeiten (z. B. Betriebstag) mit Beschriftung im Plan. */
  private classBlocks: ClassBlock[] = [];
  /** Konfigurierbare Planungsregeln. */
  private planSettings: PlanSettings = { ...DEFAULT_PLAN_SETTINGS };
  private nid: number;
  private listeners: ChangeListener[] = [];
  // Undo/Redo: Snapshots des gesamten Zustands (JSON). lastSnapshot ist immer der
  // aktuell sichtbare Stand; undoStack hält frühere, redoStack zurückgenommene.
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private restoring = false;
  private static readonly HISTORY_MAX = 80;

  constructor(
    pool: CardPool,
    classes: ClassList,
    schedule: Schedule,
    nid = 1,
    rooms: string[] = [],
    teacherBlocks: Map<string, Set<string>> = new Map(),
  ) {
    this.pool = pool;
    this.classes = classes;
    this.schedule = schedule;
    this.nid = nid;
    this.rooms = rooms;
    this.teacherBlocks = teacherBlocks;
    this.lastSnapshot = JSON.stringify(this.toJSON());
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
    this.rooms = fresh.rooms;
    this.teacherBlocks = fresh.teacherBlocks;
    this.teacherMaxDays = fresh.teacherMaxDays;
    this.teacherColors = fresh.teacherColors;
    this.classBlocks = fresh.classBlocks;
    this.planSettings = fresh.planSettings;
    // Verlauf nach „Datei öffnen" zurücksetzen – nicht über den Ladevorgang hinweg undo-bar.
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshot = JSON.stringify(this.toJSON());
    this.restoring = true;
    this.emit();
    this.restoring = false;
  }

  // ── Beobachter ──────────────────────────────────────────────────────────

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(render = true): void {
    if (!this.restoring) {
      if (render) {
        this.undoStack.push(this.lastSnapshot);
        if (this.undoStack.length > AppState.HISTORY_MAX) this.undoStack.shift();
        this.redoStack = [];
      }
      this.lastSnapshot = JSON.stringify(this.toJSON());
    }
    for (const fn of this.listeners) fn({ render });
  }

  // ── Undo / Redo (Snapshot-basiert) ────────────────────────────────────────

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Macht die letzte Änderung rückgängig. Gibt false zurück, wenn nichts da ist. */
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.lastSnapshot);
    this.lastSnapshot = prev;
    this.applySnapshot(prev);
    return true;
  }

  /** Stellt die zuletzt rückgängig gemachte Änderung wieder her. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.lastSnapshot);
    this.lastSnapshot = next;
    this.applySnapshot(next);
    return true;
  }

  /** Setzt den Zustand auf einen Snapshot und benachrichtigt die UI (ohne neuen Verlaufseintrag). */
  private applySnapshot(json: string): void {
    const raw = JSON.parse(json) as PersistedState;
    this.pool.replaceAll((raw.cards ?? []).map(Card.fromJSON));
    this.schedule.replaceAll((raw.placed ?? []).map(Placement.fromJSON));
    this.classes = ClassList.fromPersisted(raw.classes);
    this.nid = raw.nid ?? 1;
    this.rooms = Array.isArray(raw.rooms) ? raw.rooms.map((r) => String(r).trim()).filter(Boolean) : [];
    this.teacherBlocks = AppState.parseTeacherBlocks(raw.teacherBlocks);
    this.teacherMaxDays = AppState.parseTeacherMaxDays(raw.teacherMaxDays);
    this.teacherColors = AppState.parseTeacherColors(raw.teacherColors);
    this.classBlocks = AppState.parseClassBlocks(raw.classBlocks);
    this.planSettings = { ...DEFAULT_PLAN_SETTINGS, ...(raw.planSettings ?? {}) };
    this.restoring = true;
    this.emit();
    this.restoring = false;
  }

  private nextId(): string {
    return `x${this.nid++}_${Math.random().toString(36).slice(2, 5)}`;
  }

  // ── Karten (Pool) ───────────────────────────────────────────────────────

  /** Fügt einen Raum still (ohne emit) zur gepflegten Liste hinzu, falls neu. */
  private ensureRoom(room: string): void {
    const name = room.trim();
    if (name && !this.rooms.some((r) => r.toLowerCase() === name.toLowerCase())) this.rooms.push(name);
  }

  /**
   * Legt für Klassennamen ohne passende Spalte je eine Spalte an (combined =
   * Name an allen Tagen). Vorhandene leere Spalten werden zuerst genutzt.
   * Gibt die Anzahl neu beschrifteter Spalten zurück.
   */
  ensureClassColumns(names: string[]): number {
    const existing = new Set<string>();
    for (let c = 0; c < this.classes.count; c++)
      for (let d = 0; d < DAYS.length; d++)
        for (const w of WEEKS) {
          const n = this.classes.classNameAt(c, d, w).trim().toLowerCase();
          if (n) existing.add(n);
        }
    let added = 0;
    for (const raw of names) {
      const name = raw.trim();
      if (!name || existing.has(name.toLowerCase())) continue;
      let idx = this.classes.firstEmptyIndex();
      if (idx < 0) idx = this.classes.add();
      for (let d = 0; d < DAYS.length; d++) this.classes.setLabel(idx, d, 'combined', name);
      existing.add(name.toLowerCase());
      added++;
    }
    if (added) this.emit();
    return added;
  }

  createCard(props: CardProps): Card {
    const card = new Card(this.nextId(), props);
    this.pool.add(card);
    this.ensureRoom(props.room);
    this.rememberColor(props.abbr, props.color);
    this.emit();
    return card;
  }

  updateCard(id: string, props: CardProps): void {
    this.pool.findById(id)?.update(props);
    this.ensureRoom(props.room);
    this.rememberColor(props.abbr, props.color);
    this.emit();
  }

  /**
   * Weist Karten ohne Farbe je Kürzel eine Farbe zu: konsistent zu bereits
   * vorhandenen Karten desselben Kürzels und ausgewogen über die Palette
   * (jeweils die am seltensten genutzte Farbe). Mutiert die übergebenen Karten.
   */
  fillCardColors(list: CardProps[]): void {
    const usage = new Map<string, number>();
    for (const c of PALETTE) usage.set(c, 0);
    const byAbbr = new Map<string, string>();
    const register = (color: string, abbr: string): void => {
      if (usage.has(color)) usage.set(color, (usage.get(color) ?? 0) + 1);
      const a = abbr.trim().toLowerCase();
      if (a && !byAbbr.has(a)) byAbbr.set(a, color);
    };
    // 1. Dauerhafte Zuordnung (über Importe hinweg) – hat Vorrang.
    for (const [a, color] of this.teacherColors) register(color, a);
    // 2. Bereits vorhandene Karten (falls noch nicht gemerkt).
    for (const c of this.pool.all) register(c.color, c.abbr);
    for (const p of this.schedule.all) register(p.color, p.abbr);

    const leastUsed = (): string => {
      let best: string = PALETTE[0];
      let min = Infinity;
      for (const color of PALETTE) {
        const u = usage.get(color) ?? 0;
        if (u < min) {
          min = u;
          best = color;
        }
      }
      return best;
    };

    for (const card of list) {
      const a = card.abbr.trim().toLowerCase();
      let color = byAbbr.get(a);
      if (!color) {
        color = card.color || leastUsed();
        byAbbr.set(a, color);
        if (usage.has(color)) usage.set(color, (usage.get(color) ?? 0) + 1);
      }
      card.color = color;
      if (a) this.teacherColors.set(a, color); // dauerhaft merken
    }
  }

  /** Merkt sich die Farbe eines Kürzels dauerhaft (für künftige Importe). */
  private rememberColor(abbr: string, color: string): void {
    const a = abbr.trim().toLowerCase();
    if (a && color) this.teacherColors.set(a, color);
  }

  /** Alle bekannten Kürzel (Pool + Plan + gemerkte) mit aktueller Farbe, alphabetisch. */
  teacherColorList(): { abbr: string; color: string }[] {
    const display = new Map<string, string>(); // lowercase → Anzeige-Kürzel
    for (const a of this.teacherAbbrs()) display.set(a.toLowerCase(), a);
    for (const k of this.teacherColors.keys()) if (!display.has(k)) display.set(k, k.toUpperCase());
    const firstColor = (lower: string): string => {
      const c = this.pool.all.find((x) => x.abbr.trim().toLowerCase() === lower);
      if (c) return c.color;
      const p = this.schedule.all.find((x) => x.abbr.trim().toLowerCase() === lower);
      return p ? p.color : PALETTE[0];
    };
    return [...display.entries()]
      .map(([lower, abbr]) => ({ abbr, color: this.teacherColors.get(lower) ?? firstColor(lower) }))
      .sort((a, b) => a.abbr.localeCompare(b.abbr, 'de'));
  }

  /** Setzt die Farbe eines Kürzels dauerhaft und färbt alle vorhandenen Karten/Platzierungen um. */
  setTeacherColor(abbr: string, color: string): void {
    const a = abbr.trim().toLowerCase();
    if (!a || !color) return;
    this.teacherColors.set(a, color);
    for (const c of this.pool.all) if (c.abbr.trim().toLowerCase() === a) c.color = color;
    // Platzierungen neu erzeugen (Farbe ist readonly).
    const updated = this.schedule.all.map((p) =>
      p.abbr.trim().toLowerCase() === a
        ? new Placement(p.id, { ...p.cardSnapshot(), color }, { day: p.day, startPeriod: p.startPeriod, classIdx: p.classIdx, week: p.week }, p.locked)
        : p,
    );
    this.schedule.replaceAll(updated);
    this.emit();
  }

  /** Erstellt mehrere Pool-Karten auf einmal (z. B. Excel-Import). */
  importCards(list: CardProps[]): number {
    for (const props of list) {
      this.pool.add(new Card(this.nextId(), props));
      this.ensureRoom(props.room);
    }
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

  /** Verschiedene Klassen mit Anzahl Karten (Pool + Plan), natürlich sortiert. */
  cardCountsByClass(): { klasse: string; count: number }[] {
    return this.cardCountByClass().map((r) => ({ klasse: r.klasse, count: r.total }));
  }

  /** Löscht alle Karten einer Klasse – im Pool und im Plan (auch fixierte). */
  deleteCardsByClass(klasse: string): void {
    const key = AppState.classKey(klasse);
    this.pool.replaceAll(this.pool.all.filter((c) => AppState.classKey(c.klasse) !== key));
    this.schedule.replaceAll(this.schedule.all.filter((p) => AppState.classKey(p.klasse) !== key));
    this.emit();
  }

  /** Vergleichs-Schlüssel einer Klasse (leere Klasse → „(ohne Klasse)"). */
  private static classKey(kl: string): string {
    return kl.trim() || '(ohne Klasse)';
  }

  /** Anzahl Karten je Klasse (Pool + Plan) – für den Soll-/Ist-Vergleich mit Untis
   *  und die Klassen-Verwaltung. `locked` = davon fixierte (verplante) Karten. */
  cardCountByClass(): { klasse: string; pool: number; placed: number; locked: number; total: number }[] {
    const m = new Map<string, { pool: number; placed: number; locked: number }>();
    const slot = (kl: string): { pool: number; placed: number; locked: number } => {
      const k = AppState.classKey(kl);
      let e = m.get(k);
      if (!e) {
        e = { pool: 0, placed: 0, locked: 0 };
        m.set(k, e);
      }
      return e;
    };
    for (const c of this.pool.all) slot(c.klasse).pool++;
    for (const p of this.schedule.all) {
      const e = slot(p.klasse);
      e.placed++;
      if (p.locked) e.locked++;
    }
    return [...m.entries()]
      .map(([klasse, v]) => ({ klasse, pool: v.pool, placed: v.placed, locked: v.locked, total: v.pool + v.placed }))
      .sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }));
  }

  /** Entplant alle NICHT fixierten Karten einer Klasse (zurück in den Pool);
   *  fixierte bleiben im Plan. Liefert die Anzahl verschobener Karten. */
  unplaceClass(klasse: string): number {
    const key = AppState.classKey(klasse);
    const moving = this.schedule.all.filter((p) => !p.locked && AppState.classKey(p.klasse) === key);
    for (const p of moving) this.pool.add(new Card(this.nextId(), p.cardSnapshot()));
    if (moving.length) {
      const ids = new Set(moving.map((p) => p.id));
      this.schedule.replaceAll(this.schedule.all.filter((p) => !ids.has(p.id)));
      this.emit();
    }
    return moving.length;
  }

  /** Löscht die FIXIERTEN verplanten Karten einer Klasse aus dem Plan (extra Schritt,
   *  da sie vom normalen Entplanen verschont bleiben). Liefert die Anzahl. */
  deleteLockedPlacedByClass(klasse: string): number {
    const key = AppState.classKey(klasse);
    const before = this.schedule.all.length;
    this.schedule.replaceAll(this.schedule.all.filter((p) => !(p.locked && AppState.classKey(p.klasse) === key)));
    const removed = before - this.schedule.all.length;
    if (removed) this.emit();
    return removed;
  }

  /** Löscht alle noch nicht verplanten (Pool-)Karten einer Klasse. Liefert die Anzahl. */
  deletePoolByClass(klasse: string): number {
    const key = AppState.classKey(klasse);
    const before = this.pool.all.length;
    this.pool.replaceAll(this.pool.all.filter((c) => AppState.classKey(c.klasse) !== key));
    const removed = before - this.pool.all.length;
    if (removed) this.emit();
    return removed;
  }

  // ── Lehrer-Sperrzeiten ────────────────────────────────────────────────────

  private static blockKey(day: number, week: Week, period: number): string {
    return `${day}|${week}|${period}`;
  }

  /** Alle Kürzel (aus Pool + Plan), alphabetisch – für die Auswahl im Sperrzeiten-Fenster. */
  teacherAbbrs(): string[] {
    const set = new Set<string>();
    for (const c of this.pool.all) if (c.abbr.trim()) set.add(c.abbr.trim());
    for (const p of this.schedule.all) if (p.abbr.trim()) set.add(p.abbr.trim());
    return [...set].sort((a, b) => a.localeCompare(b, 'de'));
  }

  /** Ist die Lehrkraft zu (Tag, Woche, Stunde) gesperrt? */
  isTeacherBlocked(abbr: string, day: number, week: Week, period: number): boolean {
    return this.teacherBlocks.get(abbr.trim().toLowerCase())?.has(AppState.blockKey(day, week, period)) ?? false;
  }

  /** Gesperrte Stunden einer Lehrkraft an (Tag, Woche) – für das Bearbeiten-Raster. */
  teacherBlockedPeriods(abbr: string, day: number, week: Week): Set<number> {
    const set = this.teacherBlocks.get(abbr.trim().toLowerCase());
    const out = new Set<number>();
    if (set) for (let p = 1; p <= PERIODS; p++) if (set.has(AppState.blockKey(day, week, p))) out.add(p);
    return out;
  }

  /** Schaltet eine Sperrzeit-Stunde um. */
  toggleTeacherBlock(abbr: string, day: number, week: Week, period: number): void {
    const key = abbr.trim().toLowerCase();
    if (!key) return;
    const set = this.teacherBlocks.get(key) ?? new Set<string>();
    const slot = AppState.blockKey(day, week, period);
    if (set.has(slot)) set.delete(slot);
    else set.add(slot);
    if (set.size) this.teacherBlocks.set(key, set);
    else this.teacherBlocks.delete(key);
    this.emit();
  }

  /** Entfernt alle Sperrzeiten einer Lehrkraft. */
  clearTeacherBlocks(abbr: string): void {
    if (this.teacherBlocks.delete(abbr.trim().toLowerCase())) this.emit();
  }

  /** Max. Anwesenheitstage einer Lehrkraft (0 = unbegrenzt). */
  teacherMaxDaysOf(abbr: string): number {
    return this.teacherMaxDays.get(abbr.trim().toLowerCase()) ?? 0;
  }

  /** Setzt die max. Anwesenheitstage einer Lehrkraft (0 = unbegrenzt). */
  setTeacherMaxDays(abbr: string, days: number): void {
    const key = abbr.trim().toLowerCase();
    if (!key) return;
    if (days > 0) this.teacherMaxDays.set(key, days);
    else this.teacherMaxDays.delete(key);
    this.emit();
  }

  /** Anzahl gesperrter Stunden je Lehrkraft (für die Liste im Fenster). */
  teacherBlockCount(abbr: string): number {
    return this.teacherBlocks.get(abbr.trim().toLowerCase())?.size ?? 0;
  }

  // ── Planungseinstellungen ─────────────────────────────────────────────────

  getPlanSettings(): PlanSettings {
    return { ...this.planSettings };
  }

  setPlanSettings(s: PlanSettings): void {
    this.planSettings = { ...DEFAULT_PLAN_SETTINGS, ...s };
    this.emit();
  }

  /** Anzahl Karten, die an (Klasse, Tag, Woche) die Startstunde der Position belegen. */
  slotCardCount(pos: PlacementPosition): number {
    let n = 0;
    for (const p of this.schedule.all) {
      if (p.classIdx !== pos.classIdx || p.day !== pos.day) continue;
      if (!p.occupiesWeek(pos.week)) continue;
      if (p.covers(pos.startPeriod)) n++;
    }
    return n;
  }

  /** Würde die Karte an dieser Position (Woche der Zielspalte) in eine Sperrzeit fallen? */
  cardHitsBlock(card: CardProps, pos: PlacementPosition): boolean {
    const periods = teachingPeriods(card.isWerkstatt, pos.startPeriod, card.duration);
    return periods.some((p) => this.isTeacherBlocked(card.abbr, pos.day, pos.week, p));
  }

  // ── Klassen-Sperrzeiten (z. B. Betriebstag) ──────────────────────────────

  getClassBlocks(): readonly ClassBlock[] {
    return this.classBlocks;
  }

  addClassBlock(block: ClassBlock): void {
    this.classBlocks.push({ ...block, klasse: block.klasse.trim(), text: block.text.trim() });
    this.emit();
  }

  removeClassBlockAt(index: number): void {
    if (index < 0 || index >= this.classBlocks.length) return;
    this.classBlocks.splice(index, 1);
    this.emit();
  }

  /** Sperrzeiten einer Klasse (per Name) an Tag+Woche. */
  classBlocksFor(klasse: string, day: number, week: Week): ClassBlock[] {
    const k = klasse.trim().toLowerCase();
    if (!k) return [];
    return this.classBlocks.filter((b) => b.klasse.toLowerCase() === k && b.day === day && b.week === week);
  }

  /** Ist die Stunde für die Klasse gesperrt? */
  isClassBlocked(klasse: string, day: number, week: Week, period: number): boolean {
    return this.classBlocksFor(klasse, day, week).some((b) => period >= b.from && period <= b.to);
  }

  /** Trifft die Karte an dieser Position eine Klassen-Sperrzeit? (für Drag&Drop) */
  cardHitsClassBlock(card: CardProps, pos: PlacementPosition): boolean {
    const klasse = this.classes.classNameAt(pos.classIdx, pos.day, pos.week);
    if (!klasse) return false;
    const periods = blockedPeriodsOf(card.isWerkstatt, pos.startPeriod, card.duration);
    return periods.some((p) => this.isClassBlocked(klasse, pos.day, pos.week, p));
  }

  /** Löscht mehrere nicht verplante (Pool-)Karten anhand ihrer IDs. */
  deletePoolCards(ids: string[]): number {
    const set = new Set(ids);
    const before = this.pool.all.length;
    this.pool.replaceAll(this.pool.all.filter((c) => !set.has(c.id)));
    const removed = before - this.pool.all.length;
    if (removed) this.emit();
    return removed;
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

  /**
   * Räume, die im Zeit-Slot der Platzierung frei sind (kein anderer Beleger im
   * selben Tag, derselben Woche und einer überlappenden Stunde). Die Platzierung
   * selbst (und ihr aktueller Raum) wird ausgeklammert. Quelle: zentrale Raumliste.
   */
  freeRoomsForPlacement(id: string): string[] {
    const pl = this.schedule.findById(id);
    if (!pl) return this.roomList();
    // Tatsächlich belegte Stunden (Werkstatt-Pause berücksichtigt) als Menge.
    const periods = new Set(pl.occupiedPeriods());
    const occupied = new Set<string>();
    for (const other of this.schedule.all) {
      if (other.id === id) continue;
      if (other.day !== pl.day) continue;
      const room = other.room.trim();
      if (!room) continue;
      if (!pl.weeks.some((w) => other.occupiesWeek(w))) continue;
      if (!other.occupiedPeriods().some((p) => periods.has(p))) continue;
      occupied.add(room.toLowerCase());
    }
    return this.roomList().filter((r) => !occupied.has(r.toLowerCase()));
  }

  /** Ändert den Raum einer Platzierung (Raum ist readonly → Platzierung neu erzeugen). */
  setPlacementRoom(id: string, room: string): void {
    const pl = this.schedule.findById(id);
    if (!pl) return;
    const r = room.trim();
    if (r === pl.room) return;
    this.schedule.remove(id);
    this.schedule.add(
      new Placement(
        pl.id,
        { ...pl.cardSnapshot(), room: r },
        { day: pl.day, startPeriod: pl.startPeriod, classIdx: pl.classIdx, week: pl.week },
        pl.locked,
      ),
    );
    this.emit();
  }

  /** Setzt die Kopplungs-ID einer Pool-Karte (zum Erstellen von Kopplungen). */
  setCardCoupling(id: string, coupling: string): void {
    const card = this.pool.findById(id);
    if (!card) return;
    card.coupling = coupling.trim();
    this.emit();
  }

  /** Setzt die Teamteaching-ID einer Karte (Pool oder Plan; platzierte werden neu erzeugt). */
  setCardTeam(id: string, value: string): void {
    const v = value.trim();
    const card = this.pool.findById(id);
    if (card) {
      card.teamTeaching = v;
      this.emit();
      return;
    }
    const pl = this.schedule.findById(id);
    if (!pl) return;
    this.schedule.remove(id);
    this.schedule.add(
      new Placement(
        this.nextId(),
        { ...pl.cardSnapshot(), teamTeaching: v },
        { day: pl.day, startPeriod: pl.startPeriod, classIdx: pl.classIdx, week: pl.week },
        pl.locked,
      ),
    );
    this.emit();
  }

  /** Alle Karten (Pool + Plan) mit Platzierungs-Info, für die Teamteaching-Zuordnung. */
  allCardsWithPlace(): (CardWithPlace & { id: string; teamTeaching: string })[] {
    const out: (CardWithPlace & { id: string; teamTeaching: string })[] = [];
    for (const c of this.pool.all) out.push({ id: c.id, abbr: c.abbr, fach: c.fach, klasse: c.klasse, teamTeaching: c.teamTeaching });
    for (const p of this.schedule.all)
      out.push({ id: p.id, abbr: p.abbr, fach: p.fach, klasse: p.klasse, teamTeaching: p.teamTeaching, day: p.day, startPeriod: p.startPeriod, duration: p.duration, week: p.week });
    return out.sort(
      (a, b) =>
        (b.teamTeaching ? 1 : 0) - (a.teamTeaching ? 1 : 0) ||
        a.teamTeaching.localeCompare(b.teamTeaching, 'de') ||
        a.klasse.localeCompare(b.klasse, 'de') ||
        a.abbr.localeCompare(b.abbr, 'de'),
    );
  }

  /** Alle Kopplungen (ID → beteiligte Karten, Pool + Plan), alphabetisch. */
  couplingGroups(): { id: string; members: CardWithPlace[] }[] {
    const map = new Map<string, CardWithPlace[]>();
    for (const c of this.pool.all) {
      if (!c.coupling.trim()) continue;
      const list = map.get(c.coupling.trim()) ?? [];
      list.push({ abbr: c.abbr, fach: c.fach, klasse: c.klasse });
      map.set(c.coupling.trim(), list);
    }
    for (const p of this.schedule.all) {
      if (!p.coupling.trim()) continue;
      const list = map.get(p.coupling.trim()) ?? [];
      list.push({ abbr: p.abbr, fach: p.fach, klasse: p.klasse, day: p.day, startPeriod: p.startPeriod, duration: p.duration, week: p.week });
      map.set(p.coupling.trim(), list);
    }
    return [...map.entries()]
      .map(([id, members]) => ({ id, members }))
      .sort((a, b) => a.id.localeCompare(b.id, 'de', { numeric: true }));
  }

  /** Alle Teamteaching-Gruppen (ID → beteiligte Karten, Pool + Plan), alphabetisch. */
  teamGroups(): { id: string; members: CardWithPlace[] }[] {
    const map = new Map<string, CardWithPlace[]>();
    for (const c of this.pool.all) {
      if (!c.teamTeaching.trim()) continue;
      (map.get(c.teamTeaching.trim()) ?? map.set(c.teamTeaching.trim(), []).get(c.teamTeaching.trim())!).push({
        abbr: c.abbr,
        fach: c.fach,
        klasse: c.klasse,
      });
    }
    for (const p of this.schedule.all) {
      if (!p.teamTeaching.trim()) continue;
      (map.get(p.teamTeaching.trim()) ?? map.set(p.teamTeaching.trim(), []).get(p.teamTeaching.trim())!).push({
        abbr: p.abbr,
        fach: p.fach,
        klasse: p.klasse,
        day: p.day,
        startPeriod: p.startPeriod,
        duration: p.duration,
        week: p.week,
      });
    }
    return [...map.entries()]
      .map(([id, members]) => ({ id, members }))
      .sort((a, b) => a.id.localeCompare(b.id, 'de', { numeric: true }));
  }

  /** Alle Karten mit aktivierter Kollision (Pool + Plan), nach Kürzel sortiert. */
  collisionCards(): CardWithPlace[] {
    const out: CardWithPlace[] = [];
    for (const c of this.pool.all) {
      if (c.collision) out.push({ abbr: c.abbr, fach: c.fach, klasse: c.klasse });
    }
    for (const p of this.schedule.all) {
      if (p.collision) {
        out.push({ abbr: p.abbr, fach: p.fach, klasse: p.klasse, day: p.day, startPeriod: p.startPeriod, duration: p.duration, week: p.week });
      }
    }
    return out.sort((a, b) => a.abbr.localeCompare(b.abbr, 'de'));
  }

  /** Alle Karten ohne Raum (Pool + Plan), sortiert nach Klasse, dann Lehrer. */
  roomlessCards(): (CardWithPlace & { id: string })[] {
    const out: (CardWithPlace & { id: string })[] = [];
    for (const c of this.pool.all) {
      if (!c.room.trim()) out.push({ id: c.id, abbr: c.abbr, fach: c.fach, klasse: c.klasse });
    }
    for (const p of this.schedule.all) {
      if (!p.room.trim()) {
        out.push({ id: p.id, abbr: p.abbr, fach: p.fach, klasse: p.klasse, day: p.day, startPeriod: p.startPeriod, duration: p.duration, week: p.week });
      }
    }
    return out.sort((a, b) => a.klasse.localeCompare(b.klasse, 'de') || a.abbr.localeCompare(b.abbr, 'de'));
  }

  /**
   * Setzt den Raum einer Karte (Pool oder Plan). Bei platzierten Karten wird geprüft,
   * ob der Raum zu dieser Zeit noch frei ist; ein Konflikt wird im Ergebnis gemeldet
   * (der Raum wird trotzdem gesetzt – die Entscheidung trifft der Anwender).
   */
  setRoom(id: string, room: string): { ok: boolean; conflictAbbr?: string } {
    const value = room.trim();
    this.ensureRoom(value);
    const card = this.pool.findById(id);
    if (card) {
      card.room = value;
      this.emit();
      return { ok: true };
    }
    const pl = this.schedule.findById(id);
    if (!pl) return { ok: false };
    let conflictAbbr: string | undefined;
    if (value) {
      const clash = this.schedule.all.find(
        (o) =>
          o.id !== id &&
          o.room.trim().toLowerCase() === value.toLowerCase() &&
          o.day === pl.day &&
          o.week === pl.week &&
          o.startPeriod <= pl.endPeriod &&
          pl.startPeriod <= o.endPeriod &&
          !(o.coupling && o.coupling === pl.coupling),
      );
      conflictAbbr = clash?.abbr;
    }
    this.schedule.remove(id);
    this.schedule.add(
      new Placement(
        this.nextId(),
        { ...pl.cardSnapshot(), room: value },
        { day: pl.day, startPeriod: pl.startPeriod, classIdx: pl.classIdx, week: pl.week },
        pl.locked,
      ),
    );
    this.emit();
    return { ok: true, conflictAbbr };
  }

  // ── Raumliste (zentral gepflegt) ─────────────────────────────────────────

  /** Sortierte Raumliste (manuell gepflegt + tatsächlich verwendete Räume). */
  roomList(): string[] {
    return [...new Set([...this.rooms, ...this.usedRooms()])].sort((a, b) => a.localeCompare(b, 'de'));
  }

  /** Fügt einen Raum zur Liste hinzu (Duplikate ignoriert). Gibt true bei Erfolg. */
  addRoom(name: string): boolean {
    const room = name.trim();
    if (!room) return false;
    if (this.rooms.some((r) => r.toLowerCase() === room.toLowerCase())) return false;
    this.rooms.push(room);
    this.emit();
    return true;
  }

  /** Entfernt einen Raum aus der manuell gepflegten Liste. */
  removeRoom(name: string): void {
    const key = name.trim().toLowerCase();
    const before = this.rooms.length;
    this.rooms = this.rooms.filter((r) => r.toLowerCase() !== key);
    if (this.rooms.length !== before) this.emit();
  }

  /** Tatsächlich auf Karten verwendete Räume. */
  private usedRooms(): string[] {
    const set = new Set<string>();
    for (const c of this.pool.all) if (c.room.trim()) set.add(c.room.trim());
    for (const p of this.schedule.all) if (p.room.trim()) set.add(p.room.trim());
    return [...set];
  }

  /** Alle bekannten Raumnamen (gepflegte Liste + verwendete). */
  private knownRooms(): string[] {
    return [...new Set([...this.rooms, ...this.usedRooms()])];
  }

  /**
   * Räume, die mit dem Präfix beginnen und – bei einer platzierten Karte – zu deren
   * Zeit noch frei sind (Vorschläge fürs Raum-Eingabefeld).
   */
  availableRooms(id: string, prefix: string): string[] {
    const pre = prefix.trim().toLowerCase();
    let rooms = this.knownRooms().filter((r) => !pre || r.toLowerCase().startsWith(pre));
    const pl = this.schedule.findById(id);
    if (pl) {
      rooms = rooms.filter(
        (room) =>
          !this.schedule.all.some(
            (o) =>
              o.id !== id &&
              o.room.trim().toLowerCase() === room.toLowerCase() &&
              o.day === pl.day &&
              o.week === pl.week &&
              o.startPeriod <= pl.endPeriod &&
              pl.startPeriod <= o.endPeriod &&
              !(o.coupling && o.coupling === pl.coupling),
          ),
      );
    }
    return rooms.sort((a, b) => a.localeCompare(b, 'de'));
  }

  /** Alle Karten (Pool + Plan) für den Excel-Export, sortiert nach Klasse, dann Lehrer. */
  allCardsForExport(): (CardProps & { placed: boolean; day: number | null; startPeriod: number | null; week: Week | null })[] {
    const rows = [
      ...this.pool.all.map((c) => ({ ...c.snapshot(), placed: false, day: null, startPeriod: null, week: null as Week | null })),
      ...this.schedule.all.map((p) => ({
        ...p.cardSnapshot(),
        placed: true,
        day: p.day as number | null,
        startPeriod: p.startPeriod as number | null,
        week: p.week as Week | null,
      })),
    ];
    return rows.sort(
      (a, b) => a.klasse.localeCompare(b.klasse, 'de') || a.abbr.localeCompare(b.abbr, 'de') || a.fach.localeCompare(b.fach, 'de'),
    );
  }

  /** Entfernt alle Kommentare (Pool + Plan). */
  clearAllComments(): void {
    for (const c of this.pool.all) c.comment = '';
    for (const p of this.schedule.all) p.comment = '';
    this.emit();
  }

  // ── Platzierungen ───────────────────────────────────────────────────────

  /** Erste Spalte, deren Klassenname an (Tag, Woche) passt (für gekoppelte Partner). */
  private findColumnForClass(klasse: string, day: number, week: Week): number | null {
    const need = klasse.trim().toLowerCase();
    if (!need) return null;
    for (let c = 0; c < this.classes.count; c++) {
      if (this.classes.classNameAt(c, day, week).trim().toLowerCase() === need) return c;
    }
    return null;
  }

  /** Verlinkt: gleiche Kopplungs-ID ODER gleiche Teamteaching-ID (beide nicht leer). */
  private areLinked(a: { coupling: string; teamTeaching: string }, b: { coupling: string; teamTeaching: string }): boolean {
    return (!!a.coupling && a.coupling === b.coupling) || (!!a.teamTeaching && a.teamTeaching === b.teamTeaching);
  }

  /** Verschiebt verlinkte Platzierungen (Kopplung/Team) auf denselben Zeit-Slot mit. */
  private repositionLinked(card: { coupling: string; teamTeaching: string }, pos: PlacementPosition, excludeId: string): void {
    if (!card.coupling && !card.teamTeaching) return;
    const partners = this.schedule.all.filter((p) => p.id !== excludeId && this.areLinked(card, p));
    for (const p of partners) {
      this.schedule.remove(p.id);
      this.schedule.add(
        new Placement(
          this.nextId(),
          p.cardSnapshot(),
          { day: pos.day, startPeriod: pos.startPeriod, classIdx: p.classIdx, week: pos.week },
          p.locked,
        ),
      );
    }
  }

  /** Pool-Karte in den Plan legen; die Pool-Karte wird verbraucht. */
  placeFromPool(cardId: string, pos: PlacementPosition): Placement | null {
    const card = this.pool.remove(cardId);
    if (!card) return null;
    const placement = new Placement(this.nextId(), card.snapshot(), pos);
    this.schedule.add(placement);
    // Verlinkte Partner (Kopplung/Team) aus dem Pool auf denselben Slot mitnehmen.
    if (placement.coupling || placement.teamTeaching) {
      for (const c of this.pool.all.filter((c) => this.areLinked(placement, c))) {
        const classIdx = this.findColumnForClass(c.klasse, pos.day, pos.week) ?? pos.classIdx;
        this.pool.remove(c.id);
        this.schedule.add(
          new Placement(this.nextId(), c.snapshot(), { day: pos.day, startPeriod: pos.startPeriod, classIdx, week: pos.week }),
        );
      }
    }
    this.emit();
    return placement;
  }

  /** Platzierung innerhalb des Plans verschieben (verlinkte Partner wandern mit). */
  movePlacement(placementId: string, pos: PlacementPosition): Placement | null {
    const old = this.schedule.remove(placementId);
    if (!old) return null;
    const placement = new Placement(this.nextId(), old.cardSnapshot(), pos);
    this.schedule.add(placement);
    this.repositionLinked(placement, pos, placement.id);
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

  /** Platzierung entfernen und als Karte zurück in den Pool legen (Partner mit). */
  /**
   * Aktualisiert die Karten-Eigenschaften einer VERPLANTEN Karte – Position und
   * Fixierung bleiben erhalten. Passt die Karte nicht mehr an ihren Platz (längere
   * Dauer über Stunde 9 hinaus oder Überlappung mit einer anderen Karte der
   * Spalte), wandert sie mit den neuen Eigenschaften in den Pool ('toPool').
   */
  updatePlacedCard(placementId: string, props: CardProps): 'updated' | 'toPool' | null {
    const pl = this.schedule.findById(placementId);
    if (!pl) return null;
    const pos: PlacementPosition = { day: pl.day, startPeriod: pl.startPeriod, classIdx: pl.classIdx, week: pl.week };
    const locked = pl.locked;
    this.schedule.remove(placementId);
    const candidate = new Placement(this.nextId(), props, pos, locked);
    const fitsRaster = pos.startPeriod + props.duration - 1 <= PERIODS;
    const periods = new Set(candidate.occupiedPeriods());
    const overlaps = this.schedule.all.some(
      (p) =>
        p.classIdx === pos.classIdx &&
        p.day === pos.day &&
        p.occupiesWeek(pos.week) &&
        p.occupiedPeriods().some((q) => periods.has(q)),
    );
    if (!fitsRaster || (overlaps && props.duration > pl.duration)) {
      this.pool.add(new Card(this.nextId(), props));
      this.emit();
      return 'toPool';
    }
    this.schedule.add(candidate);
    this.emit();
    return 'updated';
  }

  /** Löscht eine VERPLANTE Stunde endgültig (ohne Rückkehr in den Pool; Strg+Z möglich).
   *  Gekoppelte/Team-Partner bleiben liegen – es wird nur diese eine Karte entfernt. */
  deletePlacement(placementId: string): Placement | null {
    const placement = this.schedule.remove(placementId);
    if (!placement) return null;
    this.emit();
    return placement;
  }

  returnToPool(placementId: string): Placement | null {
    const placement = this.schedule.remove(placementId);
    if (!placement) return null;
    this.pool.add(new Card(this.nextId(), placement.cardSnapshot()));
    // Verlinkte Partner (Kopplung/Team) ebenfalls zurück in den Pool.
    if (placement.coupling || placement.teamTeaching) {
      for (const p of this.schedule.all.filter((p) => this.areLinked(placement, p))) {
        this.schedule.remove(p.id);
        this.pool.add(new Card(this.nextId(), p.cardSnapshot()));
      }
    }
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

  /** Entplant alle nicht fixierten Karten; fixierte (Schloss) bleiben im Plan. */
  unplaceUnlocked(): number {
    const toPool = this.schedule.all.filter((p) => !p.locked);
    for (const p of toPool) this.pool.add(new Card(this.nextId(), p.cardSnapshot()));
    this.schedule.replaceAll(this.schedule.all.filter((p) => p.locked));
    if (toPool.length) this.emit();
    return toPool.length;
  }

  /** Anzahl platzierter Karten gesamt. */
  get totalPlacedCount(): number {
    return this.schedule.all.length;
  }

  /** Anzahl fixierter (mit Schloss) Platzierungen. */
  get lockedPlacedCount(): number {
    return this.schedule.all.filter((p) => p.locked).length;
  }

  /** Platzierte Karten je Kürzel (für die Entplan-Auswahl), alphabetisch. */
  placedCountsByAbbr(): { abbr: string; count: number }[] {
    const map = new Map<string, number>();
    for (const p of this.schedule.all) map.set(p.abbr, (map.get(p.abbr) ?? 0) + 1);
    return [...map.entries()]
      .map(([abbr, count]) => ({ abbr, count }))
      .sort((a, b) => a.abbr.localeCompare(b.abbr));
  }

  /** Entplant alle Karten eines Kürzels (zurück in den Pool). */
  unplaceByAbbr(abbr: string): number {
    const matching = this.schedule.all.filter((p) => p.abbr === abbr);
    for (const p of matching) this.pool.add(new Card(this.nextId(), p.cardSnapshot()));
    this.schedule.replaceAll(this.schedule.all.filter((p) => p.abbr !== abbr));
    this.emit();
    return matching.length;
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

  /** Setzt alle Klassen-Spalten auf den leeren Standard (Platzhalter u+g / u / g). */
  resetAllClasses(): void {
    this.classes.resetAll();
    this.emit();
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
    const seenCoupling = new Set<string>(); // gekoppelte Stunde nur einmal zählen
    for (const p of this.schedule.all) {
      const row =
        map.get(p.abbr) ?? { abbr: p.abbr, fach: p.fach, name: p.name, color: p.color, hoursU: 0, hoursG: 0 };
      // Block-/Sperrkarten (noCount) zählen nicht. Gekoppelte Karten je Lehrkraft
      // nur einmal: gleiche Lehrkraft in 2 Klassen = 1 Stunde; verschiedene
      // Lehrkräfte in einer Kopplung = jede zählt.
      let countIt = !p.noCount;
      if (countIt && p.coupling) {
        const key = `${p.coupling}|${p.abbr.toLowerCase()}|${p.day}|${p.startPeriod}|${p.week}`;
        if (seenCoupling.has(key)) countIt = false;
        else seenCoupling.add(key);
      }
      if (countIt) {
        const h = p.duration * semesterFactor(p) * (p.isVierwoechig ? 0.5 : 1);
        // Wöchentlich zählt in beiden Wochen; u-/g-Stunden nur in ihrer Woche.
        for (const w of p.weeks) {
          if (w === 'u') row.hoursU += h;
          else row.hoursG += h;
        }
      }
      map.set(p.abbr, row);
    }
    for (const c of this.pool.all) {
      if (!map.has(c.abbr)) {
        map.set(c.abbr, { abbr: c.abbr, fach: c.fach, name: c.name, color: c.color, hoursU: 0, hoursG: 0 });
      }
    }
    return [...map.values()].sort((a, b) => a.abbr.localeCompare(b.abbr));
  }

  // ── Automatisches Verplanen ─────────────────────────────────────────────

  /**
   * Verteilt die Pool-Karten greedy nach den Planungsregeln (PLANUNGSREGELN.md):
   * – Karte nur in eine Spalte, deren Klassenname passt.
   * – 7. Stunde frei (außer Werkstatt), Pflichtbereich 1–6 wird zuerst gefüllt.
   * – Lehrer max. 6 Std/Tag, max. 4 Std am Stück je Klasse (außer Werkstatt).
   * – Hauptfächer (D/M/E/Gk/Wk) max. 2 Std/Tag, LBT max. 6 Std/Tag, Fächer variieren.
   * – Werkstatt als Block, Stunde 5 bleibt Pause, 7. Stunde erlaubt.
   * – Gruppe a wird auf eine bereits liegende Gruppe b gelegt (Labor und Werkstatt).
   * Es werden sehr viele Durchläufe (Zyklen) mit variierter Reihenfolge probiert,
   * bis alle Karten verplant sind UND die u/g-Differenz aller Lehrkräfte ≤ 2 ist
   * oder das Zeitbudget erreicht ist. Läuft asynchron in Zeitscheiben, damit die
   * UI nicht einfriert; per shouldStop abbrechbar/vorzeitig übernehmbar.
   * Bereits platzierte (auch fixierte) Karten bleiben unangetastet.
   */
  async planBest(opts: {
    budgetMs: number;
    shouldStop: () => 'continue' | 'accept' | 'cancel';
    onProgress?: (p: PlanProgress) => void;
  }): Promise<PlanRunResult> {
    const cfg = this.planSettings;
    const MAX_STREAK = cfg.maxStreak; // max. Stunden am Stück derselben Lehrkraft in einer Klasse (außer Werkstatt)
    const LBT_MAX = cfg.lbtMax; // max. Stunden „LBT" je Klasse und Tag
    const IMBAL = cfg.imbalanceLimit; // erlaubte u/g-Differenz
    const GAP_LIMIT = cfg.gapLimit; // erlaubte Hohlstunden je Lehrkraft+Woche
    const maxDaysOf = (abbr: string): number => this.teacherMaxDays.get(abbr.toLowerCase()) ?? 0;
    // Hauptfach: NUR wenn in der Excel-Spalte „Hauptfach" ein „x" gesetzt ist
    // (keine automatische Erkennung mehr über den Fachnamen).
    const isMain = (c: { mainSubject: boolean }): boolean => c.mainSubject;
    // Seminarkurs (A_SK1/B_SK1/A_SK2/B_SK2 …): fest auf Montag 8.+9. Stunde
    // (Mittag, mit den Betrieben ist der Montag dafür reserviert).
    const isSk = (c: { fach: string }): boolean => /^([abcd][_-])?sk\d*$/i.test(c.fach.trim());
    // Spanisch (SB1/SB2/SB3): nur Randstunden 1.+2. ODER 8.+9. (nicht alle Schüler).
    const isSpan = (c: { fach: string }): boolean => /^([abcd][_-])?sb\d+$/i.test(c.fach.trim());
    // OLZ (in AV1–AV4): möglichst Randstunden 1.+2. ODER 8.+9.; soll in allen 4 Klassen
    // GLEICHZEITIG liegen → in der Excel als Schiene/Kopplung über die AV-Klassen anlegen.
    const isOlz = (c: { fach: string }): boolean => /(^|[^a-z])olz([^a-z]|$)/i.test(c.fach.trim());
    // Betrieb (Klasse im Betrieb): Fach enthält „Betrieb". Je Klasse ein fester
    // Betriebstag (Tag-Index 0=Mo …). Erweiterbar: hier weitere Klassen ergänzen.
    const isBetrieb = (c: { fach: string }): boolean => /betrieb/i.test(c.fach);
    const BETRIEB_DAY = new Map<string, number>([
      ['1bfb', 0], // 1BFB → Montag
      ['1bfk', 2], // 1BFK → Mittwoch
    ]); // Betriebstag je Klasse (Tag-Index 0=Mo … 4=Fr)
    // Klassen, in denen ein 8-Stunden-Lehrer-Tag (am Stück) normal/erlaubt ist
    // (randvolle Berufsschulklassen mit wenigen Anwesenheitstagen).
    const LONG_DAY_CLASSES = new Set<string>(['k2fr', 'k3fr']);
    const isLongDay = (c: { klasse: string }): boolean => LONG_DAY_CLASSES.has(c.klasse.trim().toLowerCase());
    // Raumtreue: Schüler sollen möglichst im selben Raum bleiben (wenig „herumlaufen").
    // Ausnahmen mit eigenem Fachraum: Labor, Werkstatt sowie Chemie (CH) und Physik (PH).
    const CH_PH = new Set(['ch', 'ph', 'chemie', 'physik']);
    const roomFlexible = (c: { isLabor: boolean; isWerkstatt: boolean; fach: string }): boolean =>
      c.isLabor || c.isWerkstatt || CH_PH.has(c.fach.trim().toLowerCase().replace(/^[abcd][_-]/, ''));
    // Schlüssel für u/g-Parallelität: gleiche Lehrkraft + Klasse + Fach.
    const mirrorKey = (c: { abbr: string; klasse: string; fach: string }): string =>
      `${c.abbr.toLowerCase()}|${c.klasse.trim().toLowerCase()}|${c.fach.trim().toLowerCase()}`;

    const cK = (d: number, w: Week, c: number, p: number) => `${d}|${w}|${c}|${p}`;
    const rK = (d: number, w: Week, p: number, room: string) => `${d}|${w}|${p}|${room.toLowerCase()}`;
    const tK = (abbr: string, d: number, w: Week, p: number) => `${abbr.toLowerCase()}|${d}|${w}|${p}`;
    const thK = (abbr: string, d: number, w: Week) => `${abbr.toLowerCase()}|${d}|${w}`;
    const tcK = (abbr: string, c: number, d: number, w: Week, p: number) => `${abbr.toLowerCase()}|${c}|${d}|${w}|${p}`;
    const sK = (kl: string, d: number, w: Week, fach: string) =>
      `${kl.trim().toLowerCase()}|${d}|${w}|${fach.trim().toLowerCase()}`;

    /** Tatsächlich unterrichtete Stunden (ohne Werkstatt-Pause in der 5.). */
    // noPause=true: Werkstatt OHNE die 5.-Stunden-Pause (durchgehend) – für kurze 4h-Blöcke
    // (z. B. AV1/AV2 auf 3.–6. = 3,4,5,6), wo die Pause-Regel übergangen werden darf.
    // Start = 5 gilt IMMER als pausenlos (keine Pause vor Blockbeginn) – identisch zu
    // periods.ts, damit Planer- und App-Sicht (occupiedPeriods) übereinstimmen.
    const teaching = (isWerk: boolean, start: number, dur: number, noPause = false): number[] => {
      if (!isWerk || noPause || start === 5) {
        const a: number[] = [];
        for (let i = 0; i < dur; i++) a.push(start + i);
        return a;
      }
      const t: number[] = [];
      let p = start;
      while (t.length < dur && p <= PERIODS) {
        if (p !== 5) t.push(p);
        p++;
      }
      return t;
    };

    /** Belegte Stunden inkl. Werkstatt-Pause (5.), wenn sie im Block liegt. */
    const blockedPeriods = (isWerk: boolean, start: number, dur: number, noPause = false): number[] => {
      const t = teaching(isWerk, start, dur, noPause);
      if (isWerk && !noPause && t.length && start < 5 && t[t.length - 1] >= 5) return [...t, 5].sort((a, b) => a - b);
      return t;
    };

    const shuffle = <T>(arr: T[], rng: () => number): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    type Place = { abbr: string; room: string; duration: number; isWerkstatt: boolean; isLabor: boolean; labGroup: string; fach: string };
    // Stapelbar: Labor-/Werkstatt-/Betrieb-Karte mit Gruppe a/b/c/d (bis zu 4 parallel).
    // Betrieb: am Betriebstag ist die ganze Klasse (Gruppe a + b) gleichzeitig im Betrieb.
    const GROUPS = ['a', 'b', 'c', 'd'];
    const stackable = (p: { isLabor: boolean; isWerkstatt: boolean; labGroup: string; fach: string }): boolean =>
      (p.isLabor || p.isWerkstatt || isBetrieb(p)) && GROUPS.includes(p.labGroup);
    const EMPTY_FOCUS: ReadonlySet<string> = new Set();
    type Assign = { card: Card; c: number; d: number; w: Week; start: number };
    interface Outcome {
      assigns: Assign[];
      skipped: { card: string; reason: string }[];
      openMandatory: number;
      /** Summe der Überschreitungen der erlaubten u/g-Differenz JE LEHRKRAFT (für die
       *  Optimierung; treibt jede einzelne Lehrkraft Richtung Limit, Gesamtsumme egal). */
      imbalance: number;
      /** Anzahl Lehrkräfte mit u/g-Differenz ÜBER dem Limit (für die Anzeige/Meldung). */
      imbalTeachers: number;
      /** Summe der Hohlstunden über dem Limit (6) über alle Lehrkraft-Wochen. */
      gaps: number;
      /** Nicht-parallele Stunden: gleiche Lehrkraft+Klasse+Fach, die nur in einer
       *  Woche liegen (kleiner = mehr u/g parallel). */
      mirrorMismatch: number;
      /** Anzahl distinkter OLZ-Slots (Tag|Stunde|Woche): klein = OLZ in allen AV-Klassen
       *  zeitgleich auf denselben Schienen. */
      olzSlotsCount: number;
      /** Hohlstunden über alle KLASSEN-Tage (harte Schüler-Regel: 0 = durchweg
       *  Unterricht; Pause 7. bzw. 5. an Werkstatt-Tagen ausgenommen). */
      classGapsTotal: number;
    }

    // Werkstatt: 4-stündig auch nachmittags (6.–9.) möglich – die Bewertung
    // bevorzugt den Nachmittag, damit der Morgen für Theorie frei bleibt.
    const baseStarts = (card: Card): number[] =>
      isBetrieb(card)
        ? [1, 5].filter((s) => s + card.duration - 1 <= 9) // Betrieb: Blöcke 1.–4. und 5.–8. (ganzer Tag = 2×4h je Gruppe)
        : isSk(card)
          ? [7, 8, 9].filter((s) => s + card.duration - 1 <= 9).reverse() // Seminarkurs: Block im Fenster 7.–9. (Montag erzwingt check())
          : isSpan(card) || isOlz(card)
            ? [1, 8].filter((s) => s + card.duration - 1 <= 9) // Spanisch/OLZ: nur Randstunden 1.+2. oder 8.+9.
            : card.isWerkstatt
            ? card.duration <= 4
              ? [1, 6]
              : [1]
            : [1, 2, 3, 4, 5, 6, 8]; // inkl. Labor: 1.–6. und 8.+9. (die 7. ist über check() gesperrt)

    /**
     * Ein vollständiger Verplanungs-Durchlauf auf einer eigenen Belegungs-Simulation.
     * Bestehende Platzierungen (auch fixierte) werden NICHT verschoben, sondern nur
     * als Belegung berücksichtigt. shuffleOrder=true variiert die Reihenfolge.
     */
    // Reparatur (teuer) nur auf aussichtsreichen Läufen ausführen: erst wenn dieser Lauf
    // mindestens so viele Karten platziert wie das bisher beste Ergebnis (Tempo schonen).
    let bestPlaced = 0;
    // focus = IDs zuletzt NICHT verplanter Karten → in diesem Durchlauf ZUERST platzieren,
    // damit sie die knappen Slots gewinnen (gezielter Neustart statt rein zufällig).
    const runOnce = (shuffleOrder: boolean, rng: () => number, focus: ReadonlySet<string> = EMPTY_FOCUS): Outcome => {
      const cell = new Set<string>();
      const roomSet = new Set<string>();
      const teachSet = new Set<string>();
      const teachClass = new Set<string>(); // Lehrer unterrichtet in dieser Klasse: kürzel|c|d|w|p
      const teachH = new Map<string, number>();
      const teachWerkLaborDay = new Set<string>(); // kürzel|d|w mit Werkstatt/Labor → 8 statt 6 Std erlaubt
      const teachWeek = new Map<string, [number, number]>(); // kürzel → [u-Stunden, g-Stunden]
      const teachDayPeriods = new Map<string, Set<number>>(); // kürzel|d|w → belegte Stunden (für Hohlstunden)
      const teachDaysUsed = new Map<string, Set<number>>(); // kürzel → genutzte Wochentage (für max. Anwesenheitstage)
      const subj = new Map<string, number>(); // klasse|d|w|fach → Stunden (alle Fächer)
      const mirrorSlots = new Map<string, Set<string>>(); // kürzel|klasse|fach → belegte „tag|start|woche" (für u/g-Parallelität)
      const olzSlots = new Map<string, number>(); // „tag|start" → Anzahl OLZ-Karten (für zeitgleiche OLZ über die AV-Klassen, ohne Kopplung)
      const spanDays = new Map<string, Set<number>>(); // klasse|w → Spanisch-Tage (für Tag-Pause)
      const spanStarts = new Map<string, Set<number>>(); // klasse|w → genutzte Randstunden 1/8 (für 1+2/8+9-Alternation)
      // Belegung je Zelle (für a-auf-b-Stapeln): total = alle Karten, stack = stapelbare
      // Labor/Werkstatt-Karten, groups = deren Gruppen (a/b). Erlaubt Stapeln auch über
      // getrennte Kopplungen (z. B. A_SK1 auf B_SK1), höchstens 2 je Stapel.
      const cellOcc = new Map<string, { total: number; stack: number; groups: Set<string> }>();
      const classDayRooms = new Map<string, Set<string>>(); // c|d|w → bereits genutzte (nicht-flexible) Räume der Klasse
      const werkClassDay = new Set<string>(); // c|d|w mit Werkstatt → Klassen-Pause in der 5. statt 7. Stunde
      // KLASSEN-SPERRZEITEN (z. B. Betriebstag): gesperrte Zellen je Spalte vorab
      // auflösen – der Planer legt dort nichts hin, Lücken zählen nicht als Hohlstunde.
      const classBlockedCells = new Set<string>();
      for (const b of this.classBlocks) {
        for (let c = 0; c < this.classes.count; c++) {
          if (this.classes.classNameAt(c, b.day, b.week).trim().toLowerCase() !== b.klasse.toLowerCase()) continue;
          for (let p = b.from; p <= b.to; p++) classBlockedCells.add(cK(b.day, b.week, c, p));
        }
      }
      const groupB: { c: number; d: number; w: Week; start: number; duration: number; isWerk: boolean; klasse: string }[] = [];
      const assigns: Assign[] = [];
      const skipped: { card: string; reason: string }[] = [];

      // countTeacher=false bei gekoppelten Folge-Karten: gleiche Lehrerstunde nur einmal zählen.
      const occupy = (card: Place, kl: string, c: number, d: number, w: Week, start: number, countTeacher = true, noPause = false): void => {
        // Lehrerlose Karten (kein Kürzel, z. B. „Betrieb") belegen nur den Klassen-Slot/
        // Raum – sie erzeugen KEINE Lehrer-Konflikte/-Stunden (sonst würden mehrere
        // lehrerlose Karten klassenübergreifend fälschlich kollidieren).
        const hasAbbr = !!card.abbr.trim();
        let dayPeriods: Set<number> | undefined;
        if (hasAbbr) {
          dayPeriods = teachDayPeriods.get(thK(card.abbr, d, w));
          if (!dayPeriods) {
            dayPeriods = new Set();
            teachDayPeriods.set(thK(card.abbr, d, w), dayPeriods);
          }
        }
        const canStack = stackable(card);
        for (const p of blockedPeriods(card.isWerkstatt, start, card.duration, noPause)) {
          const key = cK(d, w, c, p);
          cell.add(key);
          const e = cellOcc.get(key) ?? { total: 0, stack: 0, groups: new Set<string>() };
          e.total++;
          if (canStack) {
            e.stack++;
            e.groups.add(card.labGroup);
          }
          cellOcc.set(key, e);
          if (card.room) roomSet.add(rK(d, w, p, card.room));
          if (hasAbbr) {
            teachSet.add(tK(card.abbr, d, w, p));
            dayPeriods!.add(p);
          }
        }
        if (hasAbbr) {
          for (const p of teaching(card.isWerkstatt, start, card.duration, noPause)) teachClass.add(tcK(card.abbr, c, d, w, p));
          const ad = card.abbr.toLowerCase();
          (teachDaysUsed.get(ad) ?? teachDaysUsed.set(ad, new Set()).get(ad)!).add(d);
          // Tag mit Werkstatt/Labor → an dem Tag darf die Lehrkraft 8 statt 6 Std haben.
          if (card.isWerkstatt || card.isLabor) teachWerkLaborDay.add(thK(card.abbr, d, w));
          if (countTeacher) {
            teachH.set(thK(card.abbr, d, w), (teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration);
            const tw = teachWeek.get(ad) ?? [0, 0];
            tw[w === 'u' ? 0 : 1] += card.duration;
            teachWeek.set(ad, tw);
          }
        }
        if (card.isWerkstatt) werkClassDay.add(`${c}|${d}|${w}`);
        // Raumtreue: genutzten Raum der Klasse je Tag merken (außer Labor/Werkstatt/CH/PH).
        if (card.room.trim() && !roomFlexible(card)) {
          const rkk = `${c}|${d}|${w}`;
          (classDayRooms.get(rkk) ?? classDayRooms.set(rkk, new Set()).get(rkk)!).add(card.room.trim().toLowerCase());
        }
        const f = card.fach.trim().toLowerCase();
        if (f) subj.set(sK(kl, d, w, f), (subj.get(sK(kl, d, w, f)) ?? 0) + card.duration);
        const mk = mirrorKey({ abbr: card.abbr, klasse: kl, fach: card.fach });
        (mirrorSlots.get(mk) ?? mirrorSlots.set(mk, new Set()).get(mk)!).add(`${d}|${start}|${w}`);
        if (isOlz(card)) {
          const ok = `${d}|${start}|${w}`; // OLZ-Slot (Tag+Stunde+Woche), klassenübergreifend zeitgleich
          olzSlots.set(ok, (olzSlots.get(ok) ?? 0) + 1);
        }
        if (isSpan(card)) {
          const rk = kl.trim().toLowerCase(); // pro Klasse (wochenübergreifend)
          (spanDays.get(rk) ?? spanDays.set(rk, new Set()).get(rk)!).add(d);
          (spanStarts.get(rk) ?? spanStarts.set(rk, new Set()).get(rk)!).add(start);
        }
      };

      /** Spanisch-Bewertung: Tag-Pause (kein Nachbartag) + Randstunden-Alternation (1↔8). */
      const spanScore = (klasse: string, d: number, _w: Week, start: number): { adj: number; same: number } => {
        const rk = klasse.trim().toLowerCase();
        const days = spanDays.get(rk);
        const adj = days && (days.has(d) || days.has(d - 1) || days.has(d + 1)) ? 1 : 0;
        const same = spanStarts.get(rk)?.has(start) ? 1 : 0;
        return { adj, same };
      };

      /** 1, wenn die Karte am Klassentag einen ANDEREN als den bereits genutzten Raum
       *  einführt (= Raumwechsel/„herumlaufen"); sonst 0. Labor/Werkstatt/CH/PH ausgenommen. */
      const roomChange = (card: { room: string; isLabor: boolean; isWerkstatt: boolean; fach: string }, c: number, d: number, w: Week): number => {
        if (!card.room.trim() || roomFlexible(card)) return 0;
        const s = classDayRooms.get(`${c}|${d}|${w}`);
        return s && s.size > 0 && !s.has(card.room.trim().toLowerCase()) ? 1 : 0;
      };

      /** Aktuelle Stunden der Lehrkraft in der angegebenen Woche (für den Ausgleich). */
      const teacherWeekLoad = (abbr: string, w: Week): number =>
        (teachWeek.get(abbr.toLowerCase()) ?? [0, 0])[w === 'u' ? 0 : 1];

      /** Liegt dieselbe Lehrkraft+Klasse+Fach in der ANDEREN Woche schon auf (d, start)?
       *  → dann ist die Platzierung an diesem Slot parallel (u und g gleich). */
      const hasMirror = (card: { abbr: string; klasse: string; fach: string }, d: number, w: Week, start: number): boolean => {
        const other: Week = w === 'u' ? 'g' : 'u';
        return mirrorSlots.get(mirrorKey(card))?.has(`${d}|${start}|${other}`) ?? false;
      };

      // Bestehende Platzierungen als Belegung übernehmen (bleiben unangetastet).
      const seenSeedCoupling = new Set<string>();
      for (const pl of this.schedule.all) {
        for (const w of pl.weeks) {
          let countTeacher = true;
          if (pl.coupling) {
            const key = `${pl.coupling}|${pl.abbr.toLowerCase()}|${pl.day}|${pl.startPeriod}|${w}`;
            if (seenSeedCoupling.has(key)) countTeacher = false;
            else seenSeedCoupling.add(key);
          }
          occupy(pl, pl.klasse, pl.classIdx, pl.day, w, pl.startPeriod, countTeacher);
          if (pl.labGroup === 'b') {
            groupB.push({ c: pl.classIdx, d: pl.day, w, start: pl.startPeriod, duration: pl.duration, isWerk: pl.isWerkstatt, klasse: pl.klasse });
          }
        }
      }

      /** Länge des zusammenhängenden Blocks derselben Lehrkraft in dieser Klasse inkl. neuer Stunden. */
      const streak = (abbr: string, c: number, d: number, w: Week, start: number, end: number): number => {
        let run = end - start + 1;
        for (let p = start - 1; p >= 1 && teachClass.has(tcK(abbr, c, d, w, p)); p--) run++;
        for (let p = end + 1; p <= PERIODS && teachClass.has(tcK(abbr, c, d, w, p)); p++) run++;
        return run;
      };

      const check = (card: Card, c: number, d: number, w: Week, start: number, stackOnB = false, noPause = false): string | null => {
        // Seminarkurs (A_SK1/B_SK1/A_SK2/B_SK2): FEST auf Montag, Block im Fenster 7.–9.
        // (eigentlich 8.–10., aber das Raster endet bei der 9.). Fixe Bedingung.
        if (isSk(card) && (d !== 0 || start < 7 || start + card.duration - 1 > 9)) return 'Sk nur Mo 7.–9.';
        // Betrieb am festgelegten Betriebstag der Klasse (z. B. 1BFB = Montag).
        if (isBetrieb(card)) {
          const bd = BETRIEB_DAY.get(card.klasse.trim().toLowerCase());
          if (bd !== undefined && d !== bd) return `Betrieb nur ${DAYS[bd]}`;
        }
        const teach = teaching(card.isWerkstatt, start, card.duration, noPause);
        if (teach.length < card.duration) return 'über Stunde 9';
        const blk = blockedPeriods(card.isWerkstatt, start, card.duration, noPause);
        if (Math.max(...blk) > PERIODS) return 'über Stunde 9';
        // 7. Stunde ist Mittagspause (außer Werkstatt) – Seminarkurs darf 7.–9. belegen,
        // Betrieb (Ganztags-Block) ebenfalls. Labor liegt in 1.–6./8.–9., NICHT in der 7.
        if (cfg.forbidSeventh && !card.isWerkstatt && !isSk(card) && !isBetrieb(card) && teach.includes(7))
          return '7. Stunde frei';
        if (cfg.mainNoLate && isMain(card) && teach.some((p) => p > 6)) return 'Hauptfach 8./9. gesperrt';
        for (const p of teach) if (this.isTeacherBlocked(card.abbr, d, w, p)) return 'Lehrer-Sperrzeit';
        const md = maxDaysOf(card.abbr);
        if (md > 0) {
          const used = teachDaysUsed.get(card.abbr.toLowerCase());
          if (used && !used.has(d) && used.size >= md) return 'max. Anwesenheitstage';
        }
        // Klassen-Sperrzeit (z. B. Betriebstag): dort wird nie etwas verplant.
        for (const p of blk) if (classBlockedCells.has(cK(d, w, c, p))) return 'Klassen-Sperrzeit';
        const canStack = stackable(card);
        for (const p of blk) {
          const e = cellOcc.get(cK(d, w, c, p));
          if (!stackOnB && e && e.total > 0) {
            // Stapeln nur, wenn ALLE Belegungen stapelbar sind, eine ANDERE Gruppe
            // ergänzen (a/b/c/d, jede nur einmal) und höchstens 4 Karten entstehen.
            const compatible =
              canStack && e.total === e.stack && e.stack < 4 && !e.groups.has(card.labGroup);
            if (!compatible) return 'Platz belegt';
          }
          // Auch beim gezielten Stapeln auf den Partner (stackOnB) darf DIESELBE Gruppe
          // nicht schon in der Zelle liegen (sonst z. B. zwei b-Karten übereinander).
          if (stackOnB && e && e.groups.has(card.labGroup)) return 'Platz belegt';
          if (card.room && roomSet.has(rK(d, w, p, card.room))) return 'Raum belegt';
          if (teachSet.has(tK(card.abbr, d, w, p))) return 'Lehrer belegt';
        }
        // Lehrer max. 6 Std/Tag – ABER 8 Std, wenn der Tag Werkstatt/Labor enthält oder
        // die Klasse einen 8-Std-Tag erlaubt (K2FR/K3FR); Betrieb ist lehrerlos/Ganztag.
        const dayMax =
          card.isWerkstatt || card.isLabor || isBetrieb(card) || isLongDay(card) || teachWerkLaborDay.has(thK(card.abbr, d, w))
            ? 8
            : 6;
        if ((teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration > dayMax) return `Lehrer >${dayMax} Std/Tag`;
        // „am Stück": Werkstatt/Betrieb ohne Limit; 8-Std-Klassen bis 8, sonst MAX_STREAK.
        const streakMax = isBetrieb(card) || isLongDay(card) ? 8 : MAX_STREAK;
        if (!card.isWerkstatt && streak(card.abbr, c, d, w, start, start + card.duration - 1) > streakMax)
          return `max. ${streakMax} Std am Stück`;
        const f = card.fach.trim().toLowerCase();
        if (isMain(card) && (subj.get(sK(card.klasse, d, w, f)) ?? 0) + card.duration > 2) return 'Hauptfach >2/Tag';
        if (f === 'lbt' && (subj.get(sK(card.klasse, d, w, f)) ?? 0) + card.duration > LBT_MAX) return 'LBT >6/Tag';
        return null;
      };

      /** Lücken in der Klassenspalte (zwischen erster und letzter Stunde) nach dem
       *  hypothetischen Belegen von newPeriods. Pausen zählen nicht als Lücke:
       *  die 7. Stunde (Mittagspause) sowie die 5. an Werkstatt-Tagen der Klasse. */
      const classGaps = (c: number, d: number, w: Week, newPeriods: Set<number>, isWerkCard = false): number => {
        const filled = (p: number): boolean => cell.has(cK(d, w, c, p)) || newPeriods.has(p);
        const allow5 = isWerkCard || werkClassDay.has(`${c}|${d}|${w}`);
        // Klassen-Sperrzeiten zählen wie Pausen: keine Hohlstunde, kein Lückenzwang.
        const isPause = (p: number): boolean => p === 7 || (allow5 && p === 5) || classBlockedCells.has(cK(d, w, c, p));
        let min = 0;
        let max = 0;
        for (let p = 1; p <= PERIODS; p++) {
          if (isPause(p) || !filled(p)) continue;
          if (!min) min = p;
          max = p;
        }
        if (!min) return 0;
        let holes = 0;
        for (let p = min; p <= max; p++) if (!isPause(p) && !filled(p)) holes++;
        return holes;
      };

      // Kontexte: (Spalte, Tag, Woche) – je passende Einzelwoche ein Kandidat.
      // Der Planer wählt u oder g selbst (über die Bewertung/Ausgleich).
      const contexts = (card: Card): { c: number; d: number; w: Week }[] => {
        const need = card.klasse.trim().toLowerCase();
        const out: { c: number; d: number; w: Week }[] = [];
        if (!need) return out;
        for (let c = 0; c < this.classes.count; c++) {
          for (let d = 0; d < DAYS.length; d++) {
            for (const w of WEEKS) {
              if (this.classes.classNameAt(c, d, w).trim().toLowerCase() === need) out.push({ c, d, w });
            }
          }
        }
        return out;
      };

      const apply = (card: Card, c: number, d: number, w: Week, start: number, countTeacher = true, noPause = false): void => {
        occupy(card, card.klasse, c, d, w, start, countTeacher, noPause);
        if (card.labGroup === 'b') {
          groupB.push({ c, d, w, start, duration: card.duration, isWerk: card.isWerkstatt, klasse: card.klasse });
        }
        assigns.push({ card, c, d, w, start });
      };

      // „Einfache" Karte: eigene Lehrkraft + Raum, KEINE Kopplung/Team/Werkstatt/Labor/
      // Betrieb/Gruppe. Nur solche werden beim Reparatur-Schritt verschoben/ausgeworfen –
      // ihre Belegung lässt sich exakt und konfliktfrei rückgängig machen.
      const isSimple = (c: Card): boolean =>
        !!c.abbr.trim() &&
        !!c.room.trim() &&
        !c.coupling.trim() &&
        !c.teamTeaching.trim() &&
        !c.isWerkstatt &&
        !c.isLabor &&
        !c.labGroup.trim() &&
        // ¼-Karten nie einzeln umziehen – sie liegen als Paar (Reparatur würde
        // das Paar auseinanderreißen und eine Allein-¼ hinterlassen).
        !c.isVierwoechig &&
        !isBetrieb(c);

      /** Macht die Belegung einer EINFACHEN Karte rückgängig (exakte Umkehr von occupy)
       *  und entfernt ihre Zuordnung aus assigns. Nur für isSimple-Karten gültig. */
      const unapplySimple = (a: Assign): void => {
        const { card, c, d, w, start } = a;
        const ad = card.abbr.toLowerCase();
        for (const p of blockedPeriods(false, start, card.duration)) {
          const key = cK(d, w, c, p);
          const e = cellOcc.get(key);
          if (e) {
            e.total--;
            if (e.total <= 0) cellOcc.delete(key);
          }
          cell.delete(key);
          roomSet.delete(rK(d, w, p, card.room));
          teachSet.delete(tK(card.abbr, d, w, p));
          teachClass.delete(tcK(card.abbr, c, d, w, p));
          teachDayPeriods.get(thK(card.abbr, d, w))?.delete(p);
        }
        const hk = thK(card.abbr, d, w);
        const th = (teachH.get(hk) ?? 0) - card.duration;
        if (th > 0) teachH.set(hk, th);
        else teachH.delete(hk);
        const tw = teachWeek.get(ad);
        if (tw) tw[w === 'u' ? 0 : 1] -= card.duration;
        const f = card.fach.trim().toLowerCase();
        if (f) {
          const sk = sK(card.klasse, d, w, f);
          const sv = (subj.get(sk) ?? 0) - card.duration;
          if (sv > 0) subj.set(sk, sv);
          else subj.delete(sk);
        }
        mirrorSlots.get(mirrorKey({ abbr: card.abbr, klasse: card.klasse, fach: card.fach }))?.delete(`${d}|${start}|${w}`);
        // Anwesenheitstag nur freigeben, wenn die Lehrkraft an dem Tag nichts mehr hat.
        const busyThatDay =
          (teachDayPeriods.get(thK(card.abbr, d, 'u'))?.size ?? 0) > 0 ||
          (teachDayPeriods.get(thK(card.abbr, d, 'g'))?.size ?? 0) > 0;
        if (!busyThatDay) teachDaysUsed.get(ad)?.delete(d);
        // Aus assigns per WERT entfernen (Objekt kann nach Restore ein anderes sein).
        const i = assigns.findIndex((x) => x.card.id === card.id && x.c === c && x.d === d && x.w === w && x.start === start);
        if (i >= 0) assigns.splice(i, 1);
      };

      /** Reparatur-Schritt: offene EINFACHE Karten per Tausch-Kette (Ejection-Chain)
       *  einfügen – S verdrängt eine Karte, die wiederum eine verdrängen darf usw., bis
       *  jemand einen freien Platz findet. Löst randvolle Klassen, die sich einen Raum
       *  teilen (kein einzelner freier Platz, aber ein gültiger Ringtausch existiert). */
      const repair = (): void => {
        const stillOpen = (): Card[] => {
          const placed = new Set(assigns.map((a) => a.card.id));
          return cards.filter((c) => isSimple(c) && !placed.has(c.id));
        };
        if (!stillOpen().length) return;
        const MAX_DEPTH = 3; // höchstens 3 Verschiebungen je Kette
        let budget = 6000; // Obergrenze an Versuchen je Planungslauf (gegen Explosion)

        // Genau EINE einfache, noch nicht in der Kette benutzte Karte, die (c,d,w,start)
        // für s blockiert (Klassen-Zelle, Raum oder Lehrkraft)? Sonst null.
        const singleBlocker = (s: Card, c: number, d: number, w: Week, start: number, used: Set<string>): Assign | null => {
          const cellK = new Set<string>();
          const roomK = new Set<string>();
          const teachK = new Set<string>();
          for (const p of blockedPeriods(false, start, s.duration)) {
            cellK.add(cK(d, w, c, p));
            roomK.add(rK(d, w, p, s.room));
            teachK.add(tK(s.abbr, d, w, p));
          }
          let found: Assign | null = null;
          for (const a of assigns) {
            if (!isSimple(a.card) || used.has(a.card.id)) continue;
            let hit = false;
            for (const p of blockedPeriods(false, a.start, a.card.duration)) {
              if (cellK.has(cK(a.d, a.w, a.c, p)) || roomK.has(rK(a.d, a.w, p, a.card.room)) || teachK.has(tK(a.card.abbr, a.d, a.w, p))) {
                hit = true;
                break;
              }
            }
            if (hit) {
              if (found) return null; // mehr als ein Blocker → Kette hier nicht verfolgen
              found = a;
            }
          }
          return found;
        };

        // Versucht s zu platzieren: erst auf einen freien Platz, sonst per Verdrängung
        // einer EINZELNEN Blocker-Karte, die ihrerseits (rekursiv) untergebracht wird.
        const placeChain = (s: Card, depth: number, used: Set<string>): boolean => {
          for (const { c, d, w } of contexts(s)) {
            for (const start of baseStarts(s)) {
              if (check(s, c, d, w, start) === null) {
                apply(s, c, d, w, start);
                return true;
              }
              if (depth <= 0 || budget <= 0) continue;
              const b = singleBlocker(s, c, d, w, start, used);
              if (!b) continue;
              budget--;
              const bSlot = { card: b.card, c: b.c, d: b.d, w: b.w, start: b.start };
              unapplySimple(b);
              if (check(s, c, d, w, start) !== null) {
                apply(b.card, bSlot.c, bSlot.d, bSlot.w, bSlot.start); // s passt nicht → zurück
                continue;
              }
              apply(s, c, d, w, start);
              used.add(s.id);
              used.add(b.card.id);
              if (placeChain(b.card, depth - 1, used)) return true;
              used.delete(b.card.id);
              used.delete(s.id);
              unapplySimple({ card: s, c, d, w, start }); // Kette gescheitert → zurück
              apply(b.card, bSlot.c, bSlot.d, bSlot.w, bSlot.start);
            }
          }
          return false;
        };

        for (const s of stillOpen()) {
          if (budget <= 0) break;
          if (placeChain(s, MAX_DEPTH, new Set([s.id]))) {
            const lbl = `${s.abbr} (${s.klasse})`; // Skip-Eintrag entfernen
            const si = skipped.findIndex((x) => x.card === lbl);
            if (si >= 0) skipped.splice(si, 1);
          }
        }
      };

      /** Spalte, deren Klassenname an (Tag, Woche) zur Karte passt (für Kopplung). */
      const columnFor = (card: Card, d: number, w: Week): number | null => {
        const need = card.klasse.trim().toLowerCase();
        if (!need) return null;
        for (let c = 0; c < this.classes.count; c++) {
          if (this.classes.classNameAt(c, d, w).trim().toLowerCase() === need) return c;
        }
        return null;
      };

      /**
       * Platziert eine Gruppe gemeinsam auf einen Slot: alle Mitglieder gleichzeitig
       * (gleicher Tag/Woche/Startstunde), jedes in seiner Klassenspalte.
       * – Kopplung: gleiche Lehrkraft, andere Klassen → Lehrerstunden zählen nur 1×.
       * – Team: mehrere Lehrkräfte, gleiche Klasse → jede Karte zählt normal.
       */
      const placeGroup = (members: Card[], kind: 'coupling' | 'team' | 'lab' | 'vier'): void => {
        const id = kind === 'coupling' ? members[0].coupling : kind === 'team' ? members[0].teamTeaching : members[0].klasse;
        const tag = kind === 'coupling' ? '⛓' : kind === 'team' ? '👥' : kind === 'vier' ? '¼' : '⚗';
        const what = kind === 'coupling' ? 'Kopplung' : kind === 'team' ? 'Teamteaching' : kind === 'vier' ? '4-wöchig-Paar' : 'Labor a/b';
        const label = `${tag} ${id} (${members.map((m) => m.abbr).join(',')})`;
        if (members.some((m) => !m.klasse.trim())) {
          skipped.push({ card: label, reason: `${what}: Klasse fehlt` });
          return;
        }
        // Kandidaten-Slots: (Tag, Woche), an denen ALLE Mitglieder eine passende
        // Spalte haben – je Einzelwoche ein Kandidat (Planer wählt u/g selbst).
        const slots: { d: number; w: Week; cols: number[] }[] = [];
        for (let d = 0; d < DAYS.length; d++) {
          for (const w of WEEKS) {
            if (!members.every((m) => columnFor(m, d, w) !== null)) continue;
            slots.push({ d, w, cols: members.map((m) => columnFor(m, d, w) as number) });
          }
        }
        if (!slots.length) {
          skipped.push({ card: label, reason: `${what}: keine gemeinsame Spalte` });
          return;
        }
        if (shuffleOrder) shuffle(slots, rng);
        const starts = shuffleOrder ? shuffle([...baseStarts(members[0])], rng) : baseStarts(members[0]);
        // Lehrerstunden zählen je Lehrkraft einmal: Team zählt alle (verschiedene
        // Lehrkräfte); Kopplung dedupliziert gleiche Lehrkraft (2 Klassen = 1 Stunde),
        // verschiedene Lehrkräfte in einer Kopplung zählen aber jede.
        const seenAbbr = new Set<string>();
        const counts = members.map((m) => {
          const a = m.abbr.toLowerCase();
          if (seenAbbr.has(a)) return false;
          seenAbbr.add(a);
          return true;
        });
        const countTeacher = (i: number): boolean => counts[i];
        const mainGroup = members.some((m) => isMain(m));
        const lexLt = (a: number[], b: number[]): boolean => {
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
          return false;
        };
        // Besten Slot wählen: Klassen-Hohlstunden → Hauptfach 1–6 → Hauptfach-
        // Tag-Pause → frühe Stunde.
        let best: { d: number; w: Week; cols: number[]; start: number; score: number[] } | null = null;
        for (const { d, w, cols } of slots) {
          for (const start of starts) {
            if (!members.every((m, i) => check(m, cols[i], d, w, start) === null)) continue;
            // Hauptfach möglichst mit einem Tag Pause: pro Mitglied seine Klasse+Fach
            // auf den Nachbartagen prüfen (Mo Mathe → Di kein Mathe → Mi Mathe).
            const mainAdj = members.some((m) => {
              if (!isMain(m)) return false;
              const f = m.fach.trim().toLowerCase();
              return (subj.get(sK(m.klasse, d - 1, w, f)) ?? 0) > 0 || (subj.get(sK(m.klasse, d + 1, w, f)) ?? 0) > 0;
            })
              ? 1
              : 0;
            // Klassen ohne Hohlstunden (HARTE Schüler-Regel, immer aktiv): über alle Mitglieder.
            let classGapPush = 0;
            members.forEach((m, i) => {
              classGapPush += classGaps(cols[i], d, w, new Set(blockedPeriods(m.isWerkstatt, start, m.duration)), m.isWerkstatt);
            });
            // u/g-Parallelität: liegt (irgend)ein Mitglied in der anderen Woche schon
            // am selben Slot → 0 (parallel bevorzugt), sonst 1.
            const mirrorPush = members.some((m) => hasMirror(m, d, w, start)) ? 0 : 1;
            // Werkstatt bevorzugt nachmittags (Start ≥ 6) → Morgen frei für Theorie.
            const werkAfternoon = members[0].isWerkstatt && start < 6 ? 1 : 0;
            // Spanisch (gekoppelt): Tag-Pause + Randstunden-Alternation über alle Mitglieder.
            const span = members.reduce(
              (acc, m) => {
                if (!isSpan(m)) return acc;
                const s = spanScore(m.klasse, d, w, start);
                return { adj: Math.max(acc.adj, s.adj), same: Math.max(acc.same, s.same) };
              },
              { adj: 0, same: 0 },
            );
            const roomChangePush = members.reduce((acc, m, i) => acc + roomChange(m, cols[i], d, w), 0);
            const score = [
              classGapPush, // Klassen-Hohlstunden vermeiden (0, wenn Regel aus)
              werkAfternoon, // Werkstatt möglichst 6.–9. (0 = Nachmittag)
              span.adj, // Spanisch: mind. ein Tag Pause
              span.same, // Spanisch: 1.+2. und 8.+9. abwechseln
              mainGroup && start > 6 ? 1 : 0,
              mirrorPush, // u/g-PARALLEL: möglichst gleicher Slot in u und g
              mainAdj, // Hauptfach: möglichst ein Tag Pause (Nachbartag nur als Ausweg)
              roomChangePush, // Raumtreue: möglichst im selben Raum bleiben
              start,
            ];
            if (!best || lexLt(score, best.score)) best = { d, w, cols, start, score };
          }
        }
        if (best) {
          const chosen = best;
          members.forEach((m, i) => apply(m, chosen.cols[i], chosen.d, chosen.w, chosen.start, countTeacher(i)));
          return;
        }
        skipped.push({ card: label, reason: `${what}: kein gemeinsamer freier Slot` });
      };

      const placeNormal = (card: Card, startsOverride?: number[]): void => {
        if (!card.klasse.trim()) {
          skipped.push({ card: card.abbr, reason: 'keine Klasse' });
          return;
        }
        const ctx = contexts(card);
        if (!ctx.length) {
          skipped.push({ card: `${card.abbr} (${card.klasse})`, reason: 'keine passende Spalte' });
          return;
        }
        const f = card.fach.trim().toLowerCase();
        const main = isMain(card);
        if (shuffleOrder) shuffle(ctx, rng);
        const baseList = startsOverride ?? baseStarts(card);
        const starts = shuffleOrder ? shuffle([...baseList], rng) : baseList;

        // Alle gültigen Plätze (Spalte, Tag, Woche, Start) bewerten (kleiner = besser):
        // u/g-Ausgleich → Klassen-Hohlstunden → Hauptfach 1–6 → Hauptfach-Tag-Pause →
        // Teilzeit-Bündelung → Fächer-Variation → leichtere Woche → frühe Stunde.
        const better = (a: number[], b: number[]): boolean => {
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
          return false;
        };
        let best: { c: number; d: number; w: Week; start: number; score: number[] } | null = null;
        // Gründe über ALLE geprüften Slots zählen (nicht nur den letzten), damit die
        // Skip-Meldung erklärt, woran es wirklich lag (z. B. „Lehrer >6 Std/Tag").
        const reasonCounts = new Map<string, number>();
        for (const { c, d, w } of ctx) {
          for (const start of starts) {
            const r = check(card, c, d, w, start);
            if (r !== null) {
              reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
              continue;
            }
            // Hauptfach möglichst mit einem Tag Pause: Nachbartage mit gleichem Fach meiden.
            const mainAdj =
              main && ((subj.get(sK(card.klasse, d - 1, w, f)) ?? 0) > 0 || (subj.get(sK(card.klasse, d + 1, w, f)) ?? 0) > 0)
                ? 1
                : 0;
            // u/g-Differenz: bevorzugt die Woche, die die Lehrkraft-Bilanz im Limit hält.
            const imbalancePush = Math.max(
              0,
              Math.abs(teacherWeekLoad(card.abbr, w) + card.duration - teacherWeekLoad(card.abbr, w === 'u' ? 'g' : 'u')) - IMBAL,
            );
            // Klassen ohne Hohlstunden (HARTE Schüler-Regel, immer aktiv): Lücken vermeiden.
            const classGapPush = classGaps(c, d, w, new Set(blockedPeriods(card.isWerkstatt, start, card.duration)), card.isWerkstatt);
            // Teilzeit-Bündelung (nur limitierte Lehrkräfte): bereits genutzte Tage bevorzugen.
            const bundlePush =
              maxDaysOf(card.abbr) > 0 && !(teachDaysUsed.get(card.abbr.toLowerCase())?.has(d) ?? false) ? 1 : 0;
            // u/g-Parallelität: gleiche Lehrkraft+Klasse+Fach in der anderen Woche am
            // selben Slot → 0 (parallel, bevorzugt); sonst 1. Bildet aus mehreren
            // Karten Paare (gleicher Slot in u und g); ungerade Stunde bleibt einzeln.
            const mirrorPush = hasMirror(card, d, w, start) ? 0 : 1;
            // Spanisch: Tag-Pause + Randstunden 1↔8 alternieren (sonst 0).
            const span = isSpan(card) ? spanScore(card.klasse, d, w, start) : { adj: 0, same: 0 };
            // OLZ zeitgleich (ohne Kopplung): denselben Randstunden-Slot wie andere OLZ
            // bevorzugen → 0, sonst 1. So liegt OLZ in allen AV-Klassen gleichzeitig.
            const olzPush = isOlz(card) && olzSlots.size > 0 && !olzSlots.has(`${d}|${start}|${w}`) ? 1 : 0;
            const score = [
              imbalancePush, // u/g-Differenz ≤ Limit hat Vorrang
              classGapPush, // Klassen-Hohlstunden vermeiden (0, wenn Regel aus)
              olzPush, // OLZ in allen AV-Klassen zeitgleich (gleicher Randstunden-Slot)
              span.adj, // Spanisch: mind. ein Tag Pause zwischen den Stunden
              span.same, // Spanisch: 1.+2. und 8.+9. abwechseln (nicht beide gleich)
              main && start > 6 ? 1 : 0, // Hauptfach möglichst in den Stunden 1–6
              mirrorPush, // u/g-PARALLEL: möglichst gleicher Slot in u und g
              mainAdj, // Hauptfach: möglichst ein Tag Pause (Nachbartag nur als Ausweg)
              roomChange(card, c, d, w), // Raumtreue: möglichst im selben Raum bleiben
              bundlePush, // Teilzeit: Tage bündeln (0, wenn unbegrenzt)
              subj.get(sK(card.klasse, d, w, f)) ?? 0, // Fächer-Variation am Tag
              teacherWeekLoad(card.abbr, w), // u/g-Ausgleich: leichtere Woche bevorzugen
              start, // frühe Stunde
            ];
            if (!best || better(score, best.score)) best = { c, d, w, start, score };
          }
        }
        if (best) {
          apply(card, best.c, best.d, best.w, best.start);
          return;
        }
        // Die häufigsten Hindernisse zusammenfassen (max. 2), sonst Standardtext.
        const reason =
          reasonCounts.size === 0
            ? 'kein freier Platz'
            : [...reasonCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([r, n]) => `${r} (${n}×)`)
                .join(', ');
        skipped.push({ card: `${card.abbr} (${card.klasse})`, reason });
      };

      // Gekoppelte und Team-Karten gesondert (als Gruppen); alles andere einzeln.
      const all = [...this.pool.all];
      const cards = all.filter((c) => !c.coupling.trim() && !c.teamTeaching.trim());
      const couplingMap = new Map<string, Card[]>();
      for (const c of all.filter((c) => c.coupling.trim())) {
        const k = c.coupling.trim();
        (couplingMap.get(k) ?? couplingMap.set(k, []).get(k)!).push(c);
      }
      const teamMap = new Map<string, Card[]>();
      for (const c of all.filter((c) => !c.coupling.trim() && c.teamTeaching.trim())) {
        const k = c.teamTeaching.trim();
        (teamMap.get(k) ?? teamMap.set(k, []).get(k)!).push(c);
      }

      const isA = (c: Card) => c.labGroup === 'a';
      const isB = (c: Card) => c.labGroup === 'b';
      // Die Auto-Paarung (pairAB) kann nur a↔b; c/d-Parallelität wird über Kopplungen
      // gesteuert (placeGroup stapelt sie), sonst werden c/d einzeln verplant.
      const isAB = (c: Card) => isA(c) || isB(c);
      // Karten/Gruppen, die zuletzt offen blieben, ZUERST (stabile Teil-Sortierung).
      const focusFirstCards = (list: Card[]): Card[] =>
        focus.size ? [...list].sort((a, b) => (focus.has(a.id) ? 0 : 1) - (focus.has(b.id) ? 0 : 1)) : list;
      const focusFirstGroups = (groups: Card[][]): Card[][] =>
        focus.size
          ? [...groups].sort((a, b) => (a.some((m) => focus.has(m.id)) ? 0 : 1) - (b.some((m) => focus.has(m.id)) ? 0 : 1))
          : groups;
      const step = (list: Card[], fn: (c: Card) => void): void => {
        // Heuristik (1. Durchlauf): längere/schwerer platzierbare Blöcke zuerst.
        const seq = shuffleOrder ? shuffle([...list], rng) : [...list].sort((a, b) => b.duration - a.duration);
        for (const card of focusFirstCards(seq)) fn(card);
      };
      // Labor/Werkstatt a/b VORAB zu Paaren bündeln: je eine a- mit einer b-Karte
      // (gleiche Klasse+Dauer, ANDERE Lehrkraft, anderer/leerer Raum). Statt greedy
      // wird je Gruppe das MAXIMALE Matching gesucht (Augmenting-Path/Kuhn) – so
      // gehen so viele Paare wie möglich auf (z. B. Ke-a↔Ht-b UND Rd-a↔Ke-b, statt
      // Ht-b↔Rd-a und zwei übrige Ke). Jedes Paar wird gemeinsam auf einen freien
      // Slot gelegt; Überzählige (ohne Partner) werden einzeln verplant.
      const canPair = (ac: Card, bc: Card): boolean => {
        if (ac.abbr.trim().toLowerCase() === bc.abbr.trim().toLowerCase()) return false; // gleiche Lehrkraft
        const ar = ac.room.trim().toLowerCase();
        const br = bc.room.trim().toLowerCase();
        return !ar || !br || ar !== br; // gleicher (gesetzter) Raum → nicht stapeln
      };
      const pairAB = (list: Card[]): { pairs: Card[][]; rest: Card[] } => {
        const groups = new Map<string, { a: Card[]; b: Card[] }>();
        for (const c of list) {
          const k = `${c.klasse.trim().toLowerCase()}|${c.duration}|${c.isWerkstatt ? 'w' : 'l'}`;
          const g = groups.get(k) ?? { a: [], b: [] };
          (isA(c) ? g.a : g.b).push(c);
          groups.set(k, g);
        }
        const pairs: Card[][] = [];
        const rest: Card[] = [];
        for (const { a, b } of groups.values()) {
          // Maximales bipartites Matching: matchB[j] = Index der a-Karte, die b[j] belegt.
          const matchB = new Array<number>(b.length).fill(-1);
          const augment = (ai: number, seen: boolean[]): boolean => {
            for (let bj = 0; bj < b.length; bj++) {
              if (seen[bj] || !canPair(a[ai], b[bj])) continue;
              seen[bj] = true;
              if (matchB[bj] === -1 || augment(matchB[bj], seen)) {
                matchB[bj] = ai;
                return true;
              }
            }
            return false;
          };
          for (let ai = 0; ai < a.length; ai++) augment(ai, new Array<boolean>(b.length).fill(false));
          const usedA = new Set<number>();
          for (let bj = 0; bj < b.length; bj++) {
            if (matchB[bj] === -1) {
              rest.push(b[bj]);
            } else {
              pairs.push([b[bj], a[matchB[bj]]]);
              usedA.add(matchB[bj]);
            }
          }
          a.forEach((ac, ai) => {
            if (!usedA.has(ai)) rest.push(ac);
          });
        }
        return { pairs, rest };
      };
      const stepPairs = (ps: Card[][]): void => {
        const seq = shuffleOrder ? shuffle([...ps], rng) : ps;
        for (const pair of seq) placeGroup(pair, 'lab');
      };
      // Nur LABORE werden hier gepaart. Werkstätten laufen IMMER über die 4h-Block-
      // Logik (placeWerkSet) – auch gepaarte a/b (verschiedene Lehrkräfte), sonst
      // entstünden 2h-Stapel.
      const { pairs: abPairs, rest: abRest } = pairAB(cards.filter((c) => c.isLabor && !c.isWerkstatt && isAB(c)));

      // Werkstatt ist IMMER mind. 4 Stunden (HARTE Regel, nie nur 2h). Findet ein Block
      // keinen Platz, bleiben die Karten OFFEN („Warum nicht verplant?") statt sie als
      // 2h-Häppchen zu verteilen.
      const skipWerk = (members: Card[], reason: string): void => {
        for (const m of members) skipped.push({ card: `${m.abbr} (${m.klasse})`, reason });
      };
      const lexLtA = (a: number[], b: number[]): boolean => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
        return false;
      };
      // Werkstatt-2h-Karten-Startstunden (5. Stunde = feste Pause): Paare (1-2),(3-4),(6-7),(8-9).
      const WERK_SLOTS = [1, 3, 6, 8];
      // Fenster für k aufeinanderfolgende 2h-Karten; nachmittags-lastig zuerst.
      const werkWindows = (k: number): number[][] => {
        const out: number[][] = [];
        for (let i = 0; i + k <= WERK_SLOTS.length; i++) out.push(WERK_SLOTS.slice(i, i + k));
        return out.sort((a, b) => b[0] - a[0]);
      };
      // Karten zu Blöcken à 4h (2 Karten) bündeln; bei ungerader Anzahl EIN 6h-Block
      // (3 Karten) → so entsteht NIE ein einzelner 2-Stunden-Block.
      const chunkWerk = (ms: Card[]): Card[][] => {
        if (ms.length <= 2) return ms.length ? [ms] : [];
        const chunks: Card[][] = [];
        let rest = ms;
        if (rest.length % 2 === 1) {
          chunks.push(rest.slice(0, 3));
          rest = rest.slice(3);
        }
        for (let i = 0; i < rest.length; i += 2) chunks.push(rest.slice(i, i + 2));
        return chunks;
      };
      // Platziert einen Block konsekutiver Werkstatt-Slots. DAUER-BEWUSST: eine 4h-Karte
      // belegt ZWEI konsekutive Slots (z. B. Start 3 → Paare 3-4 und 6-7), eine 2h-Karte
      // einen. force = exakt dieser Slot (für die u/g-Spiegelung).
      const slotsOf = (m: Card): number => Math.max(1, Math.ceil(m.duration / 2));
      const placeWerkChunk = (
        members: Card[],
        force?: { d: number; w: Week; starts: number[] },
      ): { d: number; w: Week; starts: number[] } | null => {
        const lead = members[0];
        const total = members.reduce((s, m) => s + m.duration, 0);
        // HARTE Regel: Werkstatt nie unter 4 Std – ein Block ohne Partner bleibt offen.
        if (total < 4) {
          skipWerk(members, 'Werkstatt unter 4 Std – kein Blockpartner (Daten prüfen)');
          return null;
        }
        const slotsNeeded = members.reduce((s, m) => s + slotsOf(m), 0);
        // Startstunde je Karte aus dem Slot-Fenster (mehrslottige Karten rücken den Index weiter).
        const startsFor = (win: number[]): number[] => {
          const starts: number[] = [];
          let j = 0;
          for (const m of members) {
            starts.push(win[j]);
            j += slotsOf(m);
          }
          return starts;
        };
        const fitsAt = (c: number, d: number, w: Week, starts: number[]): boolean => {
          for (let i = 0; i < members.length; i++) if (check(members[i], c, d, w, starts[i]) !== null) return false;
          return (teachH.get(thK(lead.abbr, d, w)) ?? 0) + total <= 8; // Werkstatt-Tag: bis 8 Std
        };
        const applyAt = (c: number, d: number, w: Week, starts: number[]): void =>
          members.forEach((m, i) => apply(m, c, d, w, starts[i]));
        if (force && force.starts.length === members.length) {
          const c = columnFor(lead, force.d, force.w);
          if (c !== null && fitsAt(c, force.d, force.w, force.starts)) {
            applyAt(c, force.d, force.w, force.starts);
            return force;
          }
        }
        let best: { c: number; d: number; w: Week; starts: number[]; score: number[] } | null = null;
        for (const { c, d, w } of contexts(lead)) {
          for (const win of werkWindows(slotsNeeded)) {
            const starts = startsFor(win);
            if (!fitsAt(c, d, w, starts)) continue;
            const afternoon = win[0] >= 6 ? 0 : win[0] >= 3 ? 1 : 2; // Nachmittag bevorzugt
            const score = [afternoon, teacherWeekLoad(lead.abbr, w), d, win[0]];
            if (!best || lexLtA(score, best.score)) best = { c, d, w, starts, score };
          }
        }
        if (!best) {
          skipWerk(members, 'Werkstatt: kein zusammenhängender ≥4h-Block frei');
          return null;
        }
        applyAt(best.c, best.d, best.w, best.starts);
        return { d: best.d, w: best.w, starts: best.starts };
      };
      // Eine KLASSE, je Basis-Fach (A_WP/B_WP = WP): die Gruppen a/b/c/d als 4h-Blöcke.
      // Erste vorhandene Gruppe ankert (Nachmittag); jede WEITERE Gruppe wird auf DENSELBEN
      // Slot gelegt:
      //  • andere Lehrkraft → selbe Woche, GESTAPELT (Gruppen parallel, bis zu 4),
      //  • gleiche Lehrkraft → andere Woche, GESPIEGELT (kann nicht gleichzeitig; freie
      //    Gruppe geht heim) – u und g sehen gleich aus.
      const baseFach = (f: string): string => f.trim().toLowerCase().replace(/^[abcd][_-]/, '');
      const placeWerkSet = (setCards: Card[]): void => {
        const byBase = new Map<string, Card[]>();
        for (const c of setCards) (byBase.get(baseFach(c.fach)) ?? byBase.set(baseFach(c.fach), []).get(baseFach(c.fach))!).push(c);
        for (const fc of byBase.values()) {
          // Blöcke je Gruppe (a,b,c,d); ungruppierte als eigene „Gruppe".
          const chunksByGroup = [...GROUPS, ''].map((g) =>
            chunkWerk(fc.filter((c) => (g ? c.labGroup === g : !GROUPS.includes(c.labGroup)))),
          );
          const maxBlocks = Math.max(0, ...chunksByGroup.map((cs) => cs.length));
          for (let i = 0; i < maxBlocks; i++) {
            let anchor: { d: number; w: Week; starts: number[] } | null = null;
            const teachersAtSlot = new Set<string>(); // Lehrkräfte in der Anker-Woche
            for (const chunks of chunksByGroup) {
              const ch = chunks[i];
              if (!ch) continue;
              const ab = ch[0].abbr.trim().toLowerCase();
              if (!anchor) {
                anchor = placeWerkChunk(ch);
                if (anchor) teachersAtSlot.add(ab);
                continue;
              }
              const sameTeacher = teachersAtSlot.has(ab);
              const w: Week = sameTeacher ? (anchor.w === 'u' ? 'g' : 'u') : anchor.w;
              const slot = placeWerkChunk(ch, { d: anchor.d, w, starts: anchor.starts });
              if (slot && !sameTeacher) teachersAtSlot.add(ab);
            }
          }
        }
      };
      // GEKOPPELTE Werkstatt: mehrere Kopplungen derselben Klasse(n)+Fach bilden EINEN
      // 4h-Block – konsekutive Nachmittags-Slots in DERSELBEN Woche (statt u/g-gespiegelt,
      // was nur 2h je Woche ergäbe). Jede Kopplung belegt einen Slot (Gruppen gestapelt).
      const placeWerkCouplingSet = (coups: Card[][]): void => {
        // Mehr Kopplungen als Tages-Slots (>4): in ≥4h-Blöcke teilen (2er = 4h, bei
        // ungerader Zahl ein 3er = 6h) – NIE ein einzelner 2h-Block. Jeder Block
        // findet unabhängig seinen Tag/Slot (rekursiv).
        if (coups.length > WERK_SLOTS.length) {
          let rest = coups;
          if (rest.length % 2 === 1) {
            placeWerkCouplingSet(rest.slice(0, 3));
            rest = rest.slice(3);
          }
          for (let i = 0; i < rest.length; i += 2) placeWerkCouplingSet(rest.slice(i, i + 2));
          return;
        }
        // HARTE Regel: unter 4 Std je Klasse (z. B. EINE einzelne 2h-Kopplung) → offen lassen.
        const hoursPerClass = coups.reduce((s, coup) => s + Math.max(...coup.map((m) => m.duration)), 0);
        if (hoursPerClass < 4) {
          for (const coup of coups) skipWerk(coup, 'Werkstatt-Kopplung unter 4 Std – kein Blockpartner (Daten prüfen)');
          return;
        }
        const n = coups.length;
        const blockLoadOk = (d: number, w: Week): boolean => {
          // Je Kopplung zählt jede Lehrkraft nur EINMAL (parallel in mehreren Klassen
          // = eine Unterrichtsstunde). Werkstatt-Tag: bis 8 Std erlaubt.
          const add = new Map<string, number>();
          for (const coup of coups) {
            const seen = new Set<string>();
            for (const m of coup) {
              const a = m.abbr.trim().toLowerCase();
              if (!a || seen.has(a)) continue;
              seen.add(a);
              add.set(a, (add.get(a) ?? 0) + m.duration);
            }
          }
          for (const [a, dur] of add) if ((teachH.get(thK(a, d, w)) ?? 0) + dur > 8) return false;
          return true;
        };
        for (const win of werkWindows(Math.min(n, WERK_SLOTS.length))) {
          if (win.length < n) continue; // nicht genug konsekutive Slots (>4 Kopplungen)
          for (let d = 0; d < DAYS.length; d++) {
            for (const w of WEEKS) {
              let ok = true;
              for (let i = 0; i < coups.length && ok; i++)
                for (const m of coups[i]) {
                  const c = columnFor(m, d, w);
                  if (c === null || check(m, c, d, w, win[i]) !== null) {
                    ok = false;
                    break;
                  }
                }
              if (ok && blockLoadOk(d, w)) {
                for (let i = 0; i < coups.length; i++) {
                  const seen = new Set<string>();
                  for (const m of coups[i]) {
                    const a = m.abbr.trim().toLowerCase();
                    const countT = !a || !seen.has(a);
                    if (a) seen.add(a);
                    apply(m, columnFor(m, d, w) as number, d, w, win[i], countT);
                  }
                }
                return;
              }
            }
          }
        }
        // HARTE Regel ≥4h: kein zusammenhängendes Fenster gefunden → OFFEN lassen
        // (erscheint unter „Warum nicht verplant?"), NICHT als 2h-Häppchen verteilen.
        for (const coup of coups) skipWerk(coup, 'Werkstatt-Kopplung: kein zusammenhängender ≥4h-Block frei');
      };

      // Reihenfolge: Werkstatt-Blöcke (Anker, immer ≥4h) → HAUPTFÄCHER (sichern den
      // Morgen) → Labor-Paare/-Reste → Kopplungen → Teamteaching → restliche Fächer.
      // ALLE (nicht gekoppelten) Werkstätten je KLASSE sammeln (Gruppe a/b können von
      // verschiedenen Lehrkräften kommen → in placeWerkSet gestapelt bzw. gespiegelt).
      const werkSets = new Map<string, Card[]>();
      for (const c of cards.filter((c) => c.isWerkstatt)) {
        const sk = c.klasse.trim().toLowerCase();
        (werkSets.get(sk) ?? werkSets.set(sk, []).get(sk)!).push(c);
      }
      const werkSetList = [...werkSets.values()];
      if (shuffleOrder) shuffle(werkSetList, rng);

      // Kopplungen partitionieren – Priorität: SCHIENEN / große Kopplungen über ≥3 KLASSEN
      // ZUERST (am stärksten eingeschränkt: brauchen einen Slot, an dem ALLE beteiligten
      // Klassen GLEICHZEITIG frei sind) → Werkstatt-Kopplungen → Spanisch/Seminar → Rest.
      const allCoup = [...couplingMap.values()];
      const isWerkCoup = (ms: Card[]) => ms.some((m) => m.isWerkstatt);
      const classCount = (ms: Card[]) => new Set(ms.map((m) => m.klasse.trim().toLowerCase())).size;
      const isSchieneCoup = (ms: Card[]) => ms.some((m) => m.schiene) || classCount(ms) >= 3;
      const isEarlyCoup = (ms: Card[]) => ms.some((m) => isSpan(m) || isSk(m) || isOlz(m));
      // Klassen mit fester Werkstatt-Lage an EINEM zusammenhängenden Tag (u/g gespiegelt):
      // AV1/AV2 → Fenster 3.–6. ([3,6]); alle anderen → voller Tag 1.–4.+6.–9. ([1,3,6,8]).
      // Deren Werkstatt-Räume sind klassenübergreifend geteilt → ZUERST platzieren.
      const WERK_SCHIENE = new Set(['2bfe2', '2bfm2', 'av1', 'av2', 'av3', 'av4']);
      const isWerkSchieneCoup = (ms: Card[]) => isWerkCoup(ms) && ms.every((m) => WERK_SCHIENE.has(m.klasse.trim().toLowerCase()));
      const schieneCoup = allCoup.filter((ms) => isSchieneCoup(ms));
      const werkSchieneCoup = allCoup.filter((ms) => !isSchieneCoup(ms) && isWerkSchieneCoup(ms));
      const werkCoup = allCoup.filter((ms) => !isSchieneCoup(ms) && isWerkCoup(ms) && !isWerkSchieneCoup(ms));
      const earlyCoup = allCoup.filter((ms) => !isSchieneCoup(ms) && !isWerkCoup(ms) && isEarlyCoup(ms));
      const restCoup = allCoup.filter((ms) => !isSchieneCoup(ms) && !isWerkCoup(ms) && !isEarlyCoup(ms));
      const placeWerkSchiene = (coups: Card[][]): boolean => {
        const classes = [...new Set(coups.flatMap((ms) => ms.map((m) => m.klasse.trim().toLowerCase())))];
        // AV1/AV2: 4h durchgehend 3.–6. (Starts 3+5 = 3,4,5,6) – Pause in 5. wird übergangen.
        // Sonst voller Tag 1.–4.+6.–9. (Starts 1,3,6,8 – mit Pause in der 5.).
        const av12 = classes.some((c) => c === 'av1' || c === 'av2');
        const window = av12 ? [3, 5] : [1, 3, 6, 8];
        const noPause = av12;
        const perWeek = window.length;
        if (coups.length > 2 * perWeek) return false; // passt nicht an EINEN Tag (u + g)
        const days = [...Array(DAYS.length).keys()];
        if (shuffleOrder) shuffle(days, rng);
        for (const d of days) {
          const plan: { coup: Card[]; w: Week; start: number }[] = [];
          let ui = 0;
          let gi = 0;
          let ok = true;
          for (const coup of coups) {
            const w: Week = ui < perWeek ? 'u' : 'g';
            const start = window[w === 'u' ? ui++ : gi++];
            for (const m of coup) {
              const c = columnFor(m, d, w);
              if (c === null || check(m, c, d, w, start, false, noPause) !== null) {
                ok = false;
                break;
              }
            }
            if (!ok) break;
            plan.push({ coup, w, start });
          }
          if (ok && plan.length === coups.length) {
            for (const { coup, w, start } of plan) {
              const seen = new Set<string>();
              for (const m of coup) {
                const a = m.abbr.trim().toLowerCase();
                const countT = !a || !seen.has(a);
                if (a) seen.add(a);
                apply(m, columnFor(m, d, w) as number, d, w, start, countT, noPause);
              }
            }
            return true;
          }
        }
        return false;
      };
      // Gruppiert die Schienen-Werkstätten je Klassen+Fach und legt jede als zusammenhängenden
      // Tag (placeWerkSchiene); klappt es nicht, normaler Werkstatt-Kopplungs-Block als Ausweg.
      const placeWerkSchieneGroups = (coups: Card[][]): void => {
        const grp = new Map<string, Card[][]>();
        for (const ms of coups) {
          const classes = [...new Set(ms.map((m) => m.klasse.trim().toLowerCase()))].sort().join(',');
          const bf = [...new Set(ms.map((m) => baseFach(m.fach)))].sort().join(',');
          const k = `${classes}|${bf}`;
          (grp.get(k) ?? grp.set(k, []).get(k)!).push(ms);
        }
        for (const g of grp.values()) if (!placeWerkSchiene(g)) placeWerkCouplingSet(g);
      };

      // Platziert eine Liste Kopplungen: Werkstatt-Kopplungen je Klasse+Fach als 4h-Block,
      // alles andere über placeGroup (gemeinsamer Slot, wo ALLE Klassen Spalten haben).
      const placeCoupList = (coups: Card[][]): void => {
        // Werkstatt-Kopplungen gruppieren: gleiches Basis-Fach + ÜBERLAPPENDE Klassen
        // gehören zusammen (z. B. K819 {1BFR2,R1PW} + K820 {1BFR2} → EIN 4h/6h-Block),
        // sonst bliebe eine einzelne Kopplung als 2h-Block übrig.
        const grp = new Map<string, { classes: Set<string>; list: Card[][] }[]>();
        for (const ms of coups.filter(isWerkCoup)) {
          const classes = new Set(ms.map((m) => m.klasse.trim().toLowerCase()));
          const bf = [...new Set(ms.map((m) => baseFach(m.fach)))].sort().join(',');
          const buckets = grp.get(bf) ?? grp.set(bf, []).get(bf)!;
          const hit = buckets.find((b) => [...classes].some((c) => b.classes.has(c)));
          if (hit) {
            hit.list.push(ms);
            for (const c of classes) hit.classes.add(c);
          } else buckets.push({ classes, list: [ms] });
        }
        for (const bucket of [...grp.values()].flat()) {
          const g = bucket.list;
          const special = g.every((ms) => ms.every((m) => WERK_SCHIENE.has(m.klasse.trim().toLowerCase())));
          if (!special || !placeWerkSchiene(g)) placeWerkCouplingSet(g);
        }
        const rest = coups.filter((ms) => !isWerkCoup(ms));
        if (shuffleOrder) shuffle(rest, rng);
        for (const ms of focusFirstGroups(rest)) placeGroup(ms, 'coupling');
      };

      // Betrieb-/Block-Karten (noCount, nicht Werkstatt/Labor) sind FESTE Belegungen
      // (Klasse im Betrieb / gesperrt) und oft starre 4h-Blöcke → als ANKER zuerst
      // verplanen, sonst ist später 1.–4. voll und sie fallen raus.
      // OLZ als SCHIENE über alle OLZ-Klassen: je Randstunden-Slot (1+2 ODER 8+9) wird in
      // JEDER Klasse eine OLZ-Karte gesetzt – mit VERSCHIEDENEN Lehrkräften (zeitgleich, ohne
      // Kopplung, Lehrer-Kombi bleibt frei). 1+2 und 8+9 dürfen am selben Tag liegen.
      const placeOlzSchiene = (): void => {
        const olz = cards.filter((c) => isOlz(c) && !c.isWerkstatt && !c.isLabor);
        if (!olz.length) return;
        const olzClasses = [...new Set(olz.map((c) => c.klasse.trim().toLowerCase()))];
        // Karten je Klasse+Lehrkraft (eine Lehrkraft hat i. d. R. 2 OLZ = u + g).
        const byCT = new Map<string, Map<string, Card[]>>();
        for (const c of olz) {
          const kl = c.klasse.trim().toLowerCase();
          const t = c.abbr.trim().toLowerCase();
          const m = byCT.get(kl) ?? byCT.set(kl, new Map()).get(kl)!;
          (m.get(t) ?? m.set(t, []).get(t)!).push(c);
        }
        const remaining = new Set(olz.map((c) => c.id));
        // K = max. Anzahl OLZ-Lehrkräfte je Klasse = Anzahl benötigter Schienen-Positionen.
        const K = Math.max(...olzClasses.map((kl) => byCT.get(kl)!.size));

        // GLOBALE Zuteilung (Latin-Square-artig): jede (Klasse,Lehrkraft) bekommt eine Position
        // 0..K-1, sodass je Klasse jede Position nur 1× und je Position jede Lehrkraft nur 1×
        // (an einer Position sitzen also K verschiedene Lehrkräfte – eine je Klasse → Schiene).
        const pairs: { kl: string; t: string }[] = [];
        for (const kl of olzClasses) for (const t of byCT.get(kl)!.keys()) pairs.push({ kl, t });
        if (shuffleOrder) shuffle(pairs, rng);
        const colTeacher = Array.from({ length: K }, () => new Set<string>()); // Position → benutzte Lehrkräfte
        const classCols = new Map<string, Set<number>>(); // Klasse → benutzte Positionen
        const posOf = new Map<string, number>(); // „klasse|kürzel" → Position
        const assign = (i: number): boolean => {
          if (i === pairs.length) return true;
          const { kl, t } = pairs[i];
          const used = classCols.get(kl) ?? classCols.set(kl, new Set()).get(kl)!;
          for (let p = 0; p < K; p++) {
            if (used.has(p) || colTeacher[p].has(t)) continue;
            used.add(p);
            colTeacher[p].add(t);
            posOf.set(`${kl}|${t}`, p);
            if (assign(i + 1)) return true;
            used.delete(p);
            colTeacher[p].delete(t);
            posOf.delete(`${kl}|${t}`);
          }
          return false;
        };

        // K Randstunden-Slots (Tag, Startstunde 1 oder 8) wählen, die in ALLEN Klassen in u UND g
        // frei sind – je Position einer. 1+2 und 8+9 dürfen am selben Tag liegen.
        const slotFree = (d: number, s: number): boolean =>
          olzClasses.every((kl) => {
            const card = olz.find((c) => c.klasse.trim().toLowerCase() === kl)!;
            return WEEKS.every((w) => {
              const col = columnFor(card, d, w);
              return col !== null && check(card, col, d, w, s) === null;
            });
          });
        const posSlots: { d: number; s: number }[] = [];
        const days = [...Array(DAYS.length).keys()];
        if (shuffleOrder) shuffle(days, rng);
        // OLZ-Schienen über die WOCHE VERTEILEN: 1. Durchgang höchstens EINE Schiene je Tag
        // (auf möglichst viele verschiedene Tage), 2. Durchgang füllt bei Bedarf den 2. Slot.
        for (const d of days)
          for (const s of [1, 8])
            if (posSlots.length < K && !posSlots.some((p) => p.d === d) && slotFree(d, s)) {
              posSlots.push({ d, s });
              break;
            }
        for (const d of days) for (const s of [1, 8]) if (posSlots.length < K && !posSlots.some((p) => p.d === d && p.s === s) && slotFree(d, s)) posSlots.push({ d, s });

        if (assign(0) && posSlots.length >= K) {
          // Platzieren: jede (Klasse,Lehrkraft) an ihre Position; deren 2 Karten in u und g.
          for (const kl of olzClasses)
            for (const [t, cs] of byCT.get(kl)!) {
              const { d, s } = posSlots[posOf.get(`${kl}|${t}`)!];
              for (const w of WEEKS) {
                const card = cs.find((c) => remaining.has(c.id));
                if (!card) break;
                const col = columnFor(card, d, w);
                if (col !== null && check(card, col, d, w, s) === null) {
                  apply(card, col, d, w, s);
                  remaining.delete(card.id);
                }
              }
            }
        }
        // Übrige OLZ (z. B. ungerade Anzahl, oder keine globale Lösung) normal in 1+2/8+9.
        for (const c of olz) if (remaining.has(c.id)) placeNormal(c);
      };

      const fixedBlocks = (c: Card) => c.noCount && !c.isWerkstatt && !c.isLabor && !c.coupling.trim() && !c.teamTeaching.trim();

      // 4-WÖCHIGE Karten (¼) VORAB zu Paaren bündeln: eine ¼-Karte darf nie
      // allein liegen (jede 4. Woche fiele der Unterricht aus). Gleiche
      // Klasse+Dauer, andere Lehrkraft, anderer/leerer Raum – jedes Paar wird
      // GEMEINSAM auf denselben Slot gelegt (gestapelt). Überzählige ohne
      // Partner laufen einzeln und werden im Prüfbericht gemeldet.
      const vierPaired = new Set<string>();
      const vierPairs: Card[][] = [];
      {
        const byKey = new Map<string, Card[]>();
        for (const c of cards) {
          if (!c.isVierwoechig || c.isWerkstatt || c.isLabor || fixedBlocks(c) || isOlz(c)) continue;
          const k = `${c.klasse.trim().toLowerCase()}|${c.duration}`;
          (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(c);
        }
        for (const list of byKey.values()) {
          for (let i = 0; i < list.length; i++) {
            if (vierPaired.has(list[i].id)) continue;
            for (let j = i + 1; j < list.length; j++) {
              if (vierPaired.has(list[j].id) || !canPair(list[i], list[j])) continue;
              vierPairs.push([list[i], list[j]]);
              vierPaired.add(list[i].id);
              vierPaired.add(list[j].id);
              break;
            }
          }
        }
      }

      step(cards.filter(fixedBlocks), placeNormal); // 1. BETRIEBSTAGE/Block-Karten zuerst (starrster Ganztags-Anker)
      placeWerkSchieneGroups(werkSchieneCoup); // 1b. Schienen-Werkstätten GANZ ZUERST (geteilte Räume, ganzer Tag, je Paar eigener Tag)
      placeCoupList(schieneCoup); // 2. große SCHIENEN über ≥3 Klassen (Anker)
      placeOlzSchiene(); // 2b. OLZ als Schiene über alle 4 AV-Klassen (Randstunden, weicht den Werkstatt-Tagen aus)
      for (const setCards of werkSetList) placeWerkSet(setCards); // 3. nicht gekoppelte Werkstatt-Blöcke
      placeCoupList(werkCoup); // 4. Werkstatt-Kopplungen (4h-Block)
      if (shuffleOrder) shuffle(earlyCoup, rng); // 5. Spanisch/Seminar (vor Hauptfächern)
      for (const members of focusFirstGroups(earlyCoup)) placeGroup(members, 'coupling');
      step(cards.filter((c) => !c.isWerkstatt && !c.isLabor && isMain(c) && !vierPaired.has(c.id)), placeNormal); // 6. Hauptfächer
      stepPairs(abPairs.filter((p) => !p[0].isWerkstatt)); // 7. Labor
      step([...abRest.filter((c) => !c.isWerkstatt), ...cards.filter((c) => !c.isWerkstatt && c.isLabor && !isAB(c))], placeNormal);
      placeCoupList(restCoup); // 8. restliche Kopplungen
      const teamGroupsList = [...teamMap.values()];
      if (shuffleOrder) shuffle(teamGroupsList, rng);
      for (const members of focusFirstGroups(teamGroupsList)) placeGroup(members, 'team');
      // 8b. ¼-Paare: beide 4-wöchigen Karten GEMEINSAM auf denselben Slot.
      if (shuffleOrder) shuffle(vierPairs, rng);
      for (const members of focusFirstGroups(vierPairs)) placeGroup(members, 'vier');
      // 9. Rest (ohne Betrieb-Anker und ohne die bereits früh gelegten OLZ).
      step(
        cards.filter((c) => !c.isWerkstatt && !c.isLabor && !isMain(c) && !fixedBlocks(c) && !isOlz(c) && !vierPaired.has(c.id)),
        placeNormal,
      );
      // 10. Reparatur: letzte offene Einzelkarten per Tausch-Kette lösen (nur aussichtsreiche Läufe).
      if (assigns.length >= bestPlaced) repair();

      // 11. HARTE Regel „Werkstatt ≥4 Std": finaler Sweep – egal über welchen Pfad eine
      // Werkstatt gelandet ist, Reste unter 4 Std je Klasse+Gruppe+Tag+Woche werden
      // wieder ENTFERNT und als offen gemeldet (nie 2h-Werkstatt-Häppchen im Plan).
      {
        const wk = new Map<string, Assign[]>();
        for (const a of assigns) {
          if (!a.card.isWerkstatt) continue;
          const k = `${a.card.klasse.trim().toLowerCase()}|${a.card.labGroup}|${a.d}|${a.w}`;
          (wk.get(k) ?? wk.set(k, []).get(k)!).push(a);
        }
        for (const arr of wk.values()) {
          if (arr.reduce((s, x) => s + x.card.duration, 0) >= 4) continue;
          for (const x of arr) {
            const i = assigns.indexOf(x);
            if (i >= 0) assigns.splice(i, 1);
            skipped.push({ card: `${x.card.abbr} (${x.card.klasse})`, reason: 'Werkstatt: kein zusammenhängender ≥4h-Block frei' });
          }
        }
      }

      // 12. HOHLSTUNDEN-REPARATUR (harte Schüler-Regel): Klassen-Lücken schließen, indem
      // eine RANDSTÄNDIGE Einzelkarte eines anderen Tags exakt in das Loch umzieht
      // (am Quelltag entsteht dabei keine neue Lücke, weil die Karte am Rand lag).
      {
        for (let round = 0; round < 3; round++) {
          let moved = false;
          for (let c = 0; c < this.classes.count; c++) {
            for (let d = 0; d < DAYS.length; d++) {
              for (const w of WEEKS) {
                const allow5 = werkClassDay.has(`${c}|${d}|${w}`);
                const isPause = (p: number): boolean =>
                  p === 7 || (allow5 && p === 5) || classBlockedCells.has(cK(d, w, c, p));
                const occAt = (p: number): boolean => cell.has(cK(d, w, c, p));
                const core: number[] = [];
                for (let p = 1; p <= PERIODS; p++) if (!isPause(p) && occAt(p)) core.push(p);
                if (core.length < 2) continue;
                // Zusammenhängende Loch-Fenster zwischen erster und letzter Stunde suchen.
                for (let p = core[0]; p <= core[core.length - 1]; p++) {
                  if (isPause(p) || occAt(p)) continue;
                  let end = p;
                  while (end + 1 <= core[core.length - 1] && !isPause(end + 1) && !occAt(end + 1)) end++;
                  const len = end - p + 1;
                  // Kandidat: einfache Karte derselben Spalte an ANDEREM Tag/Woche, exakt
                  // loch-groß und dort am Rand (Entfernen reißt keine neue Lücke).
                  const cand = assigns.find((a) => {
                    if (!isSimple(a.card) || a.c !== c || (a.d === d && a.w === w) || a.card.duration > len) return false;
                    // Karten mit fester Lage (Randstunden/Spiegel/Betriebstag) NIE umziehen –
                    // deren Regeln stecken in baseStarts, nicht in check().
                    if (isOlz(a.card) || isSpan(a.card) || isSk(a.card) || isBetrieb(a.card)) return false;
                    if (!baseStarts(a.card).includes(p)) return false;
                    const sAllow5 = werkClassDay.has(`${a.c}|${a.d}|${a.w}`);
                    const sCore: number[] = [];
                    for (let q = 1; q <= PERIODS; q++)
                      if (!(q === 7 || (sAllow5 && q === 5) || classBlockedCells.has(cK(a.d, a.w, a.c, q))) && cell.has(cK(a.d, a.w, a.c, q))) sCore.push(q);
                    // Nur vom TAGES-ENDE nehmen (oder der Tag wird komplett frei) – Karten
                    // vom Morgenrand zu klauen ließe den Quelltag erst mittags beginnen.
                    const wholeDay = sCore.length === a.card.duration;
                    const atEnd = a.start + a.card.duration - 1 === sCore[sCore.length - 1] && a.start > sCore[0];
                    return wholeDay || atEnd;
                  });
                  if (!cand) { p = end; continue; }
                  const old = { c: cand.c, d: cand.d, w: cand.w, start: cand.start };
                  unapplySimple(cand);
                  if (check(cand.card, c, d, w, p) === null) {
                    apply(cand.card, c, d, w, p);
                    moved = true;
                    // Nur hinter die eingezogene Karte rücken – der Rest des Lochs
                    // bekommt in der nächsten Schleifenrunde einen weiteren Kandidaten.
                    p = p + cand.card.duration - 1;
                  } else {
                    apply(cand.card, old.c, old.d, old.w, old.start); // passt nicht → zurück
                    p = end;
                  }
                }
              }
            }
          }
          if (!moved) break;
        }
      }

      let openMandatory = 0;
      for (let c = 0; c < this.classes.count; c++) {
        for (let d = 0; d < DAYS.length; d++) {
          for (const w of WEEKS) {
            if (!this.classes.classNameAt(c, d, w).trim()) continue;
            for (let p = 1; p <= 6; p++)
              if (!cell.has(cK(d, w, c, p)) && !classBlockedCells.has(cK(d, w, c, p))) openMandatory++;
          }
        }
      }
      let imbalance = 0;
      let imbalTeachers = 0; // Anzahl Lehrkräfte mit |u−g| > Limit (für Anzeige/Meldung)
      for (const [u, g] of teachWeek.values()) {
        const over = Math.max(0, Math.abs(u - g) - IMBAL);
        imbalance += over;
        if (over > 0) imbalTeachers++;
      }

      // Hohlstunden je Lehrkraft und Woche (Freistunden zwischen erster und letzter
      // belegter Stunde, über die Tage summiert); zähle nur die Überschreitung von 6.
      const weekGap = new Map<string, number>(); // kürzel|w → Hohlstunden gesamt
      for (const [key, periods] of teachDayPeriods) {
        const [abbr, , w] = key.split('|');
        const arr = [...periods];
        const gap = Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
        const wk = `${abbr}|${w}`;
        weekGap.set(wk, (weekGap.get(wk) ?? 0) + gap);
      }
      let gaps = 0;
      for (const g of weekGap.values()) gaps += Math.max(0, g - GAP_LIMIT);

      // u/g-Parallelität: je Lehrkraft+Klasse+Fach die Slots, die nur in EINER Woche
      // liegen (symmetrische Differenz der u-/g-Slots). Klein = viel parallel.
      let mirrorMismatch = 0;
      for (const slots of mirrorSlots.values()) {
        const uSet = new Set<string>();
        const gSet = new Set<string>();
        for (const s of slots) {
          const i = s.lastIndexOf('|');
          (s.slice(i + 1) === 'u' ? uSet : gSet).add(s.slice(0, i));
        }
        for (const x of uSet) if (!gSet.has(x)) mirrorMismatch++;
        for (const x of gSet) if (!uSet.has(x)) mirrorMismatch++;
      }

      // Hohlstunden je KLASSE (harte Schüler-Regel): Lücken zwischen erster und
      // letzter Stunde jedes Klassentags; Pausen (7. bzw. 5. am Werkstatt-Tag) frei.
      let classGapsTotal = 0;
      const NO_NEW = new Set<number>();
      for (let c = 0; c < this.classes.count; c++)
        for (let d = 0; d < DAYS.length; d++)
          for (const w of WEEKS) classGapsTotal += classGaps(c, d, w, NO_NEW);

      return { assigns, skipped, openMandatory, imbalance, imbalTeachers, gaps, mirrorMismatch, olzSlotsCount: olzSlots.size, classGapsTotal };
    };

    // Auswahlkriterium (Priorität): meiste platzierte Karten → u/g-Stunden-Balance
    // → meiste u/g-Parallelität → wenigste Hohlstunden → wenigste offene Pflichtstunden.
    const better = (a: Outcome, b: Outcome): boolean => {
      // OLZ-Schienen sind ZWINGEND zeitgleich über alle 4 AV-Klassen → wenige distinkte
      // OLZ-Slots haben Vorrang (8 = perfekt). Erst danach zählt die Gesamtzahl.
      if (a.olzSlotsCount !== b.olzSlotsCount) return a.olzSlotsCount < b.olzSlotsCount;
      if (a.assigns.length !== b.assigns.length) return a.assigns.length > b.assigns.length;
      // Schüler dürfen KEINE Hohlstunden haben (harte Regel): Lücken in Klassentagen
      // wiegen schwerer als alle weichen Lehrer-Kriterien.
      if (a.classGapsTotal !== b.classGapsTotal) return a.classGapsTotal < b.classGapsTotal;
      // u/g-Differenz wird PRO LEHRKRAFT bewertet: zuerst möglichst WENIGE Lehrkräfte
      // über dem Limit, dann möglichst kleine Überschreitung. Die Gesamtsumme allein
      // ist nicht das Ziel.
      if (a.imbalTeachers !== b.imbalTeachers) return a.imbalTeachers < b.imbalTeachers;
      if (a.imbalance !== b.imbalance) return a.imbalance < b.imbalance;
      if (a.mirrorMismatch !== b.mirrorMismatch) return a.mirrorMismatch < b.mirrorMismatch;
      if (a.gaps !== b.gaps) return a.gaps < b.gaps;
      return a.openMandatory < b.openMandatory;
    };
    // „Perfekt": alle Karten verplant, u/g-Differenz überall ≤ 2 UND keine Lehrkraft
    // mit mehr als 6 Hohlstunden pro Woche.
    const perfect = (o: Outcome): boolean =>
      o.skipped.length === 0 && o.imbalance === 0 && o.gaps === 0 && o.classGapsTotal === 0;

    const rng = Math.random;
    const total = this.pool.all.length;
    const start = Date.now();
    let best = runOnce(false, rng); // 1. Durchlauf: Heuristik
    bestPlaced = best.assigns.length;
    let attempts = 1;
    let stop: 'continue' | 'accept' | 'cancel' = 'continue';

    // WICHTIG: NICHT beim ersten „perfekten" Ergebnis (alle verplant + im Limit)
    // abbrechen – das ignorierte die weichen Kriterien aus better() (u/g-Parallelität,
    // offene Pflichtstunden, Lage) und stoppte sofort ohne Optimierung. Stattdessen
    // per Zufalls-Neustarts WEITER suchen und das beste Ergebnis behalten. Abbruch
    // bei Budget, Nutzer-Stopp oder Konvergenz (eine Weile keine Verbesserung mehr).
    let lastImprove = Date.now();
    // Konvergenz-Fenster: Ist schon eine PERFEKTE Lösung gefunden (alles verplant, im
    // Limit), reicht ein kurzes Fenster. Sind noch Karten offen, wird VIEL länger
    // weitergesucht (Zufalls-Neustarts platzieren stark eingeschränkte Karten – z. B.
    // Schienen – evtl. erst nach vielen Versuchen). Harte Obergrenze = budgetMs; der
    // Nutzer kann jederzeit „Stopp" drücken.
    const PERFECT_NO_IMPROVE = 5000; // perfekt: 5 s ohne Verbesserung → fertig
    const PLACED_NO_IMPROVE = 20000; // alles verplant (aber u/g/Hohlst. nicht ideal): 20 s feinjustieren
    const OPEN_NO_IMPROVE = 120000; // noch offen: 120 s ohne Verbesserung weitersuchen, dann aufgeben
    // IDs der noch nicht verplanten Karten – die werden im nächsten Durchlauf ZUERST
    // platziert (gezielter Neustart), damit knappe Slots an die schweren Karten gehen.
    const openIds = (o: Outcome): Set<string> => {
      const placed = new Set(o.assigns.map((a) => a.card.id));
      return new Set(this.pool.all.map((c) => c.id).filter((id) => !placed.has(id)));
    };
    // Zyklen in Zeitscheiben (je ~40 ms), dazwischen ans Event-Loop abgeben. Solange noch
    // Karten offen sind, wird – abwechselnd zufällig UND gezielt (focus) – bis zum vollen
    // Budget weitergesucht; „Stopp" bricht jederzeit ab.
    while (Date.now() - start < opts.budgetMs) {
      stop = opts.shouldStop();
      if (stop !== 'continue') break;
      const sliceStart = Date.now();
      const focus = best.skipped.length ? openIds(best) : EMPTY_FOCUS;
      while (Date.now() - sliceStart < 40 && Date.now() - start < opts.budgetMs) {
        // Jeder zweite Versuch gezielt (offene Karten zuerst), sonst rein zufällig –
        // so wird sowohl breit gestreut als auch der Engpass gezielt angegangen.
        const cand = focus.size && attempts % 2 === 0 ? runOnce(true, rng, focus) : runOnce(true, rng);
        attempts++;
        if (better(cand, best)) {
          best = cand;
          bestPlaced = Math.max(bestPlaced, best.assigns.length);
          lastImprove = Date.now();
        }
      }
      opts.onProgress?.({
        elapsedMs: Date.now() - start,
        attempts,
        placed: best.assigns.length,
        total,
        skipped: best.skipped.length,
        imbalance: best.imbalance,
        imbalTeachers: best.imbalTeachers,
        gaps: best.gaps,
      });
      // Noch Karten offen → lange weitersuchen (gezielte Neustarts); alles verplant →
      // kurzes Fenster zum Feinjustieren. Obergrenze bleibt budgetMs; „Stopp" jederzeit.
      const noImproveMs =
        best.skipped.length > 0 ? OPEN_NO_IMPROVE : perfect(best) ? PERFECT_NO_IMPROVE : PLACED_NO_IMPROVE;
      if (Date.now() - lastImprove > noImproveMs) break; // konvergiert → fertig
      await new Promise((r) => setTimeout(r));
    }

    if (stop === 'cancel') {
      return { placed: 0, skipped: [], openMandatory: 0, weekImbalance: [], weekGaps: [], solved: false, cancelled: true, attempts, elapsedMs: Date.now() - start };
    }

    // Bestes Ergebnis anwenden: Karten aus dem Pool in den Plan übernehmen.
    for (const a of best.assigns) {
      const card = this.pool.remove(a.card.id);
      if (!card) continue;
      this.schedule.add(
        new Placement(this.nextId(), card.snapshot(), { day: a.d, startPeriod: a.start, classIdx: a.c, week: a.w }),
      );
    }
    this.emit();

    const weekImbalance = this.teacherWeekImbalance();
    const weekGaps = this.teacherWeekGaps();
    return {
      placed: best.assigns.length,
      skipped: best.skipped,
      openMandatory: best.openMandatory,
      weekImbalance,
      weekGaps,
      solved: perfect(best),
      cancelled: false,
      attempts,
      elapsedMs: Date.now() - start,
    };
  }

  /**
   * Deputats-Abgleich: je Lehrkraft die Gesamtstunden (alle Karten = importiertes
   * Deputat), davon verplant und noch offen. Gekoppelte Stunden (gleiche Lehrkraft
   * parallel in mehreren Klassen) zählen nur EINMAL. Karten ohne Kürzel (z. B.
   * Betrieb) bleiben außen vor.
   */
  deputatRows(): { abbr: string; total: number; placed: number; open: number }[] {
    const rows = new Map<string, { placed: number; open: number }>();
    const get = (abbr: string): { placed: number; open: number } => {
      const k = abbr.toLowerCase();
      let e = rows.get(k);
      if (!e) {
        e = { placed: 0, open: 0 };
        rows.set(k, e);
      }
      return e;
    };
    const label = new Map<string, string>();
    // Verplant: gekoppelte Parallel-Stunden je Slot nur einmal.
    const seenPl = new Set<string>();
    for (const p of this.schedule.all) {
      const a = p.abbr.trim();
      if (!a) continue;
      label.set(a.toLowerCase(), a);
      for (const w of p.weeks) {
        if (p.coupling.trim()) {
          const k = `${p.coupling}|${a.toLowerCase()}|${p.day}|${p.startPeriod}|${w}`;
          if (seenPl.has(k)) continue;
          seenPl.add(k);
        }
        get(a).placed += p.duration;
      }
    }
    // Offen (Pool): gekoppelte Karten derselben Lehrkraft je Kopplung nur einmal.
    const seenPool = new Set<string>();
    for (const c of this.pool.all) {
      const a = c.abbr.trim();
      if (!a) continue;
      label.set(a.toLowerCase(), a);
      if (c.coupling.trim()) {
        const k = `${c.coupling}|${a.toLowerCase()}`;
        if (seenPool.has(k)) continue;
        seenPool.add(k);
      }
      get(a).open += c.duration;
    }
    return [...rows.entries()]
      .map(([k, e]) => ({ abbr: label.get(k) ?? k, total: e.placed + e.open, placed: e.placed, open: e.open }))
      .sort((a, b) => b.open - a.open || a.abbr.localeCompare(b.abbr, 'de'));
  }

  /** Lehrkräfte, deren u-/g-Stunden um mehr als das Limit auseinanderliegen (Warnung).
   *  Gekoppelte Stunden (gleiche Lehrkraft parallel in mehreren Klassen) zählen je
   *  Slot nur EINMAL – wie der Planer intern und wie stats(). */
  teacherWeekImbalance(): { abbr: string; u: number; g: number }[] {
    const map = new Map<string, [number, number]>();
    const seen = new Set<string>(); // coupling|kürzel|tag|stunde|woche → 1×
    for (const p of this.schedule.all) {
      for (const w of p.weeks) {
        if (p.coupling.trim()) {
          const k = `${p.coupling}|${p.abbr.toLowerCase()}|${p.day}|${p.startPeriod}|${w}`;
          if (seen.has(k)) continue;
          seen.add(k);
        }
        const tw = map.get(p.abbr) ?? [0, 0];
        tw[w === 'u' ? 0 : 1] += p.duration;
        map.set(p.abbr, tw);
      }
    }
    return [...map.entries()]
      .filter(([, [u, g]]) => Math.abs(u - g) > this.planSettings.imbalanceLimit)
      .map(([abbr, [u, g]]) => ({ abbr, u, g }))
      .sort((a, b) => Math.abs(b.u - b.g) - Math.abs(a.u - a.g));
  }

  /** Belegte Stunden einer Platzierung (Werkstatt-Pause in der 5. zählt als belegt). */
  private occupiedPeriodsOf(p: Placement): number[] {
    if (!p.isWerkstatt) {
      const a: number[] = [];
      for (let i = 0; i < p.duration; i++) a.push(p.startPeriod + i);
      return a;
    }
    const t: number[] = [];
    let q = p.startPeriod;
    while (t.length < p.duration && q <= PERIODS) {
      if (q !== 5) t.push(q);
      q++;
    }
    if (t.length && p.startPeriod <= 5 && t[t.length - 1] >= 5) t.push(5);
    return t;
  }

  /** Lehrkräfte mit mehr als 6 Hohlstunden (Freistunden) in einer Woche (für die Warnung). */
  teacherWeekGaps(): { abbr: string; week: Week; gaps: number }[] {
    const byDay = new Map<string, Set<number>>(); // kürzel|tag|woche → belegte Stunden (Menge)
    for (const p of this.schedule.all) {
      const periods = this.occupiedPeriodsOf(p);
      // Wöchentliche Karten belegen u und g. Gekoppelte Parallel-Karten belegen
      // dieselben Stunden → als Menge zählen (keine Doppelung).
      for (const w of p.weeks) {
        const key = `${p.abbr}|${p.day}|${w}`;
        const set = byDay.get(key) ?? new Set<number>();
        for (const per of periods) set.add(per);
        byDay.set(key, set);
      }
    }
    const weekly = new Map<string, number>(); // kürzel|woche → Hohlstunden gesamt
    for (const [key, set] of byDay) {
      const [abbr, , w] = key.split('|');
      const periods = [...set];
      const gap = Math.max(...periods) - Math.min(...periods) + 1 - periods.length;
      const wk = `${abbr}|${w}`;
      weekly.set(wk, (weekly.get(wk) ?? 0) + gap);
    }
    const out: { abbr: string; week: Week; gaps: number }[] = [];
    for (const [wk, gaps] of weekly) {
      if (gaps > this.planSettings.gapLimit) {
        const [abbr, w] = wk.split('|');
        out.push({ abbr, week: w as Week, gaps });
      }
    }
    return out.sort((a, b) => b.gaps - a.gaps);
  }

  /**
   * Prüft den gesamten Plan gegen die harten Regeln (Fehler) und die weichen
   * Vorgaben (Warnungen) und liefert eine Liste für den Prüfbericht.
   */
  validatePlan(): { severity: 'error' | 'warn'; text: string }[] {
    const out: { severity: 'error' | 'warn'; text: string }[] = [];

    // Datenkonsistenz der KARTEN (Pool UND verplant): widersprüchliche Markierungen
    // früh melden – z. B. ein Betriebstag, der versehentlich als Labor/Werkstatt
    // gekennzeichnet ist, oder eine Karte, die gleichzeitig Labor UND Werkstatt ist.
    const seenData = new Set<string>();
    for (const c of [...this.pool.all, ...this.schedule.all]) {
      const isBet = /betrieb/i.test(c.fach);
      const probs: string[] = [];
      if (isBet && c.isLabor) probs.push('Betrieb ist als Labor markiert');
      if (isBet && c.isWerkstatt) probs.push('Betrieb ist als Werkstatt markiert');
      if (isBet && c.coupling.trim()) probs.push('Betrieb ist gekoppelt (nicht nötig – A/B stapeln automatisch; Kopplung verhindert die Anker-Platzierung)');
      if (!isBet && c.isLabor && c.isWerkstatt) probs.push('ist gleichzeitig Labor UND Werkstatt');
      if (!probs.length) continue;
      const sig = `${c.klasse}|${c.fach.toLowerCase()}|${probs.join(',')}`;
      if (seenData.has(sig)) continue;
      seenData.add(sig);
      out.push({ severity: 'error', text: `Daten: ${c.klasse || '?'} „${c.fach}" – ${probs.join(', ')}. Bitte Markierung in der Excel prüfen.` });
    }

    // Werkstatt unter 4 Std: hat eine Klasse+Gruppe (je Basis-Fach) insgesamt weniger
    // als 4 Werkstatt-Stunden, kann NIE ein ≥4h-Block entstehen – die Karten bleiben
    // beim Auto-Verplanen offen. Datenthema: Karten ergänzen oder Block anders planen.
    {
      const wkSum = new Map<string, { h: number; sample: { klasse: string; fach: string; abbr: string } }>();
      const bf = (f: string): string => f.trim().toLowerCase().replace(/^[abcd][_-]/, '');
      for (const c of [...this.pool.all, ...this.schedule.all]) {
        if (!c.isWerkstatt) continue;
        const k = `${c.klasse.trim().toLowerCase()}|${c.labGroup}|${bf(c.fach)}`;
        const e = wkSum.get(k) ?? wkSum.set(k, { h: 0, sample: c }).get(k)!;
        e.h += c.duration;
      }
      for (const { h, sample } of wkSum.values()) {
        if (h >= 4) continue;
        out.push({
          severity: 'warn',
          text: `Daten: ${sample.klasse} „${sample.fach}" (${sample.abbr || 'ohne Kürzel'}) hat insgesamt nur ${h} Werkstatt-Std – ein ≥4h-Block ist unmöglich, die Karte bleibt beim Auto-Verplanen offen.`,
        });
      }
    }

    // Kopplungen ohne Parallelität: alle Karten derselben Kopplung haben dieselbe
    // Klasse+Lehrkraft(+Gruppe) → sie würden übereinander auf denselben Slot gelegt
    // (vermutlich sollte je Karte eine eigene Kopplungs-Nummer vergeben werden).
    const coupCards = new Map<string, { klasse: string; abbr: string; fach: string; labGroup: string }[]>();
    for (const c of [...this.pool.all, ...this.schedule.all]) {
      const cid = c.coupling.trim();
      if (cid) (coupCards.get(cid) ?? coupCards.set(cid, []).get(cid)!).push(c);
    }
    for (const [cid, cs] of coupCards) {
      if (cs.length < 2) continue;
      const allSame = cs.every(
        (c) =>
          c.klasse.trim().toLowerCase() === cs[0].klasse.trim().toLowerCase() &&
          c.abbr.trim().toLowerCase() === cs[0].abbr.trim().toLowerCase() &&
          c.labGroup === cs[0].labGroup,
      );
      if (allSame)
        out.push({
          severity: 'warn',
          text: `Daten: Kopplung „${cid}" (${cs[0].klasse} ${cs[0].abbr} ${cs[0].fach}) enthält ${cs.length} identische Karten – sie liegen übereinander. Gewollt? Sonst je Karte eigene Kopplungs-Nr. vergeben.`,
        });
    }

    // ¼ 4-wöchig: eine 4-wöchige Karte darf nie ALLEIN liegen – sonst hat die
    // Klasse dort jede 4. Woche keinen Unterricht. Parallel (gestapelt) muss
    // eine weitere 4-wö.-Karte liegen, die die Zwischenwochen füllt.
    {
      const viers = this.schedule.all.filter((p) => p.isVierwoechig);
      const seenV = new Set<string>();
      for (const p of viers) {
        const uncovered = p
          .occupiedPeriods()
          .filter(
            (per) =>
              !viers.some(
                (q) =>
                  q.id !== p.id &&
                  q.classIdx === p.classIdx &&
                  q.day === p.day &&
                  q.week === p.week &&
                  q.occupiedPeriods().includes(per),
              ),
          );
        if (!uncovered.length) continue;
        const sig = `${p.klasse}|${p.abbr}|${p.fach}|${p.day}|${p.week}|${p.startPeriod}`;
        if (seenV.has(sig)) continue;
        seenV.add(sig);
        out.push({
          severity: 'error',
          text: `¼ 4-wöchig allein: ${p.klasse || '?'} ${p.abbr} ${p.fach} (${DAYS[p.day]}, ${p.week}-Woche, Std ${uncovered.join(',')}) – jede 4. Woche fällt der Unterricht aus. Eine zweite 4-wö.-Karte muss parallel (gestapelt) liegen.`,
        });
      }
    }

    const pls = this.schedule.all;
    // Zwei 4-wöchige Karten dürfen sich überlagern (sie wechseln sich im
    // 4-Wochen-Rhythmus ab) – auch gleiche Lehrkraft/Raum ist dann kein Konflikt.
    const linked = (a: Placement, b: Placement): boolean =>
      (!!a.coupling && a.coupling === b.coupling) ||
      (!!a.teamTeaching && a.teamTeaching === b.teamTeaching) ||
      (a.isVierwoechig && b.isVierwoechig);
    const slotKey = (d: number, w: Week, p: number): string => `${d}|${w}|${p}`;
    const lbl = (p: Placement): string => `${p.klasse || '?'} ${p.abbr}${p.fach ? ' ' + p.fach : ''}`;
    // 8-Std-Tag am Stück erlaubt: K2FR/K3FR (randvoll) und Betrieb-Ganztagsblöcke.
    const LONG_DAY_CLASSES = new Set<string>(['k2fr', 'k3fr']);
    const isLongDay = (p: Placement): boolean =>
      LONG_DAY_CLASSES.has(p.klasse.trim().toLowerCase()) || /betrieb/i.test(p.fach);

    // Belegung je Stunde sammeln.
    const roomAt = new Map<string, Placement[]>(); // tag|woche|stunde|raum
    const teachAt = new Map<string, Placement[]>(); // tag|woche|stunde|kürzel
    const teachDay = new Map<string, Set<number>>(); // kürzel|tag|woche → Unterrichtsstunden
    const teachWerkLaborDay = new Set<string>(); // kürzel|tag|woche mit Werkstatt/Labor → 8 statt 6 Std erlaubt
    const teachLongDay = new Set<string>(); // kürzel|tag|woche mit 8-Std-Klasse/Betrieb → 8 statt 6 Std erlaubt
    for (const p of pls) {
      // Lehrerlose Karten (kein Kürzel, z. B. Betrieb) erzeugen KEINE Lehrer-Konflikte –
      // sonst würden mehrere lehrerlose Karten (leeres Kürzel) klassenübergreifend
      // fälschlich als „Lehrkraft zeitgleich in mehreren Klassen" gemeldet.
      const hasAbbr = !!p.abbr.trim();
      for (const w of p.weeks) {
        for (const per of p.occupiedPeriods()) {
          if (p.room.trim()) {
            const k = `${slotKey(p.day, w, per)}|${p.room.trim().toLowerCase()}`;
            (roomAt.get(k) ?? roomAt.set(k, []).get(k)!).push(p);
          }
          if (hasAbbr) {
            const tk = `${slotKey(p.day, w, per)}|${p.abbr.toLowerCase()}`;
            (teachAt.get(tk) ?? teachAt.set(tk, []).get(tk)!).push(p);
          }
        }
        if (!hasAbbr) continue;
        const dk = `${p.abbr.toLowerCase()}|${p.day}|${w}`;
        const set = teachDay.get(dk) ?? new Set<number>();
        for (const per of teachingPeriods(p.isWerkstatt, p.startPeriod, p.duration)) set.add(per);
        teachDay.set(dk, set);
        if (p.isWerkstatt || p.isLabor) teachWerkLaborDay.add(dk);
        if (isLongDay(p)) teachLongDay.add(dk);
        if (!p.isWerkstatt && !/betrieb/i.test(p.fach) && teachingPeriods(p.isWerkstatt, p.startPeriod, p.duration).includes(7)) {
          out.push({ severity: 'warn', text: `7. Stunde belegt: ${lbl(p)} (${DAYS[p.day]}, ${w}-Woche)` });
        }
      }
    }

    // Raum-Doppelbelegung (verschiedene, nicht gekoppelte Karten im selben Raum/Slot).
    const seenRoom = new Set<string>();
    for (const [k, arr] of roomAt) {
      if (arr.length < 2) continue;
      const bad = arr.find((p) => arr.some((q) => p !== q && !linked(p, q)));
      if (!bad) continue;
      const [d, w, , room] = k.split('|');
      const sig = `${d}|${w}|${room}`;
      if (seenRoom.has(sig)) continue;
      seenRoom.add(sig);
      const who = [...new Set(arr.map(lbl))].join(', ');
      out.push({ severity: 'error', text: `Raum doppelt belegt: ${room.toUpperCase()} (${DAYS[+d]}, ${w}-Woche) – ${who}` });
    }

    // Lehrkraft zeitgleich in zwei (nicht gekoppelten) Klassen.
    const seenTeach = new Set<string>();
    for (const [k, arr] of teachAt) {
      if (arr.length < 2) continue;
      const clash = arr.find((p) => arr.some((q) => p !== q && p.classIdx !== q.classIdx && !linked(p, q)));
      if (!clash) continue;
      const [d, w, , abbr] = k.split('|');
      const sig = `${d}|${w}|${abbr}`;
      if (seenTeach.has(sig)) continue;
      seenTeach.add(sig);
      const where = [...new Set(arr.map((p) => p.klasse || '?'))].join(', ');
      out.push({ severity: 'error', text: `${abbr.toUpperCase()} zeitgleich in mehreren Klassen (${DAYS[+d]}, ${w}-Woche): ${where}` });
    }

    // Lehrkraft zu viele Stunden an einem Tag (max. 6, aber 8 bei Werkstatt/Labor-Tag).
    for (const [dk, set] of teachDay) {
      const max = teachWerkLaborDay.has(dk) || teachLongDay.has(dk) ? 8 : 6;
      if (set.size > max) {
        const [abbr, d, w] = dk.split('|');
        out.push({ severity: 'error', text: `${abbr.toUpperCase()} hat ${set.size} Std am ${DAYS[+d]} (${w}-Woche) – max. ${max}.` });
      }
    }

    // Mehr als 4 Stunden am Stück derselben Lehrkraft in einer Klasse (außer Werkstatt).
    const seenStreak = new Set<string>();
    for (const p of pls) {
      if (p.isWerkstatt) continue;
      for (const w of p.weeks) {
        const dk = `${p.abbr.toLowerCase()}|${p.classIdx}|${p.day}|${w}`;
        if (seenStreak.has(dk)) continue;
        const periods = pls
          .filter((q) => q.abbr === p.abbr && q.classIdx === p.classIdx && q.day === p.day && q.occupiesWeek(w) && !q.isWerkstatt)
          .flatMap((q) => teachingPeriods(q.isWerkstatt, q.startPeriod, q.duration));
        const uniq = [...new Set(periods)].sort((a, b) => a - b);
        let run = 1;
        let maxRun = 1;
        for (let i = 1; i < uniq.length; i++) {
          run = uniq[i] === uniq[i - 1] + 1 ? run + 1 : 1;
          maxRun = Math.max(maxRun, run);
        }
        if (maxRun > (isLongDay(p) ? 8 : 4)) {
          seenStreak.add(dk);
          out.push({ severity: 'warn', text: `${p.abbr} unterrichtet ${maxRun} Std am Stück in ${p.klasse} (${DAYS[p.day]}, ${w}-Woche).` });
        }
      }
    }

    // Platzierungen auf Lehrer-Sperrzeiten (z. B. per „Trotzdem platzieren").
    const seenBlock = new Set<string>();
    for (const p of pls) {
      for (const w of p.weeks) {
        for (const per of teachingPeriods(p.isWerkstatt, p.startPeriod, p.duration)) {
          if (this.isTeacherBlocked(p.abbr, p.day, w, per)) {
            const sig = `${p.abbr}|${p.day}|${w}`;
            if (seenBlock.has(sig)) continue;
            seenBlock.add(sig);
            out.push({ severity: 'error', text: `${p.abbr} unterrichtet in einer Sperrzeit (${DAYS[p.day]}, ${w}-Woche): ${lbl(p)}` });
          }
        }
      }
    }

    // Teilzeit: mehr Anwesenheitstage als erlaubt (Fehler).
    const daysByTeacher = new Map<string, Set<number>>();
    for (const p of pls) {
      const set = daysByTeacher.get(p.abbr) ?? new Set<number>();
      set.add(p.day);
      daysByTeacher.set(p.abbr, set);
    }
    for (const [abbr, set] of daysByTeacher) {
      const max = this.teacherMaxDaysOf(abbr);
      if (max > 0 && set.size > max) {
        out.push({ severity: 'error', text: `${abbr} ist an ${set.size} Tagen verplant – erlaubt sind ${max}.` });
      }
    }

    // Labor/Werkstatt: höchstens 4 Karten je Stapel (Gruppen a/b/c/d parallel).
    const stackCount = new Map<string, number>();
    for (const p of pls) {
      if (!(p.isLabor || p.isWerkstatt) || p.teamTeaching.trim() || p.coupling.trim()) continue;
      for (const w of p.weeks) for (const per of p.occupiedPeriods()) {
        const k = `${p.classIdx}|${p.day}|${w}|${per}`;
        stackCount.set(k, (stackCount.get(k) ?? 0) + 1);
      }
    }
    const seenStack = new Set<string>();
    for (const [k, n] of stackCount) {
      if (n <= 4) continue;
      const [c, d, w] = k.split('|');
      const sig = `${c}|${d}|${w}`;
      if (seenStack.has(sig)) continue;
      seenStack.add(sig);
      out.push({ severity: 'error', text: `${this.classes.columnLabel(+c)} (${DAYS[+d]}, ${w}-Woche): ${n} Karten gestapelt – Labor/Werkstatt erlaubt höchstens 4 (Gruppen a/b/c/d).` });
    }

    // u/g-Differenz > 2 (Warnung).
    for (const { abbr, u, g } of this.teacherWeekImbalance()) {
      out.push({ severity: 'warn', text: `${abbr}: u/g-Differenz ${Math.abs(u - g)} (u ${u} · g ${g}) – Ziel ≤ ${this.planSettings.imbalanceLimit}.` });
    }
    // Hohlstunden über dem Limit (Warnung).
    for (const { abbr, week, gaps } of this.teacherWeekGaps()) {
      out.push({ severity: 'warn', text: `${abbr}: ${gaps} Hohlstunden in der ${week}-Woche – max. ${this.planSettings.gapLimit}.` });
    }

    // Offene Pflichtstunden 1–6 in aktiven Klassenspalten (Warnung).
    const cellBusy = new Set<string>();
    const werkClassDays = new Set<string>(); // c|d|w mit Werkstatt → Klassen-Pause in der 5. statt 7.
    for (const p of pls)
      for (const w of p.weeks) {
        for (const per of p.occupiedPeriods()) cellBusy.add(`${p.classIdx}|${p.day}|${w}|${per}`);
        if (p.isWerkstatt) werkClassDays.add(`${p.classIdx}|${p.day}|${w}`);
      }
    // Karten in Klassen-Sperrzeiten (z. B. Betriebstag) melden.
    for (const p of pls) {
      const klasse = p.klasse.trim() || this.classes.columnLabel(p.classIdx);
      for (const w of p.weeks) {
        const hit = p.occupiedPeriods().some((per) => this.isClassBlocked(klasse, p.day, w, per));
        if (hit) {
          const b = this.classBlocksFor(klasse, p.day, w)[0];
          out.push({
            severity: 'error',
            text: `${lbl(p)} liegt in einer Klassen-Sperrzeit${b?.text ? ` („${b.text}")` : ''} (${DAYS[p.day]}, ${w}-Woche).`,
          });
        }
      }
    }
    for (let c = 0; c < this.classes.count; c++) {
      for (let d = 0; d < DAYS.length; d++) {
        for (const w of WEEKS) {
          const name = this.classes.classNameAt(c, d, w).trim();
          if (!name) continue;
          // Pausen: 7. Stunde, an Werkstatt-Tagen die 5., sowie Klassen-Sperrzeiten.
          const allow5 = werkClassDays.has(`${c}|${d}|${w}`);
          const isPause = (per: number): boolean =>
            per === 7 || (allow5 && per === 5) || this.isClassBlocked(name, d, w, per);
          const open: number[] = [];
          for (let per = 1; per <= 6; per++) if (!isPause(per) && !cellBusy.has(`${c}|${d}|${w}|${per}`)) open.push(per);
          if (open.length) {
            out.push({ severity: 'warn', text: `${name} (${DAYS[d]}, ${w}-Woche): Stunde ${open.join(', ')} der Pflichtstunden 1–6 frei.` });
          }
          // KLASSEN-HOHLSTUNDEN (harte Schüler-Regel): Lücken zwischen erster und
          // letzter Stunde – Schüler müssen durchweg Unterricht haben.
          let min = 0;
          let max = 0;
          for (let per = 1; per <= PERIODS; per++) {
            if (isPause(per) || !cellBusy.has(`${c}|${d}|${w}|${per}`)) continue;
            if (!min) min = per;
            max = per;
          }
          if (min) {
            const holes: number[] = [];
            for (let per = min; per <= max; per++) if (!isPause(per) && !cellBusy.has(`${c}|${d}|${w}|${per}`)) holes.push(per);
            if (holes.length) {
              out.push({ severity: 'error', text: `${name} (${DAYS[d]}, ${w}-Woche): Schüler-Hohlstunde(n) ${holes.join(', ')} – Klassen müssen durchweg Unterricht haben.` });
            }
          }
        }
      }
    }

    // WERKSTATT ≥4h (harte Regel): je Klasse+Gruppe+Tag+Woche nie unter 4 Stunden.
    const werkHours = new Map<string, number>();
    for (const p of pls) {
      if (!p.isWerkstatt) continue;
      for (const w of p.weeks) {
        const k = `${p.klasse.trim() || this.classes.columnLabel(p.classIdx)}|${p.labGroup || '–'}|${p.day}|${w}`;
        werkHours.set(k, (werkHours.get(k) ?? 0) + p.duration);
      }
    }
    for (const [k, h] of werkHours) {
      if (h >= 4) continue;
      const [kl, grp, d, w] = k.split('|');
      out.push({
        severity: 'error',
        text: `${kl} (${DAYS[+d]}, ${w}-Woche): Werkstatt Gruppe ${grp} nur ${h} Std – Werkstatt braucht mindestens 4 Std am Stück.`,
      });
    }

    return out;
  }

  // ── Auslastung (für die Übersicht) ────────────────────────────────────────

  /**
   * Lehrer-Tageslast: je Lehrkraft und Wochentag die Spitzen-Stundenzahl
   * (Maximum aus u- und g-Woche, gezählt als belegte Unterrichtsstunden).
   */
  teacherDayLoad(): { abbr: string; days: number[]; total: number }[] {
    const map = new Map<string, Map<string, Set<number>>>(); // abbr → (d|w → Stunden)
    for (const p of this.schedule.all) {
      const per = teachingPeriods(p.isWerkstatt, p.startPeriod, p.duration);
      for (const w of p.weeks) {
        const inner = map.get(p.abbr) ?? new Map<string, Set<number>>();
        const key = `${p.day}|${w}`;
        const set = inner.get(key) ?? new Set<number>();
        for (const x of per) set.add(x);
        inner.set(key, set);
        map.set(p.abbr, inner);
      }
    }
    const out: { abbr: string; days: number[]; total: number }[] = [];
    for (const [abbr, inner] of map) {
      const days: number[] = [];
      let total = 0;
      for (let d = 0; d < DAYS.length; d++) {
        const u = inner.get(`${d}|u`)?.size ?? 0;
        const g = inner.get(`${d}|g`)?.size ?? 0;
        const peak = Math.max(u, g);
        days.push(peak);
        total += peak;
      }
      out.push({ abbr, days, total });
    }
    return out.sort((a, b) => a.abbr.localeCompare(b.abbr, 'de'));
  }

  /** Raum-Auslastung: belegte (Tag·Woche·Stunde)-Slots je Raum und Anteil. */
  roomUtilization(): { room: string; used: number; total: number; pct: number }[] {
    const total = DAYS.length * WEEKS.length * PERIODS; // alle möglichen Slots
    const used = new Map<string, Set<string>>();
    for (const p of this.schedule.all) {
      const room = p.room.trim();
      if (!room) continue;
      const set = used.get(room) ?? new Set<string>();
      for (const w of p.weeks) for (const per of p.occupiedPeriods()) set.add(`${p.day}|${w}|${per}`);
      used.set(room, set);
    }
    return this.roomList()
      .map((room) => {
        const u = used.get(room)?.size ?? 0;
        return { room, used: u, total, pct: Math.round((u / total) * 100) };
      })
      .sort((a, b) => b.used - a.used || a.room.localeCompare(b.room, 'de'));
  }

  // ── Serialisierung (Format kompatibel zur Vorgänger-App) ───────────────

  toJSON(): PersistedState {
    const teacherBlocks: Record<string, string[]> = {};
    for (const [abbr, set] of this.teacherBlocks) if (set.size) teacherBlocks[abbr] = [...set];
    const teacherMaxDays: Record<string, number> = {};
    for (const [abbr, n] of this.teacherMaxDays) if (n > 0) teacherMaxDays[abbr] = n;
    const teacherColors: Record<string, string> = {};
    for (const [abbr, color] of this.teacherColors) if (color) teacherColors[abbr] = color;
    return {
      classes: this.classes.toPersisted(),
      cards: this.pool.all.map((c) => c.toJSON()),
      placed: this.schedule.all.map((p) => p.toJSON()),
      nid: this.nid,
      rooms: [...this.rooms],
      teacherBlocks,
      teacherMaxDays,
      teacherColors,
      classBlocks: this.classBlocks.map((b) => ({ ...b })),
      planSettings: { ...this.planSettings },
    };
  }

  /** Deserialisiert die Lehrer-Sperrzeiten aus dem Persistenzformat. */
  static parseTeacherBlocks(raw: Record<string, string[]> | undefined): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    if (raw) for (const [abbr, slots] of Object.entries(raw)) if (Array.isArray(slots) && slots.length) map.set(abbr, new Set(slots));
    return map;
  }

  /** Deserialisiert die max. Anwesenheitstage aus dem Persistenzformat. */
  static parseTeacherMaxDays(raw: Record<string, number> | undefined): Map<string, number> {
    const map = new Map<string, number>();
    if (raw) for (const [abbr, n] of Object.entries(raw)) if (Number(n) > 0) map.set(abbr, Number(n));
    return map;
  }

  /** Deserialisiert die dauerhafte Farbzuordnung aus dem Persistenzformat. */
  static parseTeacherColors(raw: Record<string, string> | undefined): Map<string, string> {
    const map = new Map<string, string>();
    if (raw) for (const [abbr, color] of Object.entries(raw)) if (color) map.set(abbr.toLowerCase(), String(color));
    return map;
  }

  /** Deserialisiert die Klassen-Sperrzeiten aus dem Persistenzformat. */
  static parseClassBlocks(raw: ClassBlock[] | undefined): ClassBlock[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((b) => b && typeof b.klasse === 'string' && b.klasse.trim())
      .map((b) => ({
        klasse: String(b.klasse).trim(),
        day: Math.max(0, Math.min(4, Number(b.day) || 0)),
        week: b.week === 'g' ? 'g' : 'u',
        from: Math.max(1, Math.min(9, Number(b.from) || 1)),
        to: Math.max(1, Math.min(9, Number(b.to) || 1)),
        text: String(b.text ?? '').trim(),
      }));
  }

  static fromJSON(raw: PersistedState): AppState {
    const pool = new CardPool();
    pool.replaceAll((raw.cards ?? []).map(Card.fromJSON));
    const schedule = new Schedule();
    schedule.replaceAll((raw.placed ?? []).map(Placement.fromJSON));
    const classes = ClassList.fromPersisted(raw.classes);
    const rooms = Array.isArray(raw.rooms) ? raw.rooms.map((r) => String(r).trim()).filter(Boolean) : [];
    const app = new AppState(pool, classes, schedule, raw.nid ?? 1, rooms, AppState.parseTeacherBlocks(raw.teacherBlocks));
    app.teacherMaxDays = AppState.parseTeacherMaxDays(raw.teacherMaxDays);
    app.teacherColors = AppState.parseTeacherColors(raw.teacherColors);
    app.classBlocks = AppState.parseClassBlocks(raw.classBlocks);
    app.planSettings = { ...DEFAULT_PLAN_SETTINGS, ...(raw.planSettings ?? {}) };
    app.lastSnapshot = JSON.stringify(app.toJSON());
    return app;
  }
}
