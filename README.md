# Digitale Tafel (TypeScript)

Stundenplan-Software für Schulen: Lehrer-/Fach-Karten werden per Drag & Drop
aus einem Pool in ein Wochenraster gezogen (5 Tage × 9 Stunden, Klassen als
Spalten mit u-/g-Wochen). TypeScript-Neufassung der Single-File-Prototyp-App
(siehe [ANALYSE.md](ANALYSE.md)).

## Entwicklung

```sh
bun install      # Abhängigkeiten installieren
bun run dev      # Dev-Server (http://localhost:5173)
bun run build    # Typprüfung (tsc, strict) + Produktions-Build
```

## Architektur

Schichtenmodell mit klarer Trennung der Verantwortlichkeiten:

```
src/
├── domain/            Fachlogik – kennt kein DOM
│   ├── constants.ts   Tage, Stundenzahl, Wochentypen, Farbpalette
│   ├── types.ts       Gemeinsame Typen und Persistenzformat
│   ├── Card.ts        Pool-Karte (Lehrer/Fach-Einheit)
│   ├── Placement.ts   Platzierte Karte mit Position im Raster
│   ├── CardPool.ts    Verwaltung der unplatzierten Karten
│   ├── ClassList.ts   Spalten mit Beschriftung je Wochentag (u+g / u | g), Referenz über Index
│   ├── Schedule.ts    Stundenplan + Kollisionsprüfung
│   ├── semester.ts    Halbjahr-Logik (1./2. HJ, Überschneidungsprüfung)
│   └── AppState.ts    Aggregat-Wurzel: alle Operationen, Observer, (De-)Serialisierung
├── services/
│   └── StorageService.ts   localStorage-Persistenz (Format kompatibel zur Alt-App)
├── ui/                Darstellung & Eingabe – keine Fachlogik
│   ├── TimetableView.ts    Raster (Rendering + Event-Delegation)
│   ├── PoolView.ts         Karten-Pool in der Seitenleiste
│   ├── StatsView.ts        Stunden-Übersicht
│   ├── CardModal.ts        Karte anlegen/bearbeiten
│   ├── CommentModal.ts     Kommentar je Karte (Doppelklick auf Karte)
│   ├── CollisionModal.ts   Kollisionswarnung mit „Stapeln“-Option
│   ├── collisionMessages.ts  Formatierung der Kollisionsmeldungen
│   ├── DragController.ts   Geteilter Drag-Zustand Pool ↔ Raster
│   ├── Toast.ts / SaveBadge.ts
└── App.ts             Kompositionswurzel/Controller: verdrahtet alles
```

**Datenfluss:** UI-Komponenten melden Aktionen über Handler-Callbacks an die
`App`; die ruft Operationen auf dem `AppState` auf. Jede Änderung löst ein
Change-Event aus → `App` speichert (StorageService) und rendert alle Views neu.
Die Views lesen den Zustand direkt (nur lesend), schreiben aber nie selbst.

**Kollisionsregeln** (in `Schedule.checkSlot`):
- *Überlauf*: Karte ragt über die letzte Stunde hinaus → blockiert
- *Lehrer-Kollision*: gleiches Kürzel zeitgleich in anderer Klasse (gleiche Woche) → blockiert
- *Raum-Kollision*: gleicher Raum (sofern gesetzt) zeitgleich in anderer Klasse → blockiert
- *Klassen-Kollision*: Slot belegt → Stapeln nach Rückfrage; Labor-Karten (⚗) stapeln automatisch
- *Halbjahr*: Karten in disjunkten Halbjahren (1. vs. 2. HJ) überschneiden sich zeitlich
  nicht und kollidieren nie – sie liegen frei nebeneinander (wie Labor-Karten). Kein
  Häkchen = ganzes Jahr.
