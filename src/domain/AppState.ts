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
   * – Lehrer max. 6 Std/Tag, max. 4 Std am Stück je Klasse (außer Werkstatt).
   * – Hauptfächer (D/M/E/Gk/Wk) max. 2 Std/Tag, LBT max. 6 Std/Tag, Fächer variieren.
   * – Werkstatt als Block, Stunde 5 bleibt Pause, 7. Stunde erlaubt.
   * – Gruppe a wird auf eine bereits liegende Gruppe b gelegt (Labor und Werkstatt).
   * Es werden mehrere Durchläufe mit variierter Reihenfolge probiert; das beste
   * Ergebnis wird übernommen. Bereits platzierte (auch fixierte) Karten bleiben
   * unangetastet.
   */
  autoPlan(): AutoPlanResult {
    const MAIN = new Set(['d', 'm', 'e', 'gk', 'wk']);
    const MAX_STREAK = 4; // max. Stunden am Stück derselben Lehrkraft in einer Klasse (außer Werkstatt)
    const LBT_MAX = 6; // max. Stunden „LBT" je Klasse und Tag

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
      const subj = new Map<string, number>(); // klasse|d|w|fach → Stunden (alle Fächer)
      const groupB: { c: number; d: number; w: Week; start: number; duration: number; isWerk: boolean; klasse: string }[] = [];
      const assigns: Assign[] = [];
      const skipped: { card: string; reason: string }[] = [];

      const occupy = (card: Place, kl: string, c: number, d: number, w: Week, start: number): void => {
        for (const p of blockedPeriods(card.isWerkstatt, start, card.duration)) {
          cell.add(cK(d, w, c, p));
          if (card.room) roomSet.add(rK(d, w, p, card.room));
          teachSet.add(tK(card.abbr, d, w, p));
        }
        for (const p of teaching(card.isWerkstatt, start, card.duration)) teachClass.add(tcK(card.abbr, c, d, w, p));
        teachH.set(thK(card.abbr, d, w), (teachH.get(thK(card.abbr, d, w)) ?? 0) + card.duration);
        const a = card.abbr.toLowerCase();
        const tw = teachWeek.get(a) ?? [0, 0];
        tw[w === 'u' ? 0 : 1] += card.duration;
        teachWeek.set(a, tw);
        const f = card.fach.trim().toLowerCase();
        if (f) subj.set(sK(kl, d, w, f), (subj.get(sK(kl, d, w, f)) ?? 0) + card.duration);
      };

      /** Aktuelle Stunden der Lehrkraft in der angegebenen Woche (für den Ausgleich). */
      const teacherWeekLoad = (abbr: string, w: Week): number =>
        (teachWeek.get(abbr.toLowerCase()) ?? [0, 0])[w === 'u' ? 0 : 1];

      // Bestehende Platzierungen als Belegung übernehmen (bleiben unangetastet).
      for (const pl of this.schedule.all) {
        occupy(pl, pl.klasse, pl.classIdx, pl.day, pl.week, pl.startPeriod);
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
        if (MAIN.has(f) && (subj.get(sK(card.klasse, d, w, f)) ?? 0) + card.duration > 2) return 'Hauptfach >2/Tag';
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

      const apply = (card: Card, c: number, d: number, w: Week, start: number): void => {
        occupy(card, card.klasse, c, d, w, start);
        assigns.push({ card, c, d, w, start });
        if (card.labGroup === 'b') {
          groupB.push({ c, d, w, start, duration: card.duration, isWerk: card.isWerkstatt, klasse: card.klasse });
        }
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
        // Sortier-Präferenz: Fächer-Variation (wenig gleiches Fach am Tag), danach
        // u/g-Ausgleich (die für die Lehrkraft leichtere Woche zuerst). Gleichstände ggf. zufällig.
        const f = card.fach.trim().toLowerCase();
        if (shuffleOrder) shuffle(ctx, rng);
        ctx.sort(
          (a, b) =>
            (subj.get(sK(card.klasse, a.d, a.w, f)) ?? 0) - (subj.get(sK(card.klasse, b.d, b.w, f)) ?? 0) ||
            teacherWeekLoad(card.abbr, a.w) - teacherWeekLoad(card.abbr, b.w),
        );
        const starts = shuffleOrder ? shuffle([...baseStarts(card)], rng) : baseStarts(card);
        let reason = 'kein freier Platz';
        for (const { c, d, w } of ctx) {
          for (const start of starts) {
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

      const placeGroupA = (card: Card): void => {
        if (!card.klasse.trim()) {
          skipped.push({ card: card.abbr, reason: 'keine Klasse' });
          return;
        }
        const need = card.klasse.trim().toLowerCase();
        for (const b of groupB) {
          if (b.isWerk !== card.isWerkstatt) continue;
          if (b.klasse.trim().toLowerCase() !== need) continue;
          if (b.duration !== card.duration) continue;
          if (check(card, b.c, b.d, b.w, b.start, true) === null) {
            apply(card, b.c, b.d, b.w, b.start);
            return;
          }
        }
        const what = card.isWerkstatt ? 'Werkstatt b' : 'Labor b';
        skipped.push({ card: `${card.abbr} (${card.klasse})`, reason: `kein passendes ${what}` });
      };

      // Reihenfolge: Gruppe b (Anker) vor Gruppe a; Werkstätten vor Laboren, dann Rest.
      const cards = [...this.pool.all];
      const isA = (c: Card) => c.labGroup === 'a';
      const isB = (c: Card) => c.labGroup === 'b';
      const isGrouped = (c: Card) => isA(c) || isB(c);
      const fach = (c: Card) => c.fach.trim().toLowerCase();
      const step = (list: Card[], fn: (c: Card) => void): void => {
        // Heuristik (1. Durchlauf): längere/schwerer platzierbare Blöcke zuerst.
        const seq = shuffleOrder ? shuffle([...list], rng) : [...list].sort((a, b) => b.duration - a.duration);
        for (const card of seq) fn(card);
      };
      step(cards.filter((c) => c.isWerkstatt && isB(c)), placeNormal);
      step(cards.filter((c) => c.isWerkstatt && isA(c)), placeGroupA);
      step(cards.filter((c) => c.isWerkstatt && !isGrouped(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && isB(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && isA(c)), placeGroupA);
      step(cards.filter((c) => !c.isWerkstatt && c.isLabor && !isGrouped(c)), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && !c.isLabor && MAIN.has(fach(c))), placeNormal);
      step(cards.filter((c) => !c.isWerkstatt && !c.isLabor && !MAIN.has(fach(c))), placeNormal);

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
      return { assigns, skipped, openMandatory, imbalance };
    };

    // Mehrere Durchläufe: ersten deterministisch (Heuristik), weitere mit variierter
    // Reihenfolge/Startstunden. Es wird so lange probiert, bis alle Karten verplant
    // sind ODER das Zeit-/Versuchsbudget erschöpft ist. Bestes Ergebnis = meiste
    // platzierte Karten, dann beste u/g-Balance, dann wenigste offene Pflichtstunden.
    const better = (a: Outcome, b: Outcome): boolean => {
      if (a.assigns.length !== b.assigns.length) return a.assigns.length > b.assigns.length;
      if (a.imbalance !== b.imbalance) return a.imbalance < b.imbalance;
      return a.openMandatory < b.openMandatory;
    };
    const rng = Math.random;
    let best = runOnce(false, rng);
    const MAX_ATTEMPTS = 20000;
    const deadline = Date.now() + 4000; // hartes Zeitbudget, damit die UI nicht hängt
    for (let i = 1; i < MAX_ATTEMPTS && best.skipped.length > 0; i++) {
      const cand = runOnce(true, rng);
      if (better(cand, best)) best = cand;
      if (i % 64 === 0 && Date.now() > deadline) break;
    }

    // Bestes Ergebnis anwenden: Karten aus dem Pool in den Plan übernehmen.
    for (const a of best.assigns) {
      const card = this.pool.remove(a.card.id);
      if (!card) continue;
      this.schedule.add(new Placement(this.nextId(), card.snapshot(), { day: a.d, startPeriod: a.start, classIdx: a.c, week: a.w }));
    }
    this.emit();

    // u/g-Ausgleich prüfen: Lehrkräfte mit Differenz > 2 Stunden melden.
    const weekImbalance = this.teacherWeekImbalance();
    return { placed: best.assigns.length, skipped: best.skipped, openMandatory: best.openMandatory, weekImbalance };
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
