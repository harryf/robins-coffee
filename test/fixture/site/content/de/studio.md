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

## Deinen GitHub-Schlüssel erstellen

Das Studio veröffentlicht über GitHub, und GitHub verlangt einen Schlüssel (dort heisst er "Token"), der sagt, dass das Studio das für dich tun darf. Du erstellst ihn einmal, im Browser. Melde dich zuerst bei GitHub an.

**Wenn das Repository der Website in deinem eigenen GitHub-Konto liegt** (das ist Harry):

1. Öffne [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). Von Hand: dein Bild oben rechts, **Settings**, unten links **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. **Token name**: tippe `ROBINs Studio`.
3. **Expiration**: wähle ein Datum. An diesem Tag hört das Veröffentlichen auf, bis du einen neuen Schlüssel erstellst. Wähle also eine lange Zeit.
4. **Resource owner**: dein eigenes Konto.
5. **Repository access**: wähle **Only select repositories** und in der Liste `robins-coffee`.
6. **Permissions**, dann **Repository permissions**: stelle **Contents** auf **Read and write** und **Pull requests** auf **Read and write**. "Metadata" stellt sich von selbst auf nur lesen; alles andere bleibt, wie es ist.
7. Klicke auf **Generate token**. GitHub zeigt den Schlüssel einmal: eine lange Zeile, die mit `github_pat_` beginnt. Kopiere sie.

**Wenn Harry dich zum Repository eingeladen hat** (das sind alle anderen): GitHub lässt den Schlüssel von oben nicht auf einem Repository in einem fremden Konto arbeiten, darum erstellst du die ältere Art.

1. Nimm zuerst Harrys Einladung an: Sie ist in deiner E-Mail oder unter [github.com/harryf/robins-coffee/invitations](https://github.com/harryf/robins-coffee/invitations).
2. Öffne [github.com/settings/tokens/new](https://github.com/settings/tokens/new). Von Hand: dein Bild, **Settings**, **Developer settings**, **Personal access tokens**, **Tokens (classic)**, **Generate new token (classic)**.
3. **Note**: tippe `ROBINs Studio`. **Expiration**: wähle eine lange Zeit.
4. Setze unter **Select scopes** nur einen Haken: **public_repo**.
5. Klicke unten auf **Generate token**. Kopiere die Zeile, die mit `ghp_` beginnt.

Behandle den Schlüssel wie ein Passwort: Schick ihn niemandem und speichere ihn nicht in einer Notiz. Wenn du ihn verlierst, lösche ihn auf derselben GitHub-Seite und erstelle einen neuen.

## Zum ersten Mal veröffentlichen

1. Öffne im Studio die **Einstellungen**.
2. Füge deinen Schlüssel ins Feld "GitHub-Schlüssel" ein und speichere. Der Schlüssel bleibt im Schlüsselbund dieses Macs.
3. Ändere etwas, schau es dir unter **Vorschau öffnen** an und drücke dann **Veröffentlichen**.

Wenn das Studio meldet, dass GitHub den Schlüssel abgelehnt hat, fehlt ein Recht. Öffne [deine Schlüssel bei GitHub](https://github.com/settings/personal-access-tokens), klicke auf den Schlüssel, prüfe die zwei Rechte aus Schritt 6 und speichere. Du musst ihn nicht noch einmal einfügen.

## Gut zu wissen

- Das Studio hält sich selbst aktuell. Bei jedem Start sucht es nach einer neueren Version.
- Nichts geht live, bevor du auf Veröffentlichen drückst. Bis dahin sind deine Änderungen nur auf diesem Mac.
- Zum erneuten Installieren oder Reparieren führe dieselbe Zeile noch einmal aus. Deine unveröffentlichten Änderungen bleiben.
- Zum Entfernen: Ziehe ROBINs Studio aus Programme in den Papierkorb und lösche den Ordner `Library/Application Support/ROBINs Studio` in deinem Benutzerordner.

## Was die Zeile macht

Sie lädt ein kurzes Skript aus dem Repository dieser Website und führt es aus. Das Skript installiert Apples Werkzeuge, falls sie fehlen, installiert bun (das Programm, auf dem das Studio läuft), lädt eine Kopie der Website in deinen Library-Ordner und baut die App auf deinem Mac. Du kannst [das Skript vorher lesen](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh).
