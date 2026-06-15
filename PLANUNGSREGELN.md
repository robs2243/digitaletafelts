# Planungsregeln (Auto-Verplanen)

Diese Regeln müssen beim automatischen Verplanen der Karten beachtet werden.
Quelle: Vorgaben des Anwenders.

## Harte Regeln

1. **Klassen-Mindestbelegung:** Jede Klasse hat an jedem ihrer Tage mindestens
   **6 Stunden** Unterricht – die **Stunden 1–6 sind Pflicht** (müssen belegt sein).
2. **Lehrer-Maximum:** Eine Lehrkraft hat **maximal 6 Stunden Unterricht pro Tag**.
   Lässt sich das nicht einhalten → **den Anwender fragen** (nicht stillschweigend
   verletzen).
3. **Höchstens 4 Stunden am Stück:** Dieselbe Lehrkraft soll in einer Klasse
   **nicht mehr als 4 Stunden am Stück** unterrichten (keine 5–6 Stunden in Folge).
   **Ausnahme: Werkstatt** (darf 4–8 Stunden am Stück sein).
4. **7. Stunde frei:** In der 7. Stunde findet **kein regulärer Unterricht** statt
   (Ausnahme: Werkstatt, siehe unten).
5. **Klassen-Tag-Zuordnung:** Welche Klasse an welchem Tag (und ob u-/g-Woche)
   unterrichtet wird, **gibt der Anwender vor** (über die Tages-Beschriftung der
   Spalten: u+g-Feld bzw. getrennte u-/g-Felder).
6. **Fixierte Karten:** Von Hand gezogene und **mit dem Schloss fixierte** Karten
   werden **nie verschoben** – der Planer arbeitet nur um sie herum.

## Fächer-Verteilung

7. **Hauptfächer** (Karten-Checkbox „⭐ Hauptfach" oder Fach **D, M, E, Gk, Wk**):
   beim Planen **bevorzugt** und **möglichst in den Stunden 1–6**. Am **gleichen Tag
   höchstens 2 Stunden** (pro Klasse), möglichst mit **einem Tag Pause dazwischen**.
8. **Fächer variieren:** Über den Tag sollen die Fächer **abwechseln** (nicht das
   gleiche Fach häufen) – der Planer verteilt gleiche Fächer möglichst auf
   unterschiedliche Tage.
9. **LBT:** am **gleichen Tag höchstens 6 Stunden** „LBT" (pro Klasse).
10. **u/g-Konstanz:** Hat eine Lehrkraft **mehrere Karten desselben Fachs in einer
    Klasse**, sollen u- und g-Woche **möglichst an derselben Stelle** (gleicher Tag +
    gleiche Stunde) liegen. Geht es nicht auf (ungerade Gesamtzahl), hat eine Woche
    eben mehr Stunden (z. B. u 6 / g 4).

## Wochen-Ausgleich (u/g)

11. Die Stunden einer Lehrkraft sollen zwischen **u-Woche und g-Woche ausgeglichen**
    sein. Die **Differenz darf höchstens 2 Stunden** betragen. Liegt sie höher,
    **erscheint eine Meldung** (Hinweis zum Ausgleichen von Hand).
12. **Hohlstunden:** Eine Lehrkraft soll **pro Woche höchstens 6 Hohlstunden**
    (Freistunden zwischen erster und letzter Unterrichtsstunde, über die Tage summiert)
    haben. Wird das überschritten, **erscheint eine Meldung**.

## Werkstatt

13. Werkstatt darf **4–8 Stunden am Stück** sein.
14. Bei Werkstatt liegt die **Pause immer in der 5. Stunde** (Stunde 5 bleibt frei).
15. Werkstatt darf **auch in der 7. Stunde** stattfinden.
16. Werkstätten gibt es **immer als Gruppe a und Gruppe b**. Eine Werkstatt der
    **Gruppe a** muss immer auf eine Werkstatt der **Gruppe b** gelegt werden
    (gestapelt, gleicher Slot) – analog zu den Laboren.

## Labore

17. Labore gibt es immer als **Gruppe a** und **Gruppe b**.
18. Ein Labor der **Gruppe a** muss immer auf ein Labor der **Gruppe b** gelegt
    werden (gestapelt). Das **Fach muss nicht übereinstimmen**.

## Gruppen a/b – Ausnahmen (Labor & Werkstatt)

19. **Nur eine Gruppe vorhanden:** Gibt es zu einer Gruppe-a-Karte **keinen passenden
    Gruppe-b-Partner** (manche Klassen haben nur Gruppe a), wird die **Gruppe-a-Karte
    einfach normal verplant** – kein Stapeln, kein Überspringen.
20. **Gleiche Lehrkraft für a und b:** Wenn **dieselbe Lehrkraft** Gruppe a *und* b
    hat, dürfen diese **nicht aufeinander** liegen (sie kann nicht gleichzeitig an
    beiden Gruppen sein). Sie werden dann zu **verschiedenen Zeiten** verplant.
    Gestapelt wird nur, wenn die Gruppe b von einer **anderen Lehrkraft** kommt.

## Entscheidungen zur Umsetzung

- **Labor-Gruppe a/b:** eigenes Feld an der Karte (Gruppe a / b). Der Planer legt
  ein Labor der Gruppe a auf ein Labor der Gruppe b einer **anderen Lehrkraft**
  (gleicher Slot). Gibt es keinen solchen Partner (nur Gruppe a vorhanden, oder a+b
  derselben Lehrkraft), wird die Gruppe-a-Karte **normal verplant** (siehe Regeln 18/19).
- **Werkstatt:** eine Karte mit Dauer; der Planer lässt Stunde 5 automatisch frei
  und darf die 7. Stunde nutzen. Die **Gruppe a/b** wird wie bei Laboren gestapelt
  (Werkstatt a auf Werkstatt b, gleicher Slot).
- **Wenn 1–6 nicht voll füllbar:** so weit wie möglich verplanen, offene Slots frei
  lassen und am Ende auflisten, was unbelegt blieb (Lehrer >6 Std → Hinweis/fragen).
- **Mehrere Durchläufe (Zyklen):** Der Planer probiert **sehr viele Durchläufe** mit
  variierter Reihenfolge und variierten Startstunden (der erste Durchlauf nutzt eine
  Heuristik: längere Blöcke zuerst). Er läuft so lange, **bis eine vollständige Lösung
  gefunden ist** – alle Karten verplant, u/g-Differenz jeder Lehrkraft ≤ 2 **und**
  keine Lehrkraft mit mehr als 6 Hohlstunden/Woche – oder das **Zeitbudget (bis zu
  10 Minuten)** erreicht ist. Die Suche läuft asynchron; ein Fortschritts-Fenster zeigt
  Zeit/Versuche/beste Lösung und erlaubt **Abbrechen** oder **bestes Ergebnis vorzeitig
  übernehmen**.
- **Keine Lösung gefunden:** Wird im Zeitbudget keine vollständige Lösung gefunden,
  wird das **beste** Ergebnis übernommen und eine **Meldung** mit den offenen Punkten
  (nicht platzierbare Karten, u/g-Differenzen, zu viele Hohlstunden) ausgegeben.
- **Fixierte Karten:** werden nie verschoben; der Planer plant nur die freien
  Pool-Karten um sie herum.
- **4 Stunden am Stück:** zusammenhängende Stunden derselben Lehrkraft in einer
  Klasse werden gezählt (inkl. angrenzender Blöcke); >4 ist nur bei Werkstatt erlaubt.
- **Fächer-Variation:** gleiche Fächer werden bevorzugt auf unterschiedliche Tage
  verteilt.
- **Hauptfach:** Karten-Checkbox „⭐ Hauptfach" (oder Excel-Spalte „Hauptfach") bzw.
  Fach D/M/E/Gk/Wk. Solche Karten werden **zuerst** verplant, bevorzugt in die Stunden
  **1–6** gelegt (8. nur als Ausweichplatz) und möglichst **mit einem Tag Pause** zum
  selben Hauptfach (Nachbartage mit gleichem Fach werden gemieden).
- **u/g-Konstanz (hohe Priorität):** Bei der Platzwahl bevorzugt der Planer Slots, an
  denen dieselbe Lehrkraft+Klasse+Fach in der anderen Woche bereits liegt; zusätzlich
  fließt die **u/g-Ähnlichkeit in die Bewertung des besten Durchlaufs** ein (direkt
  nach „meiste Karten verplant"). Ziel: u- und g-Stundenplan möglichst gleich. Geht es
  nicht auf, bleibt eine Woche mit mehr Stunden (z. B. u 6 / g 4).
- **u/g-Ausgleich:** der Planer bevorzugt beim Verplanen die für die Lehrkraft
  „leichtere" Woche und **rechnet mehrere Zyklen, bis die u/g-Differenz aller
  Lehrkräfte ≤ 2 Stunden** ist (Teil der „vollständigen Lösung"). Bleibt die Differenz
  am Ende des Zeitbudgets > 2 Stunden, wird die Lehrkraft in einer Meldung aufgeführt
  (harte Sperre wäre zu streng, daher Hinweis statt Verbot).
- **Hohlstunden:** je Lehrkraft und Woche werden die Freistunden zwischen erster und
  letzter belegter Stunde (über die Tage summiert) gezählt; der Planer optimiert auf
  ≤ 6 und meldet Überschreitungen.
- **Block-/Sperrkarten („Nicht zählen"):** Karten mit aktivierter Checkbox „Nicht
  zählen" (bzw. Excel-Spalte „Nicht zählen") **fließen nicht in die Stunden-/
  Werterechnung** ein. Sie eignen sich z. B., um mit einem Kürzel Felder zu blockieren
  (Lehrkraft kann dort nicht unterrichten), ohne das Deputat zu erhöhen. Solche Karten
  dürfen frei gestapelt werden.
- **Kopplung (gleiche Lehrkraft, mehrere Klassen gleichzeitig):** Karten mit gleicher
  **Kopplungs-ID** (Feld „Kopplung" / Excel-Spalte „Kopplung", z. B. „K1") dürfen sich
  **zeitlich überschneiden** (gleiche Lehrkraft, andere Klasse, ggf. gleicher Raum) und
  **zählen nur einmal** im Deputat. Anwendung: zwei Klassen sind z. B. in Deutsch
  zusammengelegt – je eine Karte pro Klasse mit derselben Kopplungs-ID anlegen.
  - **Automatisches Verplanen:** Gekoppelte Karten werden als **Gruppe gemeinsam** auf
    denselben Slot gelegt (jede in ihrer Klassenspalte, gleiche Startstunde). Findet
    sich kein gemeinsamer freier Slot, bleibt die Gruppe offen und wird gemeldet.
  - **Manuell:** Beim Ziehen/Entplanen einer gekoppelten Karte wandern die Partner mit.
- **Hauptfächer-Erkennung:** über das Feld „Fach" der Karte (Abgleich mit Liste
  D, M, E, Gk, Wk). **LBT** wird ebenfalls über das Feld „Fach" erkannt (max. 6/Tag).
