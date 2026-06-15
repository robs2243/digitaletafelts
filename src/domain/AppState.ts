import { Card } from './Card';
import { CardPool } from './CardPool';
import { ClassList } from './ClassList';
import { DAYS, PALETTE, PERIODS, WEEKS } from './constants';
import { Placement } from './Placement';
import { Schedule } from './Schedule';
import { semesterFactor } from './semester';
import type { AutoPlanResult, CardProps, LabelField, PersistedState, PlacementPosition, StatRow, Week } from './types';

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

  /** Anzahl platzierter Karten gesamt. */
  get totalPlacedCount(): number {
    return this.schedule.all.length;
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

  // ── Automatisches Verplanen ─────────────────────────────────────────────

  /**
   * Verteilt die Pool-Karten greedy nach den Planungsregeln (PLANUNGSREGELN.md):
   * – Karte nur in eine Spalte, deren Klassenname passt.
   * – 7. Stunde frei (außer Werkstatt), Pflichtbereich 1–6 wird zuerst gefüllt.
   * – Lehrer max. 6 Std/Tag (sonst übersprungen + Hinweis).
   * – Hauptfächer (D/M/E/Gk/Wk) max. 2 Std je Klasse und Tag, möglichst verteilt.
   * – Werkstatt als Block, Stunde 5 bleibt Pause, 7. Stunde erlaubt.
   * – Labor-Gruppe a wird auf eine bereits liegende Gruppe b gelegt.
   * Bereits platzierte (ggf. fixierte) Karten bleiben unangetastet.
   */
  autoPlan(): AutoPlanResult {
    const MAIN = new Set(['d', 'm', 'e', 'gk', 'wk']);
    const skipped: { card: string; reason: string }[] = [];
    let placed = 0;

    const cell = new Set<string>(); // belegte Klassenzelle: d|w|c|p
    const roomSet = new Set<string>(); // belegter Raum: d|w|p|raum
    const teachSet = new Set<string>(); // Lehrer belegt: kürzel|d|w|p
    const teachH = new Map<string, number>(); // kürzel|d|w → Stunden
    const subjH = new Map<string, number>(); // klasse|d|w|fach → Stunden (Hauptfächer)
    const bLabs: { c: number; d: number; w: Week; start: number; periods: number[]; klasse: string }[] = [];

    const cK = (d: number, w: Week, c: number, p: number) => `${d}|${w}|${c}|${p}`;
    const rK = (d: number, w: Week, p: number, room: string) => `${d}|${w}|${p}|${room.toLowerCase()}`;
    const tK = (abbr: string, d: number, w: Week, p: number) => `${abbr.toLowerCase()}|${d}|${w}|${p}`;
    const thK = (abbr: string, d: number, w: Week) => `${abbr.toLowerCase()}|${d}|${w}`;
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

    type Place = { abbr: string; room: string; duration: number; isWerkstatt: boolean; fach: string };
    const occupy = (card: Place, kl: string, c: number, d: number, w: Week, start: number): void => {
      for (const p of blockedPeriods(card.isWerkstatt, start, card.duration)) {
        cell.add(cK(d, w, c, p));
        if (card.room) roomSet.add(rK(d, w, p, card.room));
        teachSet.add(tK(card.abbr, d, w, p));
      }
      teachH.set(thK(card.abbr, d, w), (teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration);
      if (MAIN.has(card.fach.trim().toLowerCase())) {
        subjH.set(sK(kl, d, w, card.fach), (subjH.get(sK(kl, d, w, card.fach)) ?? 0) + card.duration);
      }
    };

    // Bestehende (manuelle/fixierte) Platzierungen als Belegung übernehmen.
    for (const pl of this.schedule.all) {
      occupy(pl, pl.klasse, pl.classIdx, pl.day, pl.week, pl.startPeriod);
      if (pl.isLabor && pl.labGroup === 'b') {
        bLabs.push({
          c: pl.classIdx,
          d: pl.day,
          w: pl.week,
          start: pl.startPeriod,
          periods: teaching(pl.isWerkstatt, pl.startPeriod, pl.duration),
          klasse: pl.klasse,
        });
      }
    }

    /** Prüft, ob die Karte an (c,d,w,start) liegen darf. */
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
      if (MAIN.has(card.fach.trim().toLowerCase()) && (subjH.get(sK(card.klasse, d, w, card.fach)) ?? 0) + card.duration > 2)
        return 'Hauptfach >2/Tag';
      return null;
    };

    /** Alle (Spalte, Tag, Woche), deren Klassenname zur Karte passt. */
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

    const apply = (card: Card, c: number, d: number, w: Week, start: number): void => {
      this.pool.remove(card.id);
      this.schedule.add(new Placement(this.nextId(), card.snapshot(), { day: d, startPeriod: start, classIdx: c, week: w }));
      occupy(card, card.klasse, c, d, w, start);
      placed++;
      if (card.isLabor && card.labGroup === 'b') {
        bLabs.push({ c, d, w, start, periods: teaching(card.isWerkstatt, start, card.duration), klasse: card.klasse });
      }
    };

    // Startstunden: Werkstatt blockt von der 1. an, sonst Pflichtbereich zuerst, dann 8.
    const startsFor = (card: Card): number[] => (card.isWerkstatt ? [1] : [1, 2, 3, 4, 5, 6, 8]);

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
      // Hauptfächer über die Tage verteilen: Kontexte mit wenig gleichem Fach zuerst.
      ctx.sort((a, b) => (subjH.get(sK(card.klasse, a.d, a.w, card.fach)) ?? 0) - (subjH.get(sK(card.klasse, b.d, b.w, card.fach)) ?? 0));
      let reason = 'kein freier Platz';
      for (const { c, d, w } of ctx) {
        for (const start of startsFor(card)) {
          const r = check(card, c, d, w, start);
          if (r === null) {
            apply(card, c, d, w, start);
            return;
          }
          reason = r;
        }
      }
      skipped.push({ card: `${card.abbr} (${card.klasse})`, reason });
    };

    const placeLabA = (card: Card): void => {
      if (!card.klasse.trim()) {
        skipped.push({ card: card.abbr, reason: 'keine Klasse' });
        return;
      }
      const need = card.klasse.trim().toLowerCase();
      for (const b of bLabs) {
        if (b.klasse.trim().toLowerCase() !== need) continue;
        if (b.periods.length !== card.duration) continue; // gleiche Länge wie Gruppe b
        if (check(card, b.c, b.d, b.w, b.start, true) === null) {
          apply(card, b.c, b.d, b.w, b.start);
          return;
        }
      }
      skipped.push({ card: `${card.abbr} (${card.klasse})`, reason: 'kein passendes Labor b' });
    };

    // Reihenfolge: Werkstatt → Labor b → Labor a → übrige Labore → Hauptfächer → Rest.
    const cards = [...this.pool.all];
    const isLabA = (c: Card) => c.isLabor && c.labGroup === 'a';
    const isLabB = (c: Card) => c.isLabor && c.labGroup === 'b';
    const order = [
      cards.filter((c) => c.isWerkstatt),
      cards.filter((c) => isLabB(c) && !c.isWerkstatt),
      cards.filter((c) => isLabA(c) && !c.isWerkstatt),
      cards.filter((c) => c.isLabor && !c.labGroup && !c.isWerkstatt),
      cards.filter((c) => !c.isLabor && !c.isWerkstatt && MAIN.has(c.fach.trim().toLowerCase())),
      cards.filter((c) => !c.isLabor && !c.isWerkstatt && !MAIN.has(c.fach.trim().toLowerCase())),
    ];
    for (const card of order[0]) placeNormal(card);
    for (const card of order[1]) placeNormal(card);
    for (const card of order[2]) placeLabA(card);
    for (const card of order[3]) placeNormal(card);
    for (const card of order[4]) placeNormal(card);
    for (const card of order[5]) placeNormal(card);

    // Offene Pflichtstunden (1–6) je vorhandener Klassen-Spalte zählen.
    let openMandatory = 0;
    for (let c = 0; c < this.classes.count; c++) {
      for (let d = 0; d < DAYS.length; d++) {
        for (const w of WEEKS) {
          if (!this.classes.classNameAt(c, d, w).trim()) continue;
          for (let p = 1; p <= 6; p++) if (!cell.has(cK(d, w, c, p))) openMandatory++;
        }
      }
    }

    this.emit();
    return { placed, skipped, openMandatory };
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
