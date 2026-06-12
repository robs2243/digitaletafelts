# Projekt-Analyse: Digitale Tafel

*Stand: 12.06.2026 – analysiert: `digitale-tafel.html` (~1.080 Zeilen), `DigitaleTafel.png`, `Layout.xlsx`*

## 1. Überblick

**Digitale Tafel** ist eine Stundenplan-Software für Schulen, umgesetzt als
**eigenständige Single-File-Webanwendung** (eine HTML-Datei mit eingebettetem CSS
und Vanilla-JavaScript). Es gibt keine Build-Tools, keine externen Bibliotheken
und keinen Server – die Datei läuft direkt im Browser.

Das Grundprinzip: Lehrer-/Fach-Karten werden in einem Seitenleisten-Pool angelegt
und per **Drag & Drop** in ein Wochenraster gezogen. Das Raster zeigt alle Klassen
nebeneinander, jede Klasse mit zwei Spalten für **ungerade (u) und gerade (g)
Wochen** (A/B-Wochen-Prinzip).

`DigitaleTafel.png` und `Layout.xlsx` sind offenbar die Design-Vorlagen: ein
Excel-Mockup mit Tagen als Zeilenblöcke (Montag–Freitag) und Klassen als Spalten.

## 2. Architektur

| Aspekt | Umsetzung |
|---|---|
| Technologie | HTML + CSS + Vanilla JS, eine Datei |
| Persistenz | `localStorage` (Schlüssel `digitale-tafel-v5`), Auto-Save bei jeder Änderung |
| Rendering | Komplettes Neu-Rendern per `innerHTML` (Funktionen `renderPool`, `renderTT`, `renderStats`) |
| Drag & Drop | Native HTML5-Drag-&-Drop-API (`dragstart`, `dragover`, `drop`) |
| State | Ein globales Objekt `S` |

### Datenmodell (Objekt `S`)

```js
S = {
  classes: string[],   // Klassennamen, Standard: "Klasse 1" … "Klasse 10"
  cards:   [...],      // Pool-Karten: {id, abbr, fach, name, duration, color, isLabor}
  placed:  [...],      // Platzierte Karten: zusätzlich {day, startPeriod, classIdx, week}
  nid:     number      // Zähler für ID-Generierung
}
```

Wichtig: Eine Karte existiert **entweder** im Pool **oder** im Plan. Beim
Platzieren wandert sie aus dem Pool ins Raster (mit neuer ID), beim Entfernen
zurück. Klassen werden über ihren **Index** referenziert (`classIdx`), nicht
über eine ID – beim Löschen einer Klasse werden die Indizes nachgezogen.

### Konstanten

- 5 Tage (Montag–Freitag), **9 Stunden pro Tag** (`PERIODS = 9`)
- 2 Wochentypen: `u` (ungerade) / `g` (gerade)
- 15 Farben in der Palette; Textfarbe wird per Luminanz-Formel automatisch gewählt

## 3. Funktionsumfang

**Karten (Lehrer/Fach)**
- Anlegen/Bearbeiten/Löschen per Modal: Kürzel (max. 5 Zeichen), Fach, Name, Dauer (1–9 Stunden am Stück), Farbe
- Auto-Vervollständigung: Bei Eingabe eines bekannten Kürzels werden Farbe, Fach, Name und Labor-Flag übernommen
- Beim Anlegen wird automatisch eine noch unbenutzte Farbe vorgeschlagen

**Stundenplan**
- Drag & Drop aus dem Pool ins Raster sowie Verschieben innerhalb des Rasters
- Mehrstündige Karten belegen per `rowspan` mehrere Zeilen
- Live-Feedback beim Ziehen: grün = frei, orange = stapelbar, rot = blockiert

**Kollisionsprüfung (`checkSlot`)** – drei Fälle:
1. **Überlauf**: Karte ragt über die 9. Stunde hinaus → blockiert
2. **Lehrer-Kollision**: Derselbe Lehrer (Kürzel) gleichzeitig in zwei Klassen (gleicher Tag + gleiche Woche) → **harte Sperre**
3. **Klassen-Kollision**: Slot in der Klasse schon belegt → **Stapeln möglich** (Bestätigungsdialog), z. B. für Gruppenteilung

**Labor-/Gruppenkarten** (`isLabor`)
- Per Checkbox markiert (⚗-Badge), stapeln **ohne Rückfrage** automatisch
- Gestapelte Karten werden als Mini-Karten übereinander angezeigt, mit Zähler-Badge (z. B. „2ד)

**Klassenverwaltung**
- Klassen hinzufügen (Header-Button + Spalten-Button), umbenennen (Inline-Input im Tabellenkopf), löschen (mit Warnung, Einträge werden mitgelöscht)

**Sonstiges**
- Stunden-Übersicht in der Sidebar: Summe der verplanten Stunden pro Kürzel
- Toast-Benachrichtigungen, „✓ Gespeichert“-Badge im Header
- Tastatur: `Escape` schließt Modals, `Enter` speichert im Karten-Modal
- XSS-Schutz: Nutzereingaben werden vor dem Einfügen ins HTML escaped (`esc()`)

## 4. Code-Qualität

**Positiv**
- Klar gegliedert (Abschnitts-Kommentare), konsistente Namensgebung, `'use strict'`
- Saubere Trennung: State → reine Render-Funktionen → Event-Handler
- Konsequentes Escaping von Nutzereingaben
- Durchdachtes UX-Detail: Farbkontrast-Berechnung, Drop-Vorschau, Auto-Fill

**Architektur-Grenzen**
- Komplettes Re-Rendern bei jeder Änderung – bei der aktuellen Größe unproblematisch, skaliert aber schlecht bei sehr vielen Klassen
- Inline-Event-Handler (`onclick="..."` in Template-Strings) erschweren spätere Modularisierung
- Alles global in einer Datei – bei weiterem Wachstum wäre eine Aufteilung (z. B. ES-Module) sinnvoll

## 5. Auffälligkeiten & potenzielle Probleme

1. **Keine Touch-Unterstützung** – die native HTML5-Drag-&-Drop-API funktioniert auf
   Touch-Geräten (Tablets, interaktive Whiteboards!) nicht. Für eine „digitale Tafel“
   ist das vermutlich die wichtigste Lücke. Lösung: Umstieg auf Pointer-Events oder
   eine kleine Eigenimplementierung.
2. **Datenverlust-Risiko**: Nur `localStorage` – Browserdaten löschen, anderes Gerät
   oder anderer Browser = Plan weg. Es gibt keinen Export/Import (z. B. JSON-Datei).
3. **Kein Druck/Export**: Für den Schulalltag fehlt eine Druckansicht bzw. PDF-Export
   (auch pro Klasse / pro Lehrer).
4. **Rendering-Lücke beim Stapeln mit versetztem Start**: `renderTT` gruppiert
   Stapel nur über die exakte Startstunde (`stackAt`-Schlüssel). Wird eine Karte
   in eine Stunde gestapelt, die bereits von einer **früher beginnenden** Karte
   per `rowspan` überdeckt ist, wird sie nicht angezeigt (die Zelle ist `blocked`).
   Die Daten bleiben korrekt, nur die Anzeige fehlt.
5. **Stunden-Statistik zählt u- und g-Wochen einfach zusammen**: Eine Karte nur in
   u-Wochen zählt gleich viel wie ein Eintrag, der jede Woche stattfindet. Klären,
   ob z. B. „Durchschnitt pro Woche“ (u+g geteilt durch 2) gemeint ist.
6. **Diskrepanz zur Vorlage**: `Layout.xlsx`/PNG zeigen **6 Stunden pro Tag**, die
   App implementiert **9** (`PERIODS = 9`). Falls 6 gewünscht: eine Konstante ändern.
7. **Schema-Migration**: `load()` macht `Object.assign(S, JSON.parse(raw))` ohne
   Validierung – bei künftigen Datenmodell-Änderungen können alte gespeicherte
   Stände inkonsistent werden (der Key `…-v5` deutet an, dass das bereits per
   Versionierung gelöst wird, alte Daten gehen dann aber verloren).
8. **Kein Undo**: Versehentliches Löschen einer Klasse entfernt alle Einträge
   unwiderruflich (nur `confirm()`-Abfrage als Schutz).
9. **Uneinheitliche Dialoge**: Mischung aus nativen `confirm()`-Dialogen und
   eigenen, schön gestalteten Modals.

## 6. Mögliche nächste Schritte (Vorschläge)

Priorisiert nach Nutzen für den Schulalltag:

1. **JSON-Export/-Import** (geringer Aufwand, beseitigt das Datenverlust-Risiko)
2. **Druckansicht / PDF-Export** (Gesamtplan, pro Klasse, pro Lehrer)
3. **Touch-Drag-&-Drop** für Tablets/Whiteboards
4. Statistik präzisieren (Stunden getrennt nach u/g bzw. Wochenmittel)
5. Stapel-Rendering für versetzte Startstunden korrigieren
6. Undo (mindestens für „Klasse löschen“)
7. Optional: Stundenzahl pro Tag konfigurierbar machen (aktuell fix 9)
