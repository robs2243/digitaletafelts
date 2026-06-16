import { Card } from './Card';
import { CardPool } from './CardPool';
import { ClassList } from './ClassList';
import { DAYS, PALETTE, PERIODS, WEEKS } from './constants';
import { Placement } from './Placement';
import { Schedule } from './Schedule';
import { semesterFactor } from './semester';
import type { CardProps, CardWithPlace, LabelField, PersistedState, PlacementPosition, PlanProgress, PlanRunResult, StatRow, Week } from './types';

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
  private nid: number;
  private listeners: ChangeListener[] = [];

  constructor(pool: CardPool, classes: ClassList, schedule: Schedule, nid = 1, rooms: string[] = []) {
    this.pool = pool;
    this.classes = classes;
    this.schedule = schedule;
    this.nid = nid;
    this.rooms = rooms;
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

  /** Fügt einen Raum still (ohne emit) zur gepflegten Liste hinzu, falls neu. */
  private ensureRoom(room: string): void {
    const name = room.trim();
    if (name && !this.rooms.some((r) => r.toLowerCase() === name.toLowerCase())) this.rooms.push(name);
  }

  createCard(props: CardProps): Card {
    const card = new Card(this.nextId(), props);
    this.pool.add(card);
    this.ensureRoom(props.room);
    this.emit();
    return card;
  }

  updateCard(id: string, props: CardProps): void {
    this.pool.findById(id)?.update(props);
    this.ensureRoom(props.room);
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
      if (!byAbbr.has(abbr)) byAbbr.set(abbr, color);
    };
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
      let color = byAbbr.get(card.abbr);
      if (!color) {
        color = card.color || leastUsed();
        byAbbr.set(card.abbr, color);
        if (usage.has(color)) usage.set(color, (usage.get(color) ?? 0) + 1);
      }
      card.color = color;
    }
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
      // Block-/Sperrkarten (noCount) zählen nicht; gekoppelte Karten nur einmal.
      let countIt = !p.noCount;
      if (countIt && p.coupling) {
        const key = `${p.coupling}|${p.day}|${p.startPeriod}|${p.week}`;
        if (seenCoupling.has(key)) countIt = false;
        else seenCoupling.add(key);
      }
      if (countIt) {
        const h = p.duration * semesterFactor(p) * (p.isVierwoechig ? 0.5 : 1);
        if (p.week === 'u') row.hoursU += h;
        else row.hoursG += h;
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
    const MAIN = new Set(['d', 'm', 'e', 'gk', 'wk']);
    const MAX_STREAK = 4; // max. Stunden am Stück derselben Lehrkraft in einer Klasse (außer Werkstatt)
    const LBT_MAX = 6; // max. Stunden „LBT" je Klasse und Tag
    // Hauptfach: explizit angehakt ODER über das Fach erkannt (D/M/E/Gk/Wk).
    const isMain = (c: { mainSubject: boolean; fach: string }): boolean =>
      c.mainSubject || MAIN.has(c.fach.trim().toLowerCase());
    // Schlüssel für u/g-Konstanz: gleiche Lehrkraft + Klasse + Fach.
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
    const teaching = (isWerk: boolean, start: number, dur: number): number[] => {
      if (!isWerk) {
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
    const blockedPeriods = (isWerk: boolean, start: number, dur: number): number[] => {
      const t = teaching(isWerk, start, dur);
      if (isWerk && t.length && start <= 5 && t[t.length - 1] >= 5) return [...t, 5].sort((a, b) => a - b);
      return t;
    };

    const shuffle = <T>(arr: T[], rng: () => number): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    type Place = { abbr: string; room: string; duration: number; isWerkstatt: boolean; fach: string };
    type Assign = { card: Card; c: number; d: number; w: Week; start: number };
    interface Outcome {
      assigns: Assign[];
      skipped: { card: string; reason: string }[];
      openMandatory: number;
      /** Summe der Überschreitungen der erlaubten u/g-Differenz (2) über alle Lehrkräfte. */
      imbalance: number;
      /** Summe der Hohlstunden über dem Limit (6) über alle Lehrkraft-Wochen. */
      gaps: number;
      /** u/g-Abweichung: Slots, die bei gleicher Lehrkraft+Klasse+Fach nur in einer
       *  Woche liegen (kleiner = u- und g-Woche ähnlicher). */
      mirrorMismatch: number;
    }

    const baseStarts = (card: Card): number[] => (card.isWerkstatt ? [1] : [1, 2, 3, 4, 5, 6, 8]);

    /**
     * Ein vollständiger Verplanungs-Durchlauf auf einer eigenen Belegungs-Simulation.
     * Bestehende Platzierungen (auch fixierte) werden NICHT verschoben, sondern nur
     * als Belegung berücksichtigt. shuffleOrder=true variiert die Reihenfolge.
     */
    const runOnce = (shuffleOrder: boolean, rng: () => number): Outcome => {
      const cell = new Set<string>();
      const roomSet = new Set<string>();
      const teachSet = new Set<string>();
      const teachClass = new Set<string>(); // Lehrer unterrichtet in dieser Klasse: kürzel|c|d|w|p
      const teachH = new Map<string, number>();
      const teachWeek = new Map<string, [number, number]>(); // kürzel → [u-Stunden, g-Stunden]
      const teachDayPeriods = new Map<string, Set<number>>(); // kürzel|d|w → belegte Stunden (für Hohlstunden)
      const subj = new Map<string, number>(); // klasse|d|w|fach → Stunden (alle Fächer)
      const mirrorSlots = new Map<string, Set<string>>(); // kürzel|klasse|fach → belegte „tag|start|woche" (für u/g-Konstanz)
      const groupB: { c: number; d: number; w: Week; start: number; duration: number; isWerk: boolean; klasse: string }[] = [];
      const assigns: Assign[] = [];
      const skipped: { card: string; reason: string }[] = [];

      // countTeacher=false bei gekoppelten Folge-Karten: gleiche Lehrerstunde nur einmal zählen.
      const occupy = (card: Place, kl: string, c: number, d: number, w: Week, start: number, countTeacher = true): void => {
        const dayKey = thK(card.abbr, d, w);
        let dayPeriods = teachDayPeriods.get(dayKey);
        if (!dayPeriods) {
          dayPeriods = new Set();
          teachDayPeriods.set(dayKey, dayPeriods);
        }
        for (const p of blockedPeriods(card.isWerkstatt, start, card.duration)) {
          cell.add(cK(d, w, c, p));
          if (card.room) roomSet.add(rK(d, w, p, card.room));
          teachSet.add(tK(card.abbr, d, w, p));
          dayPeriods.add(p);
        }
        for (const p of teaching(card.isWerkstatt, start, card.duration)) teachClass.add(tcK(card.abbr, c, d, w, p));
        if (countTeacher) {
          teachH.set(thK(card.abbr, d, w), (teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration);
          const a = card.abbr.toLowerCase();
          const tw = teachWeek.get(a) ?? [0, 0];
          tw[w === 'u' ? 0 : 1] += card.duration;
          teachWeek.set(a, tw);
        }
        const f = card.fach.trim().toLowerCase();
        if (f) subj.set(sK(kl, d, w, f), (subj.get(sK(kl, d, w, f)) ?? 0) + card.duration);
        const mk = mirrorKey({ abbr: card.abbr, klasse: kl, fach: card.fach });
        let ms = mirrorSlots.get(mk);
        if (!ms) {
          ms = new Set();
          mirrorSlots.set(mk, ms);
        }
        ms.add(`${d}|${start}|${w}`);
      };

      /** Aktuelle Stunden der Lehrkraft in der angegebenen Woche (für den Ausgleich). */
      const teacherWeekLoad = (abbr: string, w: Week): number =>
        (teachWeek.get(abbr.toLowerCase()) ?? [0, 0])[w === 'u' ? 0 : 1];

      /** Liegt dieselbe Lehrkraft+Klasse+Fach in der ANDEREN Woche schon auf (d, start)? */
      const hasMirror = (card: Card, d: number, w: Week, start: number): boolean => {
        const other: Week = w === 'u' ? 'g' : 'u';
        return mirrorSlots.get(mirrorKey(card))?.has(`${d}|${start}|${other}`) ?? false;
      };

      // Bestehende Platzierungen als Belegung übernehmen (bleiben unangetastet).
      const seenSeedCoupling = new Set<string>();
      for (const pl of this.schedule.all) {
        let countTeacher = true;
        if (pl.coupling) {
          const key = `${pl.coupling}|${pl.day}|${pl.startPeriod}|${pl.week}`;
          if (seenSeedCoupling.has(key)) countTeacher = false;
          else seenSeedCoupling.add(key);
        }
        occupy(pl, pl.klasse, pl.classIdx, pl.day, pl.week, pl.startPeriod, countTeacher);
        if (pl.labGroup === 'b') {
          groupB.push({ c: pl.classIdx, d: pl.day, w: pl.week, start: pl.startPeriod, duration: pl.duration, isWerk: pl.isWerkstatt, klasse: pl.klasse });
        }
      }

      /** Länge des zusammenhängenden Blocks derselben Lehrkraft in dieser Klasse inkl. neuer Stunden. */
      const streak = (abbr: string, c: number, d: number, w: Week, start: number, end: number): number => {
        let run = end - start + 1;
        for (let p = start - 1; p >= 1 && teachClass.has(tcK(abbr, c, d, w, p)); p--) run++;
        for (let p = end + 1; p <= PERIODS && teachClass.has(tcK(abbr, c, d, w, p)); p++) run++;
        return run;
      };

      const check = (card: Card, c: number, d: number, w: Week, start: number, stackOnB = false): string | null => {
        const teach = teaching(card.isWerkstatt, start, card.duration);
        if (teach.length < card.duration) return 'über Stunde 9';
        const blk = blockedPeriods(card.isWerkstatt, start, card.duration);
        if (Math.max(...blk) > PERIODS) return 'über Stunde 9';
        if (!card.isWerkstatt && teach.includes(7)) return '7. Stunde frei';
        for (const p of blk) {
          if (!stackOnB && cell.has(cK(d, w, c, p))) return 'Platz belegt';
          if (card.room && roomSet.has(rK(d, w, p, card.room))) return 'Raum belegt';
          if (teachSet.has(tK(card.abbr, d, w, p))) return 'Lehrer belegt';
        }
        if ((teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration > 6) return 'Lehrer >6 Std/Tag';
        if (!card.isWerkstatt && streak(card.abbr, c, d, w, start, start + card.duration - 1) > MAX_STREAK)
          return 'max. 4 Std am Stück';
        const f = card.fach.trim().toLowerCase();
        if (isMain(card) && (subj.get(sK(card.klasse, d, w, f)) ?? 0) + card.duration > 2) return 'Hauptfach >2/Tag';
        if (f === 'lbt' && (subj.get(sK(card.klasse, d, w, f)) ?? 0) + card.duration > LBT_MAX) return 'LBT >6/Tag';
        return null;
      };

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

      const apply = (card: Card, c: number, d: number, w: Week, start: number, countTeacher = true): void => {
        occupy(card, card.klasse, c, d, w, start, countTeacher);
        assigns.push({ card, c, d, w, start });
        if (card.labGroup === 'b') {
          groupB.push({ c, d, w, start, duration: card.duration, isWerk: card.isWerkstatt, klasse: card.klasse });
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
      const placeGroup = (members: Card[], kind: 'coupling' | 'team'): void => {
        const id = kind === 'coupling' ? members[0].coupling : members[0].teamTeaching;
        const tag = kind === 'coupling' ? '⛓' : '👥';
        const what = kind === 'coupling' ? 'Kopplung' : 'Teamteaching';
        const label = `${tag} ${id} (${members.map((m) => m.abbr).join(',')})`;
        if (members.some((m) => !m.klasse.trim())) {
          skipped.push({ card: label, reason: `${what}: Klasse fehlt` });
          return;
        }
        const slots: { d: number; w: Week; cols: number[] }[] = [];
        for (let d = 0; d < DAYS.length; d++) {
          for (const w of WEEKS) {
            const cols = members.map((m) => columnFor(m, d, w));
            if (cols.every((x) => x !== null)) slots.push({ d, w, cols: cols as number[] });
          }
        }
        if (!slots.length) {
          skipped.push({ card: label, reason: `${what}: keine gemeinsame Spalte` });
          return;
        }
        if (shuffleOrder) shuffle(slots, rng);
        const starts = shuffleOrder ? shuffle([...baseStarts(members[0])], rng) : baseStarts(members[0]);
        // Team: jede Karte zählt (countTeacher=true); Kopplung: nur die erste.
        const countTeacher = (i: number): boolean => kind === 'team' || i === 0;
        for (const { d, w, cols } of slots) {
          for (const start of starts) {
            if (members.every((m, i) => check(m, cols[i], d, w, start) === null)) {
              members.forEach((m, i) => apply(m, cols[i], d, w, start, countTeacher(i)));
              return;
            }
          }
        }
        skipped.push({ card: label, reason: `${what}: kein gemeinsamer freier Slot` });
      };

      const placeNormal = (card: Card): void => {
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
        const starts = shuffleOrder ? shuffle([...baseStarts(card)], rng) : baseStarts(card);

        // Alle gültigen Plätze sammeln und nach Präferenz bewerten (kleiner = besser):
        //  1. u/g-Konstanz: gleiche Lehrkraft+Klasse+Fach in der anderen Woche am selben Slot.
        //  2. Hauptfach möglichst in den Stunden 1–6.
        //  3. Fächer-Variation (wenig gleiches Fach am Tag).
        //  4. u/g-Ausgleich (leichtere Woche der Lehrkraft).
        //  5. frühe Stunde.
        // Lexikografischer Vergleich der Score-Tupel (kleiner = besser).
        const better = (a: number[], b: number[]): boolean => {
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
          return false;
        };
        let best: { c: number; d: number; w: Week; start: number; score: number[] } | null = null;
        let reason = 'kein freier Platz';
        for (const { c, d, w } of ctx) {
          for (const start of starts) {
            const r = check(card, c, d, w, start);
            if (r !== null) {
              reason = r;
              continue;
            }
            // Hauptfach möglichst mit einem Tag Pause: Nachbartage mit gleichem Fach meiden.
            const mainAdj =
              main && ((subj.get(sK(card.klasse, d - 1, w, f)) ?? 0) > 0 || (subj.get(sK(card.klasse, d + 1, w, f)) ?? 0) > 0)
                ? 1
                : 0;
            // u/g-Differenz hat Vorrang: würde diese Platzierung die Differenz der
            // Lehrkraft über 2 treiben, wird der Slot abgewertet (vor der Parallelität).
            const loadW = teacherWeekLoad(card.abbr, w);
            const loadOther = teacherWeekLoad(card.abbr, w === 'u' ? 'g' : 'u');
            const imbalancePush = Math.max(0, Math.abs(loadW + card.duration - loadOther) - 2);
            const score = [
              imbalancePush, // u/g-Differenz ≤ 2 hat Vorrang
              main && start > 6 ? 1 : 0, // Hauptfach möglichst in den Stunden 1–6
              mainAdj, // Hauptfach: mind. ein Tag Pause – Nachbartag nur als Ausweg
              hasMirror(card, d, w, start) ? 0 : 1, // u/g-Parallelität (gleicher Slot in u/g)
              subj.get(sK(card.klasse, d, w, f)) ?? 0, // Fächer-Variation am Tag
              teacherWeekLoad(card.abbr, w), // u/g-Ausgleich
              start, // frühe Stunde
            ];
            if (!best || better(score, best.score)) best = { c, d, w, start, score };
          }
        }
        if (best) apply(card, best.c, best.d, best.w, best.start);
        else skipped.push({ card: `${card.abbr} (${card.klasse})`, reason });
      };

      const placeGroupA = (card: Card): void => {
        if (!card.klasse.trim()) {
          skipped.push({ card: card.abbr, reason: 'keine Klasse' });
          return;
        }
        const need = card.klasse.trim().toLowerCase();
        // Auf eine passende Gruppe b stapeln – aber nur einer ANDEREN Lehrkraft
        // (check() verhindert das Stapeln auf dieselbe Lehrkraft über die Belegung).
        for (const b of groupB) {
          if (b.isWerk !== card.isWerkstatt) continue;
          if (b.klasse.trim().toLowerCase() !== need) continue;
          if (b.duration !== card.duration) continue;
          if (check(card, b.c, b.d, b.w, b.start, true) === null) {
            apply(card, b.c, b.d, b.w, b.start);
            return;
          }
        }
        // Kein passender (anderer) Gruppe-b-Partner (Klasse hat nur Gruppe a, oder a+b
        // gehören derselben Lehrkraft → dürfen nicht aufeinander) → ganz normal verplanen.
        placeNormal(card);
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
      const isGrouped = (c: Card) => isA(c) || isB(c);
      const step = (list: Card[], fn: (c: Card) => void): void => {
        // Heuristik (1. Durchlauf): längere/schwerer platzierbare Blöcke zuerst.
        const seq = shuffleOrder ? shuffle([...list], rng) : [...list].sort((a, b) => b.duration - a.duration);
        for (const card of seq) fn(card);
      };
      // Reihenfolge: Werkstatt-Blöcke (Anker) → HAUPTFÄCHER (sichern sich den Morgen
      // 1–6) → Labore → Kopplungen → Teamteaching → restliche Fächer.
      step(cards.filter((c) => c.isWerkstatt && isB(c)), placeNormal);
      step(cards.filter((c) => c.isWerkstatt && isA(c)), placeGroupA);
      step(cards.filter((c) => c.isWerkstatt && !isGrouped(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && !c.isLabor && isMain(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && isB(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && isA(c)), placeGroupA);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && !isGrouped(c)), placeNormal);
      const groups = [...couplingMap.values()];
      if (shuffleOrder) shuffle(groups, rng);
      for (const members of groups) placeGroup(members, 'coupling');
      const teamGroupsList = [...teamMap.values()];
      if (shuffleOrder) shuffle(teamGroupsList, rng);
      for (const members of teamGroupsList) placeGroup(members, 'team');
      step(cards.filter((c) => !c.isWerkstatt && !c.isLabor && !isMain(c)), placeNormal);

      let openMandatory = 0;
      for (let c = 0; c < this.classes.count; c++) {
        for (let d = 0; d < DAYS.length; d++) {
          for (const w of WEEKS) {
            if (!this.classes.classNameAt(c, d, w).trim()) continue;
            for (let p = 1; p <= 6; p++) if (!cell.has(cK(d, w, c, p))) openMandatory++;
          }
        }
      }
      let imbalance = 0;
      for (const [u, g] of teachWeek.values()) imbalance += Math.max(0, Math.abs(u - g) - 2);

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
      for (const g of weekGap.values()) gaps += Math.max(0, g - 6);

      // u/g-Abweichung: je Lehrkraft+Klasse+Fach die Slots, die nur in einer Woche
      // liegen (symmetrische Differenz der u-/g-Slots). Klein = u und g sehr ähnlich.
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

      return { assigns, skipped, openMandatory, imbalance, gaps, mirrorMismatch };
    };

    // Auswahlkriterium (Priorität): meiste platzierte Karten → u/g-Stunden-Balance
    // (Differenz ≤ 2 zuerst) → beste u/g-Konstanz (gleicher Slot) → wenigste
    // Hohlstunden → wenigste offene Pflichtstunden.
    const better = (a: Outcome, b: Outcome): boolean => {
      if (a.assigns.length !== b.assigns.length) return a.assigns.length > b.assigns.length;
      if (a.imbalance !== b.imbalance) return a.imbalance < b.imbalance;
      if (a.mirrorMismatch !== b.mirrorMismatch) return a.mirrorMismatch < b.mirrorMismatch;
      if (a.gaps !== b.gaps) return a.gaps < b.gaps;
      return a.openMandatory < b.openMandatory;
    };
    // „Perfekt": alle Karten verplant, u/g-Differenz überall ≤ 2 UND keine Lehrkraft
    // mit mehr als 6 Hohlstunden pro Woche.
    const perfect = (o: Outcome): boolean => o.skipped.length === 0 && o.imbalance === 0 && o.gaps === 0;

    const rng = Math.random;
    const total = this.pool.all.length;
    const start = Date.now();
    let best = runOnce(false, rng); // 1. Durchlauf: Heuristik
    let attempts = 1;
    let stop: 'continue' | 'accept' | 'cancel' = 'continue';

    // Zyklen in Zeitscheiben (je ~40 ms), dazwischen ans Event-Loop abgeben.
    while (!perfect(best) && Date.now() - start < opts.budgetMs) {
      stop = opts.shouldStop();
      if (stop !== 'continue') break;
      const sliceStart = Date.now();
      while (Date.now() - sliceStart < 40 && !perfect(best) && Date.now() - start < opts.budgetMs) {
        const cand = runOnce(true, rng);
        attempts++;
        if (better(cand, best)) best = cand;
      }
      opts.onProgress?.({
        elapsedMs: Date.now() - start,
        attempts,
        placed: best.assigns.length,
        total,
        skipped: best.skipped.length,
        imbalance: best.imbalance,
        gaps: best.gaps,
      });
      await new Promise((r) => setTimeout(r));
    }

    if (stop === 'cancel') {
      return { placed: 0, skipped: [], openMandatory: 0, weekImbalance: [], weekGaps: [], solved: false, cancelled: true, attempts, elapsedMs: Date.now() - start };
    }

    // Bestes Ergebnis anwenden: Karten aus dem Pool in den Plan übernehmen.
    for (const a of best.assigns) {
      const card = this.pool.remove(a.card.id);
      if (!card) continue;
      this.schedule.add(new Placement(this.nextId(), card.snapshot(), { day: a.d, startPeriod: a.start, classIdx: a.c, week: a.w }));
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

  /** Lehrkräfte, deren u-/g-Stunden um mehr als 2 auseinanderliegen (für die Warnung). */
  teacherWeekImbalance(): { abbr: string; u: number; g: number }[] {
    const map = new Map<string, [number, number]>();
    for (const p of this.schedule.all) {
      const tw = map.get(p.abbr) ?? [0, 0];
      tw[p.week === 'u' ? 0 : 1] += p.duration;
      map.set(p.abbr, tw);
    }
    return [...map.entries()]
      .filter(([, [u, g]]) => Math.abs(u - g) > 2)
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
    const byDay = new Map<string, number[]>(); // kürzel|tag|woche → belegte Stunden
    for (const p of this.schedule.all) {
      const key = `${p.abbr}|${p.day}|${p.week}`;
      const arr = byDay.get(key) ?? [];
      arr.push(...this.occupiedPeriodsOf(p));
      byDay.set(key, arr);
    }
    const weekly = new Map<string, number>(); // kürzel|woche → Hohlstunden gesamt
    for (const [key, periods] of byDay) {
      const [abbr, , w] = key.split('|');
      const gap = Math.max(...periods) - Math.min(...periods) + 1 - periods.length;
      const wk = `${abbr}|${w}`;
      weekly.set(wk, (weekly.get(wk) ?? 0) + gap);
    }
    const out: { abbr: string; week: Week; gaps: number }[] = [];
    for (const [wk, gaps] of weekly) {
      if (gaps > 6) {
        const [abbr, w] = wk.split('|');
        out.push({ abbr, week: w as Week, gaps });
      }
    }
    return out.sort((a, b) => b.gaps - a.gaps);
  }

  // ── Serialisierung (Format kompatibel zur Vorgänger-App) ───────────────

  toJSON(): PersistedState {
    return {
      classes: this.classes.toPersisted(),
      cards: this.pool.all.map((c) => c.toJSON()),
      placed: this.schedule.all.map((p) => p.toJSON()),
      nid: this.nid,
      rooms: [...this.rooms],
    };
  }

  static fromJSON(raw: PersistedState): AppState {
    const pool = new CardPool();
    pool.replaceAll((raw.cards ?? []).map(Card.fromJSON));
    const schedule = new Schedule();
    schedule.replaceAll((raw.placed ?? []).map(Placement.fromJSON));
    const classes = ClassList.fromPersisted(raw.classes);
    const rooms = Array.isArray(raw.rooms) ? raw.rooms.map((r) => String(r).trim()).filter(Boolean) : [];
    return new AppState(pool, classes, schedule, raw.nid ?? 1, rooms);
  }
}
