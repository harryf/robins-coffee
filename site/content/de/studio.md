---
title: "ROBIN's Studio installieren"
description: "So kommt ROBIN's Studio, der Editor der Website der Bar, auf einen Mac."
noindex: true
---
ROBIN's Studio ist die App, mit der die Bar diese Website ändert: Öffnungszeiten, Fotos, die Getränkekarte und Events. Sie läuft auf einem Mac. Das Einrichten dauert etwa zehn Minuten, das meiste davon ist Warten.

## Was du brauchst

1. Einen Mac mit macOS 12 oder neuer und eine Internetverbindung.
2. Zum Veröffentlichen später: ein GitHub-Konto, das Harry eingeladen hat. Installieren und umschauen geht auch ohne.

## Installieren

1. Öffne die App **Terminal**. Drücke Command und Leertaste, tippe `Terminal`, drücke Enter. Ein Fenster mit Text geht auf.
2. Kopiere die Zeile unten, füge sie in dieses Fenster ein und drücke Enter.

```
curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash
```

3. Falls ein Fenster von Apple die "Command Line Developer Tools" installieren will, klicke auf **Installieren** und warte, bis es fertig meldet. Das Terminal-Fenster macht danach von selbst weiter.
4. Warte, bis im Terminal **Done** steht. Das Studio geht auf.

Es fragt nach keinem Passwort. Der erste Start dauert eine Minute, weil das Studio die Website einmal baut.

## Wiederfinden

Die App heisst **ROBINs Studio** und liegt im Ordner Programme in deinem Benutzerordner. Drücke Command und Leertaste, tippe `Studio`, drücke Enter. Ziehe ihr Symbol ins Dock, damit es dort bleibt.

## Zum ersten Mal veröffentlichen

1. Öffne im Studio die **Einstellungen**.
2. Füge deinen GitHub-Schlüssel ins Feld "GitHub-Schlüssel" ein und speichere. Der Schlüssel bleibt im Schlüsselbund dieses Macs.
3. Ändere etwas, schau es dir unter **Vorschau öffnen** an und drücke dann **Veröffentlichen**.

Noch kein Schlüssel? Öffne auf GitHub Settings, Developer settings, Personal access tokens und erstelle ein Token für das Repository der Website, das Inhalte und Pull Requests lesen und schreiben darf. Harry kann das mit dir machen.

## Gut zu wissen

- Das Studio hält sich selbst aktuell. Bei jedem Start sucht es nach einer neueren Version.
- Nichts geht live, bevor du auf Veröffentlichen drückst. Bis dahin sind deine Änderungen nur auf diesem Mac.
- Zum erneuten Installieren oder Reparieren führe dieselbe Zeile noch einmal aus. Deine unveröffentlichten Änderungen bleiben.
- Zum Entfernen: Ziehe ROBINs Studio aus Programme in den Papierkorb und lösche den Ordner `Library/Application Support/ROBINs Studio` in deinem Benutzerordner.

## Was die Zeile macht

Sie lädt ein kurzes Skript aus dem Repository dieser Website und führt es aus. Das Skript installiert Apples Werkzeuge, falls sie fehlen, installiert bun (das Programm, auf dem das Studio läuft), lädt eine Kopie der Website in deinen Library-Ordner und baut die App auf deinem Mac. Du kannst [das Skript vorher lesen](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh).
