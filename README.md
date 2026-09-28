# 🔴🔵 Sumo Smash – 3D-Schubs-Duell fürs Handy

Ein kleines 3D-Browserspiel mit [three.js](https://threejs.org): Zwei Teams kleiner Sumo-Kugeln stehen auf einer
schwebenden Sechseck-Arena über Lava. Wer alle Gegner herunterschubst, gewinnt die Runde – wer zuerst **3 Runden**
holt, gewinnt das Spiel. Einfach zu lernen (laufen + rammen), aber mit Timing, Position und Power-ups steckt
genug Taktik drin.

Läuft ohne Installation und ohne eigenen Server direkt im Browser (GitHub Pages), optimiert für Handys im Hoch- und Querformat.

**▶ Jetzt spielen: https://taemo004.github.io/play/**

## Spielmodi

- **🏆 Turnier** – fünf Gegner mit eigenem Stil nacheinander (Knödel, Frosti, Wirbelwind, Dampfwalze und der riesige
  Boss Yokozuna). Jeder Kampf geht auf 2 Gewinnrunden, verlorene Kämpfe lassen sich wiederholen. Wer gewinnt,
  bekommt den 🥇 Goldgürtel.
- **🤖 Gegen KI** – 1 gegen 1 oder 2 gegen 2 (mit KI-Partner), drei Schwierigkeitsstufen
- **👥 Zu zweit an einem Handy** – Handy flach zwischen euch auf den Tisch legen, jeder spielt von seiner Seite
  (die obere Bildschirmhälfte ist um 180° gedreht). 1 gegen 1 oder 2 gegen 2 mit KI-Partnern.
  Am PC: WASD + Leertaste gegen Pfeiltasten + Enter, auch mit zwei Gamepads.
- **🌐 Online mit Freunden** – Raum erstellen, Link oder 4-stelligen Code teilen, bis zu 4 Spieler.
  1 gegen 1 oder 2 gegen 2, freie Plätze füllt auf Wunsch die KI. Wer die Partie verlässt, wird von der KI ersetzt.

## Spielmechanik

- **Spielziele:** 🥊 *Runterschubsen* (letztes Team auf der Arena gewinnt) oder ⛰️ *Hügel halten*: Wer das goldene
  Mittelfeld 12 Sekunden lang allein hält, gewinnt die Runde. Runtergefallene kommen dabei nach 2,5 Sekunden vom
  Himmel zurück, und die Arena bröckelt nicht. Beide Ziele gibt es gegen KI, zu zweit und online.
- **Aufladbares Rammen:** Taste halten lädt auf (man läuft langsamer), loslassen rammt – voll geladen mit fast
  doppelter Wucht. Kurz tippen rammt sofort.
- **Laufen** mit dem Joystick, **Rammen** macht einen kurzen, schnellen Sprint. Trifft er, fliegt der Gegner weg
  und rutscht kurz hilflos. Danach lädt das Rammen gut eine Sekunde lang auf.
- **Frontal-Zusammenstoß:** Rammen beide gleichzeitig ineinander, prallen beide ab.
- **Retten:** Kurz nach einem Treffer darf man wieder rammen – ein Sprint zurück zur Mitte rettet oft vor dem Absturz.
- **Die Arena bröckelt:** Nach 12 Sekunden glüht der äußere Ring und bricht weg, alle 8 Sekunden der nächste.
  Zum Schluss brechen einzelne Felder, bis nur die Mitte bleibt.
- **Power-ups:** 🪨 *Koloss* (schwer und groß, kaum wegzuschubsen), ⚡ *Turbo* (Rammen lädt blitzschnell),
  💥 *Schockwelle* (stößt alle Gegner in der Nähe weg)
- **Taktik:** Wer zwischen Gegner und Mitte steht, schubst ihn beim Rammen nach außen.
- **Arenen:** 🌋 *Vulkan* (Klassiker), 🧊 *Gletscher* (rutschig, langer Bremsweg), 🎠 *Karussell* (dreht sich immer
  schneller und zieht nach außen), 🎲 *Wechselnd* (jede Runde eine andere). Online wählt der Gastgeber.
- **Zeitlupen-Wiederholung:** Entscheidet ein Stoß die Runde, läuft er noch einmal langsam und aus der Nähe. Tippen überspringt.
- **Deine Figur:** Hüte und Extras (Partyhut, Zylinder, Cowboyhut, Wikingerhelm, Krone, Heiligenschein, Sonnenbrille,
  Schnurrbart, Herzbrille). Vieles wird durch Siege und K.O.s freigeschaltet, die Krone nur durch einen Sieg gegen
  die KI auf „Schwer“. Online sehen alle Mitspieler dein Aussehen. Fortschritt wird im Browser gespeichert.

## Steuerung

| Gerät | Laufen | Rammen |
| --- | --- | --- |
| Handy | linke Bildschirmhälfte wischen (Joystick erscheint unter dem Finger) | rechte Hälfte antippen, halten lädt auf |
| Tastatur | `WASD` / Pfeiltasten | `Leertaste`, `Shift`, `Enter` (halten lädt auf) |
| Gamepad | linker Stick | A / B / X / Y (halten lädt auf) |

`M` schaltet den Ton an und aus, `Esc` verlässt das Spiel.

## Online spielen (GitHub Pages)

Das Spiel besteht nur aus statischen Dateien in `public/` und wird per GitHub Actions (`.github/workflows/pages.yml`)
bei jedem Push auf `main` automatisch veröffentlicht.

Einmalig einrichten: im Repository **Settings → Pages → Build and deployment → Source: „GitHub Actions“** wählen.
Danach ist das Spiel unter `https://<benutzername>.github.io/<repository>/` erreichbar.

> Hinweis: GitHub Pages ist für öffentliche Repositories kostenlos, für private Repositories braucht man GitHub Pro/Team.

**Vor jeder Veröffentlichung die Versionsnummer hochzählen:** in `public/js/version.js` und in `public/index.html`
(`data-v`, alle `?v=` und die Import-Map – `npm test` prüft, dass alles übereinstimmt). So mischen Browser nach einem
Update keine alten und neuen Dateien aus dem Zwischenspeicher.

## Lokal starten

Voraussetzung: Node.js ≥ 20 (keine Abhängigkeiten nötig)

```bash
npm start
```

Dann **http://localhost:3000** öffnen. Zum Testen am Handy im selben WLAN die IP-Adresse des Rechners verwenden,
z. B. `http://192.168.1.20:3000`.

## So funktioniert der Multiplayer

- Wer einen Raum erstellt, ist **Gastgeber**. In seinem Browser läuft die Raumlogik (`public/js/room.js`) und die
  komplette Physik für alle Spieler (60× pro Sekunde).
- Die Mitspieler verbinden sich per **WebRTC direkt** mit dem Gastgeber. Nur zum Finden des Gastgebers wird der
  kostenlose öffentliche Vermittlungsserver von [PeerJS](https://peerjs.com) genutzt.
- Mitspieler schicken nur ihre Eingaben (Richtung + Rammen) und bekommen 30× pro Sekunde den Spielzustand zurück,
  den sie leicht verzögert und geglättet darstellen. Die eigene Figur wird mit weniger Verzögerung gezeigt.
- Wer in Team Blau spielt, sieht die Arena gedreht, sodass die eigene Seite immer unten ist.

**Einschränkungen:** Das Gastgeber-Fenster sollte im Vordergrund bleiben (Browser drosseln Hintergrund-Tabs).
Verlässt der Gastgeber den Raum, endet das Spiel für alle. In sehr restriktiven Netzwerken (manche Firmen- und
Schulnetze) kann eine direkte Verbindung scheitern.

Optional kann ein eigener PeerJS-Server genutzt werden: `?peerhost=mein-server.de&peerport=443&peerpath=/`

## Tests

```bash
npm test
```

Prüft das Sechseck-Raster, Physik (Rammen, Frontal-Zusammenstoß, Koloss, Abklingzeit, Absturz), das Bröckeln der
Arena, Power-ups, Rundenwertung, lässt die KI ganze Partien 1 gegen 1 und 2 gegen 2 spielen und testet die
Raumlogik (Beitreten, Teams, Einstellungen, Start, Eingaben, Schnappschüsse, Revanche, KI-Ersatz).
Läuft auch automatisch bei jedem Pull Request (`.github/workflows/test.yml`).

## Aufbau

```
server.js              Kleiner lokaler Entwicklungsserver (nur statische Dateien)
public/index.html      Menüs, Lobby, Anzeige im Spiel
public/style.css       Styling (Handy zuerst, Hoch- und Querformat)
public/js/main.js      Ablauf, Spielmodi, Spiel-Loop, Anzeige, Online-Lobby
public/js/sim.js       Spiellogik ohne Grafik: Arenen, Physik, Runden, Power-ups, Netz-Kodierung
public/js/looks.js     Hüte und Extras, Freischalt-Regeln
public/js/tourney.js   Turnier-Gegner (Stärke, Arena, Spielziel, Größe, Aussehen)
public/js/ai.js        KI-Gegner (Leicht / Mittel / Schwer)
public/js/render.js    3D-Darstellung mit three.js: Arena-Themen, Figuren mit Hüten, Vorschau, Partikel, Kamera
public/js/input.js     Touch-Joystick, Rammen-Taste, geteilter Bildschirm, Tastatur, Gamepad
public/js/audio.js     Synthetische Soundeffekte (WebAudio)
public/js/net.js       Peer-to-Peer-Verbindungen (PeerJS/WebRTC)
public/js/room.js      Raumlogik und Physik-Autorität, läuft im Browser des Gastgebers
public/vendor/         three.js r186 und PeerJS 1.5.5 (beide MIT-Lizenz)
test/                  Automatische Tests (npm test)
```

### Werte anpassen

Die Arenen (Rutschigkeit, Drehung, Stoßstärke) stehen in `public/js/sim.js` im Objekt `ARENAS`, ihr Aussehen in
`public/js/render.js` unter `THEMES`. Neue Hüte kommen in `public/js/looks.js` und `buildHat` in `render.js`.
Fast alle übrigen Spielwerte stehen oben in `public/js/sim.js` im Objekt `CFG`: Laufgeschwindigkeit, Stärke und
Abklingzeit des Rammens, wann die Arena bröckelt, Dauer der Power-ups usw. Die KI-Stufen stehen in `public/js/ai.js`.
