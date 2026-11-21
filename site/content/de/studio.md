---
title: "ROBIN's Studio installieren"
description: "So kommt ROBIN's Studio, der Editor der Website der Bar, auf einen Mac."
noindex: true
---
ROBIN's Studio ist die App, mit der die Bar diese Website ändert: Öffnungszeiten, Fotos, die Getränkekarte und Events. Sie läuft auf einem Mac. Das Einrichten dauert etwa zehn Minuten, das meiste davon ist Warten.

## Was du brauchst

- **Einen Mac** mit macOS 12 oder neuer. Zum Nachschauen: Klicke oben links auf das Apple-Zeichen, dann auf **Über diesen Mac**.
- **macOS 26 (Tahoe) oder neuer für die Übersetzungen.** Du schreibst jeden Text auf Englisch; der Mac macht daraus Deutsch, Französisch und Italienisch. Auf einem älteren Mac läuft das Studio trotzdem, und die Website zeigt Englisch, wo eine Übersetzung fehlt.
- **Eine Internetverbindung**, für die Installation und jedes Mal, wenn du veröffentlichst.
- **Eine E-Mail-Adresse**, die du jetzt öffnen kannst. GitHub schickt einen Code dorthin.
- **Ein kostenloses GitHub-Konto, das Harry eingeladen hat, und einen Schlüssel daraus.** GitHub ist der Dienst, der die Dateien der Website aufbewahrt. Die drei Schritte unter "Voraussetzungen" richten das ein. Ohne sie kannst du das Studio installieren und dich umschauen, aber nicht veröffentlichen.
- **Zeit**: etwa zehn Minuten für die Installation und ein paar Minuten für jeden der drei Schritte davor. Einer davon wartet auf Harry.

Du brauchst kein Passwort für den Mac, und nichts kostet Geld.

Das Studio kann auch die Events der Bar von Eventfrog auflisten. Dafür braucht es den Eventfrog-Schlüssel der Bar, den du später in den Einstellungen des Studios einfügst. Alles andere geht auch ohne.

## Voraussetzungen

Mach diese drei Schritte der Reihe nach, bevor du installierst. Du machst sie einmal, im Browser.

### Schritt 1: Ein GitHub-Konto erstellen

Wenn du schon ein GitHub-Konto hast, melde dich an und geh zu Schritt 2.

1. Öffne [github.com/signup](https://github.com/signup).
2. Tippe deine E-Mail-Adresse, ein Passwort und einen Benutzernamen. Über den Benutzernamen findet Harry dich, wähle also einen, den du dir merken kannst.
3. GitHub schickt einen Code an deine E-Mail. Tippe ihn ein.
4. Schreib dir deinen Benutzernamen auf.

### Schritt 2: Harry um eine Einladung bitten

1. Schick Harry deinen GitHub-Benutzernamen.
2. Warte, bis Harry dich einlädt. (Harry: Wie das geht, steht unter "Für Harry" am Ende dieser Seite.)
3. GitHub schickt dir eine E-Mail mit der Einladung. Klicke darin auf **View invitation**, dann auf **Accept invitation**. Wenn du die E-Mail nicht findest, öffne [github.com/harryf/robins-coffee/invitations](https://github.com/harryf/robins-coffee/invitations).

Eine Einladung gilt 7 Tage. Wenn deine älter ist, bitte Harry um eine neue.

### Schritt 3: Deinen Schlüssel erstellen

Das Studio veröffentlicht über GitHub, und GitHub verlangt einen Schlüssel (dort heisst er "Token"), der sagt, dass das Studio das für dich tun darf.

1. Melde dich bei GitHub an.
2. Öffne [github.com/settings/tokens/new](https://github.com/settings/tokens/new). GitHub fragt vielleicht noch einmal nach deinem Passwort. Von Hand: dein Bild oben rechts, **Settings**, unten links **Developer settings**, **Personal access tokens**, **Tokens (classic)**, **Generate new token (classic)**.
3. **Note**: tippe `ROBINs Studio`.
4. **Expiration**: wähle ein Datum. An diesem Tag hört das Veröffentlichen auf, bis du einen neuen Schlüssel erstellst. Wähle also eine lange Zeit.
5. Unter **Select scopes** steht eine lange Liste mit Kästchen. Setze nur einen Haken: **public_repo**. Alle anderen bleiben leer.
6. Klicke unten auf der Seite auf **Generate token**.
7. GitHub zeigt den Schlüssel einmal: eine lange Zeile, die mit `ghp_` beginnt. Lass diese Seite offen. Du fügst den Schlüssel nach der Installation ins Studio ein.

Behandle den Schlüssel wie ein Passwort: Schick ihn niemandem und speichere ihn nicht in einer Notiz. Wenn du ihn verlierst, lösche ihn auf derselben GitHub-Seite und erstelle einen neuen.

## Die App installieren

1. Öffne die App **Terminal**. Drücke Command und Leertaste, tippe `Terminal`, drücke Enter. Ein Fenster mit Text geht auf.
2. Kopiere die Zeile unten, füge sie in dieses Fenster ein und drücke Enter.

```
curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash
```

3. Falls ein Fenster von Apple die "Command Line Developer Tools" installieren will, klicke auf **Installieren** und warte, bis es fertig meldet. Das Terminal-Fenster macht danach von selbst weiter.
4. Warte, bis im Terminal **Done** steht. Das Studio geht auf.

Es fragt nach keinem Passwort. Der erste Start dauert eine Minute, weil das Studio die Website einmal baut.

### Wiederfinden

Die App heisst **ROBINs Studio** und liegt im Ordner Programme in deinem Benutzerordner. Drücke Command und Leertaste, tippe `Studio`, drücke Enter. Ziehe ihr Symbol ins Dock, damit es dort bleibt.

### Die Sprachen für die Übersetzungen laden

Das Studio übersetzt auf diesem Mac mit Apples eigener Übersetzung, also wird nichts, was du schreibst, irgendwohin geschickt. Der Mac braucht dafür einmal drei Sprachen:

1. Öffne **Systemeinstellungen**, dann **Allgemein**, dann **Sprache & Region**.
2. Klicke weiter unten auf **Übersetzungssprachen**.
3. Klicke auf den Download-Knopf neben **Deutsch**, **Französisch** und **Italienisch**. Warte, bis jede fertig ist.

Das Studio sagt dir auch, wenn eine Sprache fehlt, mit einem Knopf, der diese Seite öffnet. Solange eine Sprache fehlt, zeigt die Website dort den englischen Text.

## Zum ersten Mal veröffentlichen

1. Öffne im Studio die **Einstellungen**.
2. Geh zurück zur GitHub-Seite aus Schritt 3 und kopiere den Schlüssel. Füge ihn ins Feld "GitHub-Schlüssel" ein und speichere. Der Schlüssel bleibt im Schlüsselbund dieses Macs.
3. Ändere eine Kleinigkeit.
4. Drücke auf **Vorschau öffnen** und schau sie dir an.
5. Drücke auf **Veröffentlichen**. Das dauert meist 1 bis 2 Minuten.

Wenn das Studio meldet, dass GitHub den Schlüssel abgelehnt hat, prüfe zwei Dinge. Erstens, dass du Harrys Einladung angenommen hast (Schritt 2). Zweitens, dass der Haken bei **public_repo** gesetzt ist: Öffne [deine Schlüssel bei GitHub](https://github.com/settings/tokens), klicke auf `ROBINs Studio`, setze den Haken und klicke auf **Update token**. Du musst den Schlüssel nicht noch einmal einfügen. Die Meldung des Studios nennt zwei Rechte, Contents und Pull requests; bei deiner Art von Schlüssel gibt public_repo beide.

## Gut zu wissen

- Das Studio hält sich selbst aktuell. Bei jedem Start sucht es nach einer neueren Version.
- Schreib auf Englisch. Die Übersetzungen stehen in einem geschlossenen Feld unter jedem Text; öffne es, um sie zu lesen oder ein Wort zu ändern. Lässt du eine leer, macht der Mac sie beim Speichern neu.
- Nichts geht live, bevor du auf Veröffentlichen drückst. Bis dahin sind deine Änderungen nur auf diesem Mac.
- Zum erneuten Installieren oder Reparieren führe dieselbe Zeile noch einmal aus. Deine unveröffentlichten Änderungen bleiben.
- Zum Entfernen: Ziehe ROBINs Studio aus Programme in den Papierkorb und lösche den Ordner `Library/Application Support/ROBINs Studio` in deinem Benutzerordner.

## So funktioniert es

### Von der Änderung zur Live-Website

<ol class="flow">
<li><strong>Ändern</strong> Du änderst etwas in ROBINs Studio, auf deinem Mac.</li>
<li><strong>Vorschau</strong> Du schaust dir das Ergebnis an. Es ist noch nur auf deinem Mac.</li>
<li><strong>Zufrieden?</strong> Wenn nicht, ändere es noch einmal. Sonst sieht es noch niemand.</li>
<li><strong>Veröffentlichen</strong> Das Studio schickt deine Änderung an GitHub.</li>
<li><strong>Live</strong> Besucher sehen sie ein paar Minuten später auf der Website.</li>
</ol>

Das Veröffentlichen dauert meist 1 bis 2 Minuten, weil GitHub die Änderung zuerst prüft. Das Studio sagt dir, wenn es fertig ist.

### Wo alles liegt

<ol class="flow">
<li><strong>Dein Mac</strong> ROBINs Studio, eine Kopie der Website und deine Änderungen.</li>
<li><strong>GitHub</strong> Bewahrt die Dateien der Website und jede frühere Version auf und baut daraus die Website.</li>
<li><strong>GitHub Pages</strong> Stellt die fertige Website ins Internet.</li>
<li><strong>Ein Besucher</strong> Öffnet die Website im Browser, auf dem Handy oder am Computer.</li>
</ol>

Die Website hat keinen anderen Server und keine Datenbank. Weil GitHub jede frühere Version aufbewahrt, lässt sich eine Änderung zurücknehmen: Das Studio listet sie in seinem Verlauf.

### Was die Zeile macht

Sie lädt ein kurzes Skript aus dem Repository dieser Website und führt es aus. Das Skript installiert Apples Werkzeuge, falls sie fehlen, installiert bun (das Programm, auf dem das Studio läuft), lädt eine Kopie der Website in deinen Library-Ordner und baut die App auf deinem Mac. Du kannst [das Skript vorher lesen](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh).

## Für Harry

### Jemanden einladen

1. Öffne [github.com/harryf/robins-coffee/settings/access](https://github.com/harryf/robins-coffee/settings/access).
2. Klicke auf **Add people**, tippe den GitHub-Benutzernamen der Person und wähle sie in der Liste.
3. Klicke auf **Add to repository**. GitHub schickt ihr die Einladung.

### Dein eigener Schlüssel

Das Repository liegt in deinem eigenen Konto, darum kannst du die neuere Art von Schlüssel erstellen, die nur auf diesem einen Repository arbeitet.

1. Öffne [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). Von Hand: dein Bild oben rechts, **Settings**, unten links **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. **Token name**: tippe `ROBINs Studio`.
3. **Expiration**: wähle ein Datum. An diesem Tag hört das Veröffentlichen auf, bis du einen neuen Schlüssel erstellst. Wähle also eine lange Zeit.
4. **Resource owner**: dein eigenes Konto.
5. **Repository access**: wähle **Only select repositories** und in der Liste `robins-coffee`.
6. **Permissions**, dann **Repository permissions**: stelle **Contents** auf **Read and write** und **Pull requests** auf **Read and write**. "Metadata" stellt sich von selbst auf nur lesen; alles andere bleibt, wie es ist.
7. Klicke auf **Generate token**. GitHub zeigt den Schlüssel einmal: eine lange Zeile, die mit `github_pat_` beginnt. Kopiere sie.

Wenn das Studio meldet, dass GitHub diesen Schlüssel abgelehnt hat, öffne [deine Schlüssel bei GitHub](https://github.com/settings/personal-access-tokens), klicke auf den Schlüssel, prüfe die zwei Rechte aus Schritt 6 und speichere.
