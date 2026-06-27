# Planungsregeln (Auto-Verplanen)

Diese Regeln müssen beim automatischen Verplanen der Karten beachtet werden.
Quelle: Vorgaben des Anwenders.

## Harte Regeln

1. **Klassen-Mindestbelegung:** Jede Klasse hat an jedem ihrer Tage mindestens
   **6 Stunden** Unterricht – die **Stunden 1–6 sind Pflicht** (müssen belegt sein).
2. **Lehrer-Maximum:** Eine Lehrkraft hat **maximal 6 Stunden Unterricht pro Tag** –
   **AUSNAHME: bei Werkstatt oder Labor an dem Tag sind bis zu 8 Stunden erlaubt**
   (lange Block-Tage). Lässt sich das nicht einhalten → **den Anwender fragen** (nicht
   stillschweigend verletzen).
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

7. **Hauptfächer** – **NUR** Karten mit gesetztem „⭐ Hauptfach" (Excel-Spalte „Hauptfach" = `x`).
   **Keine** automatische Erkennung mehr über den Fachnamen (D/M/E/Gk/Wk zählen ohne `x` nicht
   als Hauptfach). Hauptfächer werden beim Planen **bevorzugt** und **möglichst in den Stunden
   1–6**. Am **gleichen Tag höchstens 2 Stunden** (pro Klasse), möglichst mit **einem Tag Pause
   dazwischen**.
8. **Fächer variieren:** Über den Tag sollen die Fächer **abwechseln** (nicht das
   gleiche Fach häufen) – der Planer verteilt gleiche Fächer möglichst auf
   unterschiedliche Tage.
9. **LBT:** am **gleichen Tag höchstens 6 Stunden** „LBT" (pro Klasse).
10. **u/g-Konstanz:** Hat eine Lehrkraft **mehrere Karten desselben Fachs in einer
    Klasse**, sollen u- und g-Woche **möglichst an derselben Stelle** (gleicher Tag +
    gleiche Stunde) liegen. Geht es nicht auf (ungerade Gesamtzahl), hat eine Woche
    eben mehr Stunden (z. B. u 6 / g 4).

## Wochenmodell (u/g)

10a. **Eine Karte = eine Stunde in EINER Woche.** Es gibt **keinen** Turnus mehr.
    Jede Stunde liegt entweder in der u- oder der g-Woche – beim **automatischen
    Verplanen wählt der Planer** die Woche selbst (nach u/g-Ausgleich), beim **Ziehen**
    bestimmt die Spalte (u oder g), in die abgelegt wird. u- und g-Woche dürfen sich
    unterscheiden; es wird **nicht** automatisch gespiegelt.
10b. Soll eine Stunde **jede Woche** stattfinden, wird sie als **zwei** Karten
    angelegt (eine für u, eine für g) bzw. in beide Wochen-Spalten gelegt.
10c. **u/g möglichst parallel (wichtigstes Ziel):** Der Planer legt so viele Stunden
    wie möglich **parallel** – gleiche Lehrkraft+Klasse+Fach am **selben Tag + derselben
    Stunde in u UND g**. Aus mehreren gleichartigen Karten bildet er **Paare** (ein
    u- + ein g-Slot an derselben Stelle); eine **ungerade** Stunde bleibt einzeln in u
    oder g (wo es besser passt). Bei vollständiger Planung darf ein solcher Block
    aufgerissen werden, wenn sonst nicht alle Stunden unterzubringen sind.

## Wochen-Ausgleich (u/g)

11. Die Stunden einer Lehrkraft sollen zwischen **u-Woche und g-Woche ausgeglichen**
    sein. Die **Differenz darf höchstens 2 Stunden** betragen. Liegt sie höher,
    **erscheint eine Meldung** (Hinweis zum Ausgleichen von Hand).
12. **Hohlstunden:** Eine Lehrkraft soll **pro Woche höchstens 6 Hohlstunden**
    (Freistunden zwischen erster und letzter Unterrichtsstunde, über die Tage summiert)
    haben. Wird das überschritten, **erscheint eine Meldung**.

## Werkstatt

12b. **Eine Karte mit „W-…"-Raum ist IMMER eine Werkstatt** – auch wenn das Werkstatt-
    Kennzeichen nicht gesetzt ist. Der Raum (z. B. `W-Fk`) genügt; sie wird dann mit
    Pause in der 5. Stunde und im Raster 1.–4./6.–9. verplant (nie auf Stunde 5).
13. Werkstatt ist **immer mindestens 4 Stunden** und darf bis **8 Stunden am Stück**
    gehen. **Es gibt KEINE 2-Stunden-Werkstatt.** Der Planer bündelt die 2h-Karten zu
    Blöcken à 4h (2 Karten); bei ungerader Kartenzahl entsteht **ein** 6h-Block (3 Karten),
    nie ein einzelner 2h-Block. Werkstatt wird nie in einzelne 2h-Stücke zerlegt.
14. Bei Werkstatt liegt die **Pause immer in der 5. Stunde** (Stunde 5 bleibt frei).
15. Werkstatt darf **auch in der 7. Stunde** stattfinden.
15a. **Nachmittag bevorzugt, gepaarte Werkstätten als 4h-Block gestapelt:** Werkstätten
    werden möglichst auf die Stunden **6.–9.** gelegt (Morgen bleibt für Theorie frei).
    Sind Gruppe a und b von **verschiedenen Lehrkräften** (gepaart), arbeiten beide Gruppen
    **parallel im selben Slot, gestapelt** – als **≥4-Stunden-Block** (NICHT als 2h-Stapel!).
    Gilt auch hier: Werkstatt wird über die 4h-Block-Logik verplant, nie als 2 Stunden.
15b. **Ohne Gegenpartner → 6.–9. als 4h-Block, u/g-gespiegelt (Pflicht):** Hat eine
    Werkstatt **keinen Partner** einer anderen Lehrkraft (z. B. dieselbe Lehrkraft macht
    Gruppe a *und* b), werden ihre 2h-Karten (Dauer 2 = 1 Karte, Anzahl bleibt!) je
    Gruppe zu **einem zusammenhängenden ≥4-Stunden-Block** gebündelt und **fest auf
    6.–9.** gelegt. **u/g-Spiegelung (verbindlich):** Die Werkstatt einer Klasse liegt im
    **gleichen Slot (Tag + Stunden) in u UND g** – eine Woche Gruppe a, andere Woche
    Gruppe b (u und g sollen nahezu gleich aussehen; die jeweils freie Gruppe kann heim).
    Folge: Unterrichtet **dieselbe Lehrkraft eine zweite Klasse**, rückt deren Werkstatt
    automatisch auf einen **anderen Tag** (die Lehrkraft ist an dem Tag in beiden Wochen
    belegt).
16. Werkstätten haben **Gruppen a/b** (und ggf. **c/d**). Gruppen werden **gestapelt**
    (gleicher Slot, parallel) – analog zu den Laboren.
16b. **Gekoppelte Werkstatt = 4h-Block:** Werden Werkstattgruppen über **Kopplungen**
    vorgegeben (z. B. 3 Gruppen a/b/c), bündelt der Planer mehrere Kopplungen derselben
    Klasse+Fach zu **einem zusammenhängenden 4-Stunden-Block** in **derselben Woche**
    (z. B. K220 auf 6.+7., K221 auf 8.+9. – Gruppen je Slot gestapelt). Sie werden NICHT
    u/g-gespiegelt (das ergäbe nur 2h je Woche). Üblich: **eine Kopplung je Stunden-Slot**.
16c. **Werkstatt-Schiene an EINEM zusammenhängenden Tag (klassenspezifisch).** Manche
    Klassen-Paare haben ihre (klassenübergreifend gekoppelte) Werkstatt fest an **einem Tag**:
    **2BFE2 + 2BFM2** und **AV3 + AV4** als **voller Tag 1.–4. + 6.–9.** (8 Std, Pause in 5.);
    **AV1 + AV2** als **durchgehend 3.–6.** (4 Std = 3,4,5,6 – bei nur 4 Std Werkstatt darf die
    Pause in der 5. Stunde **übergangen** werden, `noPause`). Je Paar am **gleichen Tag**, u/g
    **gespiegelt** (u und g identisch). Die Paare sind **unabhängig** – jedes darf an einem
    **anderen** Tag liegen. Da die Werkstatt-Räume klassenübergreifend geteilt sind, werden
    diese Schienen-Werkstätten **ganz zuerst** verplant (`placeWerkSchiene`, `WERK_SCHIENE`).

## Gruppen a/b/c/d (Labor & Werkstatt)

16a. **Es gibt die Gruppen a, b und zusätzlich c und d.** Sind 3 oder 4 Gruppen
    vorhanden, wird die **Parallelität über die Kopplung vorgegeben** (gekoppelte Karten
    werden auf denselben Slot gelegt). a/b ohne Kopplung paart der Planer automatisch.
17. Labore gibt es als **Gruppe a/b** (und ggf. c/d).
17a. **Labor liegt in 1.–6. und 8.+9., NIE in der 7. Stunde** (7. bleibt Mittagspause – anders
    als Werkstatt). Labor wird wie eine normale Karte platziert (Blöcke bis 6. oder in 8.+9.);
    ein 4h-Labor liegt also z. B. 1.–4., 2.–5. oder 3.–6.
18. Ein Labor der **Gruppe a** wird auf ein Labor der **Gruppe b** gelegt (gestapelt).
    Das **Fach muss nicht übereinstimmen**. Mit c/d analog (über Kopplung).
18a. **Höchstens 4 Karten je Stapel** (Gruppen a/b/c/d, jede Gruppe nur einmal je Slot).
    Ohne c/d bleibt es bei max. 2 (a auf b). Bei vielen Laboren einer Klasse bildet der
    Planer **mehrere Stapel** auf verschiedenen Slots.

## Gruppen a/b – Ausnahmen (Labor & Werkstatt)

19. **Nur eine Gruppe vorhanden:** Gibt es zu einer Gruppe-a-Karte **keinen passenden
    Gruppe-b-Partner** (manche Klassen haben nur Gruppe a), wird die **Gruppe-a-Karte
    einfach normal verplant** – kein Stapeln, kein Überspringen.
20. **Gleiche Lehrkraft für a und b:** Wenn **dieselbe Lehrkraft** Gruppe a *und* b
    hat, dürfen diese **nicht aufeinander** liegen (sie kann nicht gleichzeitig an
    beiden Gruppen sein). Sie werden dann zu **verschiedenen Zeiten** verplant.
    Gestapelt wird nur, wenn die Gruppe b von einer **anderen Lehrkraft** kommt.
20a. **Stapeln auch über getrennte Kopplungen:** Gruppe-a-/Gruppe-b-Karten dürfen
    sich auch dann a-auf-b stapeln, wenn sie **nicht** als Paar, sondern getrennt
    (z. B. zwei eigene Kopplungen wie A_SK1 und B_SK1) verplant werden – höchstens 2
    je Stapel, andere Lehrkraft, andere/leere Raumbelegung.

## Fach-spezifische Lagen

21. **Seminarkurs (A_SK1/B_SK1/A_SK2/B_SK2 …): FEST auf Montag, Block im Fenster 7.–9.**
    (eigentlich 8.–10., aber das Raster endet bei der 9.). Hart erzwungen (`check()`):
    Montag, Start so, dass der Block in 7.–9. liegt (z. B. 3h-Block → 7.–9.). Die
    **7. Stunde ist für Seminarkurs freigegeben** (sonst Mittagspause). Die a/b-Gruppen
    stapeln am selben Slot (siehe 20a); SK1 und SK2 verteilen sich über u-/g-Woche.
22. **Spanisch (SB1/SB2/SB3): nur Randstunden 1.+2. ODER 8.+9.** (nicht alle Schüler
    besuchen es). `baseStarts` = [1, 8]. **Tag-Pause:** mindestens ein Tag zwischen den
    Spanisch-Stunden einer Klasse (kein Nachbartag). **Alternation:** liegt eine Stunde
    schon 1.+2., wird die andere 8.+9. bevorzugt (und umgekehrt) – pro Klasse, woche­n­übergreifend.
    Damit Spanisch eine 1+2-Stunde sichern kann, werden Spanisch-/Seminarkurs-Kopplungen
    **vor** den Hauptfächern verplant (sonst füllen diese den Morgen).
22a. **OLZ (in AV1–AV4): Randstunden 1.+2. ODER 8.+9., in allen 4 Klassen als SCHIENE
    zeitgleich** (Fach enthält „OLZ"). **Ohne Kopplung** (jede Klasse hat mehrere
    verschiedene OLZ-Lehrer, die Kombinationen sollen NICHT fest vorgegeben werden). Eigener
    **Schienen-Schritt** (`placeOlzSchiene`, früh nach den großen Schienen): eine GLOBALE
    Zuteilung (Latin-Square-artig, Backtracking) ordnet jede Klasse+Lehrkraft einer von K
    Positionen zu, sodass an jeder Position **K verschiedene Lehrkräfte** sitzen (eine je
    Klasse) → echte Schiene. Jede Position = ein Randstunden-Slot (1.+2. oder 8.+9.), die
    Lehrkraft liegt dort in **u UND g gespiegelt**. In `better()` hat **wenige distinkte
    OLZ-Slots Vorrang** (OLZ ist zwingend). Ergebnis: alle 4 Klassen exakt gleichzeitig.
    **Über die Woche verteilt:** die Schienen werden auf möglichst **viele verschiedene Tage**
    gelegt (höchstens eine OLZ-Schiene je Tag, dann erst ein zweiter Slot am selben Tag).

## Schienen & Planungs-Reihenfolge

23. **Reihenfolge: Betriebstage → große Schienen → Rest.** Zuerst die **Betriebstage/Block-
    Anker** (starrster Ganztags-Block), dann **große Schienen** (Karte mit Schiene-„S" ODER
    Kopplung über **≥3 Klassen**, z. B. CH/PH der TG-Klassen). Beide sind am stärksten
    eingeschränkt (Schiene braucht einen Slot, an dem **alle** Klassen gleichzeitig da sind).
    Volle Reihenfolge: **Betrieb/Block-Anker → große Schienen → Werkstatt-Blöcke →
    Werkstatt-Kopplungen → Spanisch/Seminar → Hauptfächer → Labor → restliche Kopplungen →
    Teamteaching → Rest.**
23a. **Betrieb-/Block-Karten als Anker (ganz zuerst).** „nicht zählen"-Karten ohne Lehrkraft
    (Betrieb = Klasse im Betrieb) bzw. Sperr-Blöcke sind **feste Belegungen** und oft starre
    4-Stunden-Blöcke. Sie werden **als Erstes** verplant, damit nicht später 1.–4. voll ist und
    sie keinen Platz mehr finden. Berufsschulklassen sind oft zu 100 % ausgelastet – da ist die
    Reihenfolge entscheidend.
23b. **Betriebstag je Klasse.** Manche Klassen haben einen festen Betriebstag, z. B. **1BFB =
    Montag**, **1BFK = Mittwoch** (`BETRIEB_DAY`-Tabelle im Planer, erweiterbar). Betrieb-Karten der Klasse dürfen
    dann nur an diesem Tag liegen. Am Betriebstag ist die **ganze Klasse** im Betrieb –
    deshalb liegen **A_Betrieb und B_Betrieb parallel (gestapelt)**: Betrieb-Karten bekommen
    ihre Gruppe (a/b/c/d) aus dem Fach-Präfix und sind wie Labor/Werkstatt stapelbar.
23c. **Betrieb als Ganztags-Block.** Ist die ganze Klasse einen Tag im Betrieb, wird das als
    EIN Block über den ganzen Tag abgebildet (z. B. 1BFK = Mittwoch 1.–8., je 1× u + 1× g).
    Betrieb darf daher die **7. Stunde belegen** und unterliegt **keinem 4-Std-Block-Limit**.
23d. **8-Stunden-Lehrer-Tag (am Stück) je Klasse.** In randvollen Berufsschulklassen mit wenigen
    Anwesenheitstagen ist ein durchgehender 8-Std-Tag der Lehrkraft normal (`LONG_DAY_CLASSES`,
    z. B. **K2FR, K3FR**). Dort gilt Lehrer-Tag bis **8 Std** und **bis 8 Std am Stück** statt 6/4.
23e. **Raumtreue – möglichst im selben Raum bleiben.** Schüler sollen so wenig wie möglich den
    Raum wechseln. Der Planer bevorzugt daher Plätze, an denen die Klasse an dem Tag **im bereits
    genutzten Raum** bleibt (weiche Bedingung). **Ausnahmen** (eigener Fachraum, Wechsel erlaubt):
    **Labor, Werkstatt** sowie die Fächer **Chemie (CH)** und **Physik (PH)**. Hinweis: Räume sind
    fest je Karte vergeben – der Planer kann Räume nicht umverteilen, sondern nur vermeidbare
    Wechsel reduzieren; sind einer Klasse am selben Tag fest zwei Räume zugeordnet, bleibt der Wechsel.
24. **Suchzeit:** Der Planer sucht per Zufalls-Neustarts das beste Ergebnis. Ist bereits
    eine **vollständige** Lösung gefunden, stoppt er nach kurzer Zeit ohne Verbesserung
    (~5 s). Sind **noch Karten offen**, sucht er **deutlich länger** weiter (bis ~120 s ohne
    Verbesserung bzw. bis zum Zeit-Budget von 10 Min) – „Stopp" bricht jederzeit ab.
25. **Gezielte Neustarts:** Zuletzt **nicht** verplante Karten werden im nächsten Versuch
    **zuerst** platziert (jeder 2. Versuch), damit sie die knappen Slots gewinnen.
26. **Reparatur-Schritt (Tausch-Kette):** Am Ende jedes (aussichtsreichen) Laufs werden offene
    **Einzelkarten** (eigene Lehrkraft+Raum, KEINE Kopplung/Team/Werkstatt/Labor/Betrieb)
    eingegliedert, indem eine blockierende Einzelkarte verschoben wird – die wiederum eine
    verschieben darf (Kette, max. 3 tief). Das löst **randvolle Klassen, die sich einen Raum
    teilen** (kein einzelner freier Platz, aber ein gültiger Ringtausch existiert). Nutzt
    dieselbe Prüfung wie der Planer (keine neuen Regelverstöße). **Grenze:** Karten, die nur
    durch **gekoppelte** Stunden blockiert sind (z. B. gemeinsame Fächer pinned auf einen Tag),
    können so nicht frei werden – dafür braucht es etwas Luft (z. B. einen 2. Raum).
27. **Datencheck im Prüfbericht.** Widersprüchliche/unnötige Karten-Markierungen werden als
    **Fehler** gemeldet (Pool UND verplant), damit Excel-Fehler sofort auffallen: ein
    **Betriebstag, der als Labor/Werkstatt markiert** ist, ein **gekoppelter Betrieb** (Betrieb
    braucht keine Kopplung – A/B stapeln automatisch; eine Kopplung verhindert die Anker-
    Platzierung), oder eine Karte, die **gleichzeitig Labor UND Werkstatt** ist. (Solche
    Markierungen ziehen die Karte sonst unbemerkt aus der richtigen Platzierungs-Logik.)

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
- **Hauptfach:** ausschließlich Karten-Checkbox „⭐ Hauptfach" bzw. Excel-Spalte „Hauptfach" = `x`
  (keine Fachnamen-Automatik). Hauptfächer werden **direkt nach den Werkstatt-Blöcken** verplant
  (vor Laboren, Kopplungen, Teamteaching, Rest), damit sie sich den Morgen sichern.
  Platz-Priorität (von hoch nach niedrig): u/g-Differenz ≤ 2 → **Stunden 1–6** →
  **mind. ein Tag Pause** zum gleichnamigen Hauptfach → **u/g-Parallelität** →
  Fächer-Variation → Wochenausgleich → frühe Stunde. Die 8./9. Stunde nur, wenn 1–6
  wirklich voll ist; ein Nachbartag nur als Ausweg.
- **u/g-Konstanz (hohe Priorität):** Bei der Platzwahl bevorzugt der Planer Slots, an
  denen dieselbe Lehrkraft+Klasse+Fach in der anderen Woche bereits liegt; die
  **u/g-Ähnlichkeit** fließt auch in die Bewertung des besten Durchlaufs ein. Ziel:
  u- und g-Stundenplan möglichst gleich.
- **u/g-Differenz hat Vorrang vor Parallelität:** Würde ein Slot die u/g-Differenz
  einer Lehrkraft über **2 Stunden** treiben, wird er abgewertet (vor der Parallelität)
  – und auch bei der Durchlauf-Bewertung steht die Balance vor der u/g-Konstanz. So
  bleibt die Differenz ≤ 2 und es wird **trotzdem so viel wie möglich** parallel
  (gleicher Slot in u/g) verplant. Geht es nicht auf, hat eine Woche mehr Stunden.
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
  **zeitlich überschneiden** (andere Klasse, ggf. gleicher Raum). Gezählt wird **pro
  Lehrkraft**: dieselbe Lehrkraft in mehreren gekoppelten Klassen zählt **einmal**;
  sind in der Kopplung **verschiedene Lehrkräfte** (z. B. D der einen Klasse mit M
  einer anderen), zählt **jede Lehrkraft** ihre Stunden. Anwendung: zwei Klassen sind
  z. B. in Deutsch zusammengelegt – je eine Karte pro Klasse mit derselben
  Kopplungs-ID anlegen.
  - **Automatisches Verplanen:** Gekoppelte Karten werden als **Gruppe gemeinsam** auf
    denselben Slot gelegt (jede in ihrer Klassenspalte, gleiche Startstunde). Findet
    sich kein gemeinsamer freier Slot, bleibt die Gruppe offen und wird gemeldet.
  - **Manuell:** Beim Ziehen/Entplanen einer gekoppelten Karte wandern die Partner mit.
- **Teamteaching (mehrere Lehrkräfte gleichzeitig):** Karten mit gleicher **Team-ID**
  (Feld „Teamteaching" / Excel-Spalte „Teamteaching", z. B. „T1") liegen **aufeinander**
  (gleiche Zeit, gleiche Klasse, ggf. gleicher oder anderer Raum) und **zählen jeweils
  normal** (beide Lehrkräfte unterrichten). Der Planer legt sie gemeinsam auf denselben
  Slot; beim Ziehen/Entplanen wandern die Partner mit. Zuordnung über die Checkbox/das
  Feld beim Erstellen, das Header-Fenster „👥 Teamteaching" oder die Excel-Spalte.
- **Hauptfächer-Erkennung:** ausschließlich über das Feld „Hauptfach" (`x`) der Karte –
  keine Fachnamen-Automatik mehr. **LBT** wird weiterhin über das Feld „Fach" erkannt (max. 6/Tag).
