# Entwicklungsregeln

Verbindliche Regeln für die Arbeit (auch durch KI-Assistenten) an diesem Projekt.

## 1. Kein visuelles Testen durch den Assistenten

- **Keine** visuelle Prüfung der Software über Screenshots, Preview-Server o. Ä.
- Der menschliche User ist der Tester: Änderungen werden per Typprüfung/Build
  (`bun run build`) abgesichert und dann vom User in der laufenden App geprüft.

## 2. Zusammenarbeit über GitHub

An der Software arbeiten **zwei Personen parallel**. Der Code wird über GitHub
synchron gehalten: <https://github.com/robs2243/digitaletafelts.git> (Remote
`origin`, Branch `master`). Dabei darf nichts kaputtgehen — also intelligent
pushen und pullen:

- **Vor Arbeitsbeginn immer prüfen, ob der lokale Stand aktuell ist**
  (`git fetch` + `git status` bzw. `git pull --ff-only`).
- Vor dem Push den aktuellen Remote-Stand holen; bei parallelen Änderungen
  sauber integrieren (z. B. `git pull --rebase`), Konflikte bewusst auflösen
  und das Ergebnis per Build prüfen — niemals blind force-pushen.
- **Nach jedem Commit direkt auf GitHub pushen**, damit der andere Entwickler
  immer den aktuellen Stand hat.

## 3. Vor jeder Änderung

1. `git pull --ff-only` (bzw. fetch + Status prüfen)
2. Änderung umsetzen
3. `bun run build` (Typprüfung + Build müssen fehlerfrei sein)
4. Committen und pushen
