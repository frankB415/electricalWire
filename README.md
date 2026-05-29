# Anforderungsspezifikation: electricalWire.js

## Übersicht

`electricalWire.js` ist eine JavaScript-Bibliothek zur Visualisierung von elektrischen Verbindungen (Wires) zwischen Elementen eines Schaltplans. Sie übernimmt das automatische Routing orthogonaler Leitungen zwischen definierten Anschlusspunkten (Connectoren).

Die Bibliothek wird als **ES-Modul** ausgeliefert (`export default ElectricalWire`). Einbindung in HTML über `<script type="module">`, kein Bundler erforderlich.

---

## Verzeichnisstruktur

```
electricalWire/
├── requirement.md
├── electricalWire.js
├── test.html
└── (optional) electricalWire.css
```

Die Standard-Optionswerte sind als Konstante am Anfang von `electricalWire.js` definiert:

```js
// electricalWire.js
const DEFAULTS = {
  gridSize:            10,
  wireColor:           "#1a1a1a",
  wireWidth:           2,
  stubColor:           "#2563eb",
  connectorRadius:     5,
  connectorColor:      "#e00",
  junctionRadius:      4,
  showBlockedAreas:    false,
  showConnectorLabels: true,
  hoverColor:          "#e67e00",
  logging:             true
};
```

---

## Begriffe

| Begriff | Bedeutung |
|---|---|
| **Connector** | Ein Anschlusspunkt an einem Schaltplanelement. Hat eine Position, eine Richtung und eine Mindestaustrittslänge. Wird als roter Kreis dargestellt. |
| **Connection** | Eine logische Verbindung zwischen zwei Connectoren. |
| **Wire** | Die gezeichnete, orthogonale Leitung zwischen zwei Connectoren. |
| **Stromkreis** | Ein Netz aus mindestens einem Wire (einer Connection) und den dazugehörigen Connectoren. Ein Stromkreis besteht aus 1 bis n Wires. Teilen sich zwei oder mehr Connections einen Connector, werden sie transitiv zu einem gemeinsamen Stromkreis zusammengeführt. |
| **Kreuzungsknoten** | Ein zusätzlicher Verzweigungspunkt (Steinerpunkt), den die Bibliothek automatisch einfügt, um die Gesamtlänge aller Wires eines Stromkreises zu minimieren. Entspricht einem Autobahnkreuz im Straßennetz: nicht vorgegeben, aber notwendig für das kürzeste Verbindungsnetz. Wird als schwarzer Punkt dargestellt. |
| **Sperrbereich** | Ein rechteckiger Bereich, durch den keine Wires geführt werden dürfen. Das Routing muss außen herumführen. |

---

## Interface

### Initialisierung

```js
const wiring = new ElectricalWire(container, options);
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `container` | `HTMLElement` | Das DOM-Element (div), in das gezeichnet wird. Wird als SVG-Zeichenfläche verwendet. |
| `options` | `Object` | Optionale Konfiguration (siehe unten). |

#### options

| Eigenschaft | Typ | Default | Beschreibung |
|---|---|---|---|
| `gridSize` | `number` | `10` | Rastergröße in Pixel für das Routing-Grid. |
| `wireColor` | `string` | `"#1a1a1a"` | Farbe der Wires. |
| `wireWidth` | `number` | `2` | Linienstärke der Wires in Pixel. |
| `connectorRadius` | `number` | `5` | Radius der Connector-Kreise in Pixel. |
| `junctionRadius` | `number` | `4` | Radius der Kreuzungsknoten-Punkte in Pixel. |
| `connectorColor` | `string` | `"#e00"` | Füllfarbe der Connector-Kreise. |
| `showBlockedAreas` | `boolean` | `false` | Sperrbereiche als hellgraue Fläche einzeichnen (nützlich für Debugging). |
| `showConnectorLabels` | `boolean` | `true` | Connector-IDs als Textlabels über den Connector-Kreisen einzeichnen (nützlich für Debugging). |
| `stubColor` | `string` | `"#2563eb"` | Farbe des minLength-Stubs und des Escape-Abschnitts (blau). |
| `hoverColor` | `string` | `"#e67e00"` | Farbe, auf die alle Wires und Connectoren eines Stromkreises beim Hover wechseln. |
| `logging` | `boolean` | `true` | Aktiviert oder deaktiviert sämtliche Debug-Logs der Bibliothek (siehe Abschnitt Logging). |

---

### Koordinatensystem

Alle `x`- und `y`-Angaben – bei Connectoren, Sperrbereichen und überall sonst im Interface – beziehen sich auf den **Ursprung des `container`-div** (linke obere Ecke = `0 / 0`). Die Bibliothek verwendet ausschließlich dieses lokale Koordinatensystem; absolute Seitenkoordinaten spielen keine Rolle. Das SVG-Element wird passgenau über den Container gelegt (`position: absolute`, `top: 0`, `left: 0`, `width: 100%`, `height: 100%`), sodass SVG-Koordinaten und Container-Koordinaten identisch sind.

Der Container muss eine explizite Größe (`width` und `height`) besitzen, bevor `render()` aufgerufen wird. Hat der Container zum Zeitpunkt des Renderings eine Breite oder Höhe von `0`, wirft die Bibliothek einen Fehler:

```js
throw new Error("ElectricalWire: container has no dimensions (width or height is 0). Set an explicit size before calling render().");
```

---

### Connectoren

```js
wiring.setConnectors(connectors);
```

`connectors` ist ein Array von Connector-Objekten:

```js
[
  {
    id: "C1",           // string  – eindeutige ID
    x: 100,             // number  – X-Position im Container (px)
    y: 150,             // number  – Y-Position im Container (px)
    direction: "right", // "right" | "left" | "up" | "down"
                        //   Richtung, in die der Wire den Connector verlässt
    minLength: 20       // number  – Mindestlänge des ersten Wire-Segments
                        //   bevor abgebogen werden darf (px)
  },
  // ...
]
```

**Darstellung:** Jeder Connector wird als Kreis in `connectorColor` an der angegebenen Position gezeichnet.

---

### Connections

```js
wiring.setConnections(connections);
```

`connections` ist ein Array von Connection-Objekten:

```js
[
  {
    id:   "W1", // string – eindeutige ID (Pflicht)
    from: "C1", // string – Connector-ID des Startpunkts
    to:   "C2"  // string – Connector-ID des Endpunkts
  },
  // ...
]
```

---

### Sperrbereiche

```js
wiring.setBlockedAreas(areas);
```

`areas` ist ein Array von `HTMLElement`-Objekten (typischerweise `<div>`-Elemente), die die Sperrbereiche im DOM repräsentieren:

```js
[
  document.getElementById('bauteil-a'),
  document.getElementById('bauteil-b'),
  // ...
]
```

Position und Größe jedes Elements werden erst bei `render()` aus dem DOM ausgelesen — über `getBoundingClientRect()` des Elements abzüglich `getBoundingClientRect()` des Containers. Damit ergibt sich automatisch das containerlokale Koordinatensystem (`0 / 0` = linke obere Ecke des Containers). Bewegt sich ein Element zwischen `setBlockedAreas()` und `render()`, wird die aktuelle Position zum Zeitpunkt von `render()` verwendet.

Die Elemente müssen zum Zeitpunkt von `render()` im DOM und sichtbar sein (nicht `display: none` o. Ä.), da `getBoundingClientRect()` sonst `width` / `height` von `0` zurückgibt, was zu einem Fehler führt (siehe Fehlerverhalten unten).

Wires dürfen die so ermittelten Bereiche nicht schneiden. Das Routing muss außen herum erfolgen. Bei mehreren möglichen Umwegen wird der kürzere bevorzugt.

---

### Rendering

```js
wiring.render();
```

Berechnet alle Wire-Pfade und zeichnet sie in den Container. Räumt vor dem Zeichnen automatisch vorherige Inhalte ab (implizites `clear()`).

`render()` akzeptiert optional alle drei Datensätze direkt als Shortcut — equivalent zum vorherigen Aufruf der einzelnen Setter:

```js
wiring.render(connectors, connections, [divA, divB]);
```

Werden Argumente übergeben, überschreiben sie den zuletzt per Setter gesetzten Zustand. Nicht übergebene Argumente (`undefined`) lassen den bestehenden Zustand unverändert. Die Fehlerprüfung ist identisch mit den Settern.

```js
wiring.clear();
```

Entfernt alle gezeichneten Elemente aus dem Container, ohne den internen Zustand (Connectoren, Connections, Sperrbereiche) zu löschen.

---

## Fehlerverhalten

Die Bibliothek unterscheidet zwei Schweregrade:

**`Error` (Abbruch):** Liegt eine Eingabe vor, die eine korrekte Ausführung grundsätzlich unmöglich macht — falsche Typen, fehlende Pflichtfelder, logische Widersprüche in den Daten, oder ein nicht auflösbares Routing-Problem — wird die Ausführung mit `throw new Error()` abgebrochen. Stille Fehler oder Fallbacks sind nicht vorgesehen.

**`console.warn()` (Warnung):** Liegt eine Situation vor, die möglicherweise ein Konfigurationsfehler ist, das Rendering aber trotzdem sinnvoll fortgesetzt werden kann, wird eine Warnung ausgegeben ohne abzubrechen. Der Nutzer wird informiert, das Ergebnis kann jedoch von den Erwartungen abweichen.

### Ungültige Eingaben bei `setConnectors()`

| Fehlerfall | Fehlermeldung |
|---|---|
| `id` fehlt oder kein String | `ElectricalWire: connector at index {i} is missing a valid "id".` |
| Doppelte Connector-ID | `ElectricalWire: duplicate connector id "{id}".` |
| `x` oder `y` kein Number | `ElectricalWire: connector "{id}" has invalid coordinates.` |
| `direction` kein gültiger Wert | `ElectricalWire: connector "{id}" has invalid direction "{value}". Use "right", "left", "up" or "down".` |
| `minLength` kein Number ≥ 0 | `ElectricalWire: connector "{id}" has invalid minLength.` |

### Ungültige Eingaben bei `setConnections()`

| Fehlerfall | Fehlermeldung |
|---|---|
| `id` fehlt oder kein String | `ElectricalWire: connection at index {i} is missing a valid "id".` |
| Doppelte Connection-ID | `ElectricalWire: duplicate connection id "{id}".` |
| `from` oder `to` referenziert unbekannte Connector-ID | `ElectricalWire: connection "{id}" references unknown connector "{connectorId}".` |
| `from` === `to` | `ElectricalWire: connection "{id}" connects a connector to itself.` |

### Ungültige Eingaben bei `setBlockedAreas()`

| Fehlerfall | Fehlermeldung |
|---|---|
| Ein Eintrag ist kein `HTMLElement` | `ElectricalWire: blocked area at index {i} is not an HTMLElement.` |

### Fehler bei `render()` durch Sperrbereiche

Die DOM-Abmessungen werden erst bei `render()` ausgelesen. Ungültige Zustände zu diesem Zeitpunkt werden ebenfalls als `Error` behandelt:

| Fehlerfall | Fehlermeldung |
|---|---|
| Ein Sperrbereich-Element hat `width` oder `height` 0 (nicht im DOM / `display: none`) | `ElectricalWire: blocked area at index {i} has zero dimensions. Ensure the element is visible in the DOM.` |

### Warnungen bei `render()`

Warnungen werden über `console.warn()` ausgegeben und unterbrechen das Rendering nicht. Sie betreffen Situationen, die zwar ungewöhnlich sind, aber ein fortgesetztes Rendering noch erlauben.

| Warnfall | Warnmeldung |
|---|---|
| Ein Connector liegt innerhalb eines Sperrbereichs | `ElectricalWire: connector "{id}" lies within a blocked area. Routing may be impossible.` |
| Der Exitpunkt eines Connectors (nach minLength) liegt innerhalb eines Sperrbereichs, der Connector selbst aber nicht | `ElectricalWire: connector "{id}" exit point ({x},{y}) lands inside a blocked area. Stub will be extended in direction "{direction}" until clear.` |
| Container hat keinen Positionierungskontext | `ElectricalWire: container has no CSS positioning context (position is "static"). Set position to "relative", "absolute" or "fixed".` |

Liegt ein Connector innerhalb eines Sperrbereichs, wird der Stromkreis trotzdem gezeichnet. Der Wire durchquert den Sperrbereich auf dem direkten Stub-Korridor (`minLength` Pixel in `direction`), bevor das normale Routing ab dem Austrittspunkt fortgesetzt wird. Das Routing-Ergebnis kann je nach Lage des Sperrbereichs ungewöhnlich aussehen.

### Fehler bei `render()`

| Fehlerfall | Fehlermeldung |
|---|---|
| Container hat Breite oder Höhe 0 | `ElectricalWire: container has no dimensions (width or height is 0). Set an explicit size before calling render().` |
| `setConnectors()` wurde nicht aufgerufen | `ElectricalWire: render() called before setConnectors().` |
| `setConnections()` wurde nicht aufgerufen | `ElectricalWire: render() called before setConnections().` |
| `setBlockedAreas()` wurde nicht aufgerufen | `ElectricalWire: render() called before setBlockedAreas().` |
| Kein Pfad für eine Connection gefunden | `ElectricalWire: no path found for connection "{id}" (from "{fromId}" to "{toId}"). Check blocked areas.` |

---

## Routing-Verhalten

### Orthogonales Routing

Alle Wires verlaufen ausschließlich horizontal oder vertikal. Diagonale Segmente sind nicht erlaubt.

### Mindestaustrittslänge

Jeder Connector definiert eine `direction` und eine `minLength`. Der Wire muss zunächst mindestens `minLength` Pixel in die angegebene Richtung verlaufen, bevor er abbiegen darf.

Die `minLength`-Anforderung gilt **immer** — auch wenn der Connector innerhalb eines Sperrbereichs liegt. Der Stub-Korridor (direkte Strecke von der Connector-Position in `direction`, genau `minLength` Pixel lang) wird als feste Gerade gezeichnet und kann dabei einen Sperrbereich durchqueren.

Liegt der Exitpunkt nach `minLength` noch innerhalb eines Sperrbereichs, verlässt der Wire diesen auf dem **kürzesten Weg** (minimale Gitterschritte bis zur ersten freien Zelle). Dabei ist die Richtung zurück durch den Stub (`OPPOSITE[direction]`) ausgeschlossen — der Escape geht immer nach vorne oder seitwärts. Dieser Escape-Abschnitt wird zusammen mit dem Stub in `stubColor` gezeichnet. Erst nach dem Escape beginnt das normale A\*-Routing.

### Stub-Exklusivität

Kein Wire eines anderen Stromkreises darf den Stub oder den Escape-Abschnitt eines Connectors kreuzen oder überlagern. Der gesamte Korridor von der Connector-Position bis zum Ende des Escape-Abschnitts (`actualStart`) wird für alle A\*-Aufrufe als nicht begehbar markiert.

### Sperrbereichs-Umgehung

Schneidet ein berechneter Pfad einen Sperrbereich, wird er außen herumgeführt. Grundlage ist ein A\*-Algorithmus auf einem achsenparallelen Routing-Grid mit der Schrittweite `gridSize`. Zellen innerhalb von Sperrbereichen werden als nicht begehbar markiert.

Überlappen sich mehrere Sperrbereiche, gilt die Vereinigung aller Bereiche als gesperrte Zone — kein Wire-Segment darf durch irgendeinen der beteiligten Bereiche verlaufen.

Kann für eine Connection kein gültiger Pfad gefunden werden (z. B. weil ein Connector vollständig von Sperrbereichen umschlossen ist), wirft die Bibliothek einen Fehler:

```js
throw new Error(`ElectricalWire: no path found for connection "${connectionId}" (from "${fromId}" to "${toId}"). Check blocked areas.`);
```

### Eckenminimierung

Der Router minimiert die **Anzahl der Richtungswechsel** (Ecken) eines Wires als sekundäres Optimierungsziel. Die Priorität ist:

1. **Gültiger Pfad** – keine Sperrbereichsverletzungen (Pflicht).
2. **Kürzeste Gesamtlänge** – minimale Summe der Segmentlängen in Manhattan-Metrik.
3. **Wenigste Ecken** – bei gleicher oder geringfügig längerer Strecke wird der Pfad mit weniger Richtungswechseln bevorzugt.

Technisch wird dies durch einen **Abbiegekosten**-Term in der A\*-Kostenfunktion umgesetzt: Jeder Richtungswechsel gegenüber dem vorherigen Schritt erhöht die Pfadkosten um einen festen Betrag. Die Abbiegekosten müssen kleiner sein als die Kosten einer einzelnen Gridzelle, damit ein kurzer Umweg mit weniger Ecken gegenüber einem kürzeren Pfad mit mehr Ecken nicht bevorzugt wird, wenn der Längenunterschied groß ist.

Da A\* die Richtung des vorangehenden Schritts kennen muss, arbeitet der Algorithmus intern mit **richtungserweiterten Knoten** `(x, y, direction)` statt nur mit `(x, y)`. Zwei Knoten an derselben Gitterzelle, aber mit unterschiedlicher Anflugrichtung, sind damit eigenständige Zustände mit möglicherweise unterschiedlichen Gesamtkosten.

---

## Stromkreis-Logik

### Erkennung

Ein Stromkreis besteht aus mindestens einem Wire (1+x). Jede Connection bildet zunächst einen eigenen Stromkreis. Teilen sich zwei oder mehr Connections mindestens einen Connector, werden ihre Stromkreise transitiv zusammengeführt.

**Beispiel:**
```
W1: C1 → C2              →  Netz A: {C1, C2}        (Einzelverbindung = Stromkreis)
W2: C2 → C3              →  Netz A: {C1, C2, C3}    (W2 teilt C2 mit W1 → Zusammenführung)
W3: C4 → C5              →  Netz B: {C4, C5}        (eigenständiger Stromkreis)
```

### Routing bei Stromkreisen (Steiner-Baum-Näherung)

Die `from`/`to`-Angaben der Connections definieren, welche Connectoren zum selben Stromkreis gehören. Das tatsächliche Routing wird jedoch **nicht** Connection für Connection durchgeführt — stattdessen berechnet die Bibliothek für den gesamten Stromkreis ein optimiertes Leitungsnetz nach dem Steinerbaum-Prinzip:

- Die Connectoren des Stromkreises sind die **Terminale** (Pflichtpunkte im Netz).
- Die Bibliothek darf zusätzliche **Kreuzungsknoten** (Steinerpunkte) einfügen, wo diese die Gesamtlänge aller Wires reduzieren.
- Das Ergebnis ist ein Baum, der alle Terminale mit minimaler Gesamtleitungslänge verbindet.
- Die originalen `from`/`to`-Pfade werden durch dieses optimierte Netz ersetzt.

Da der exakte Steinerbaum in der Manhattan-Metrik NP-schwer ist, wird eine Näherung verwendet: Kandidaten für Kreuzungsknoten sind die Schnittpunkte der horizontalen und vertikalen Achsen aller Connectoren des Netzes. Jeder Kandidat wird einzeln ausprobiert; gewählt wird derjenige Steinerpunkt, der die **kürzeste Gesamtlänge aller Wires des Stromkreises** ergibt. Reduziert kein Kandidat die Gesamtlänge, wird kein Kreuzungsknoten eingefügt.

### Darstellung von Kreuzungsknoten

Jeder vom Algorithmus eingefügte Steinerpunkt wird als **schwarzer Punkt** gezeichnet (Radius `junctionRadius`). Kreuzungen zwischen Wires verschiedener Stromkreise erhalten keinen schwarzen Punkt.

---

## Hover-Interaktion

### Stromkreis-Highlight bei Wire-Hover

Bewegt der Nutzer die Maus über einen Wire, wird der **gesamte Stromkreis**, zu dem dieser Wire gehört, visuell hervorgehoben:

- Alle Wires des Stromkreises wechseln die Farbe auf `hoverColor`.
- Alle Connectoren des Stromkreises wechseln ihre Füllfarbe auf `hoverColor`.
- Beim Verlassen des Wires (`mouseleave`) kehren alle Elemente zur Ursprungsfarbe zurück.

Die Trefferzone eines Wires für den Hover-Effekt ist breiter als die gezeichnete Linie. Technisch wird ein zweites SVG-`<path>`-Element mit identischem Pfad, breiterem `stroke-width` (empfohlen: mindestens 8 px) und `opacity: 0` über die gezeichnete Linie gelegt. Dieses Element ist visuell unsichtbar, aber für Mausereignisse aktiv.

Jedem SVG-Wire-Element und jedem SVG-Connector-Element wird das Attribut `data-net-id` mit den kommaseparierten Connection-IDs aller Connections des zugehörigen Stromkreises mitgegeben (z. B. `data-net-id="W1,W2,W3"`), damit die Highlight-Logik alle zugehörigen Elemente per Selektor finden kann.

---

## Darstellungsregeln (Zusammenfassung)

| Element | Darstellung |
|---|---|
| Wire | Orthogonale Linie, Farbe `wireColor`, Breite `wireWidth` |
| Stub (minLength + Escape) | Overlay auf dem Wire in Farbe `stubColor` (Default: Blau `#2563eb`), gleiche Breite wie Wire |
| Wire (Hover, ganzer Stromkreis) | Farbe wechselt zu `hoverColor` (gilt auch für Stubs) |
| Connector | Kreis, Farbe `connectorColor`, Radius `connectorRadius` |
| Connector (Hover, ganzer Stromkreis) | Füllfarbe wechselt zu `hoverColor` |
| Kreuzungsknoten | Schwarzer Punkt, Farbe `#000`, Radius `junctionRadius` |
| Sperrbereich | Hellgrau (`#eee`, Deckkraft 50 %), nur wenn `showBlockedAreas: true` |

---

## Testfälle — test.html

Die Datei `test.html` liegt im selben Verzeichnis wie `electricalWire.js` und bindet sie direkt ein. Sie enthält mehrere unabhängige Testszenarien, jedes in einem eigenen beschrifteten `<div>`-Container mit fester Größe.

### Szenario 1 – Einfache Punkt-zu-Punkt-Verbindung
Zwei Connectoren mit unterschiedlichen Richtungen, eine Connection. Prüft: korrektes orthogonales Routing, Mindestaustrittslänge wird eingehalten.

### Szenario 2 – Mehrere unabhängige Connections
Vier Connectoren, zwei separate Connections ohne gemeinsame Connectoren (zwei unabhängige Netze). Prüft: keine versehentliche Netz-Zusammenführung, Hover hebt nur den jeweils betroffenen Stromkreis hervor.

### Szenario 3 – Stromkreis mit drei Connectoren
Drei Connectoren, verbunden durch `W1: C1→C2` und `W2: C2→C3`. Prüft: Netz-Erkennung, Steiner-Routing ersetzt die originalen Pfade durch das kürzeste Gesamtnetz, Hover färbt alle drei Connectoren und alle Wires um.

### Szenario 4 – Stromkreis mit Kreuzungsknoten
Vier Connectoren so platziert, dass ein Steinerpunkt die Gesamtlänge reduziert (z. B. Stern-Topologie). Prüft: Kreuzungsknoten wird als schwarzer Punkt eingefügt und gezeichnet, Wires zwischen verschiedenen Stromkreisen die sich kreuzen erhalten keinen schwarzen Punkt.

### Szenario 5 – Sperrbereich-Umgehung
Ein `<div>` liegt direkt auf dem direkten Pfad zwischen zwei Connectoren. `showBlockedAreas: true`. Prüft: Wire umgeht den Bereich, kein Segment verläuft durch ihn hindurch. Die Sperrbereich-Koordinaten werden korrekt aus der DOM-Position des Divs relativ zum Container berechnet.

### Szenario 6 – Kombiniert (Stromkreis + Sperrbereich)
Mehrere Netze, darunter eines mit ≥ 3 Connectoren, plus ein Sperrbereich-Div, der einen der Routing-Pfade zwingt umzuweichen. Prüft das Zusammenspiel aller Features.

### Szenario 7 – Alle Connector-Richtungen
Je ein Connector mit `direction: "right"`, `"left"`, `"up"`, `"down"`, alle verbunden in einem Stern. Prüft: Mindestaustrittslänge in jede Richtung korrekt.

### Szenario 8 – Connector innerhalb eines Sperrbereichs
Ein Connector liegt vollständig innerhalb eines Sperrbereich-Divs. `showBlockedAreas: true`. Prüft: `console.warn()` für den Connector wird ausgegeben; der Stub endet nach exakt `minLength` Pixeln noch innerhalb des Sperrbereichs; der Router verlässt den Sperrbereich auf dem kürzesten Weg (ohne Rücklauf durch den Stub); Stub und Escape werden blau gezeichnet; kein anderer Wire kann durch den Stub oder Escape-Abschnitt laufen.

### Szenario 9 – Connectoren an der Sperrbereichsgrenze (Testcase 1)
Beide Connector-Positionen liegen genau auf der Grenze je eines Sperrbereichs (je eine `console.warn()`). Die Exitpunkte nach `minLength` liegen jedoch bereits außerhalb der Sperrbereiche — kein Escape nötig, das Routing läuft normal ab den Exitpunkten. Rekonstruiert aus testcase_1.txt.

### Szenario 10 – Eckenminimierung
Zwei Connectoren mit diagonalem Versatz (C1 right, C2 left). Zwischen den Exitpunkten gibt es viele gleichlange Pfade — einer mit 2 Ecken (L-Form), viele mit mehr Ecken (Zickzack). Prüft: der Router wählt die L-Form. Außerdem ein Fall, bei dem ein Pfad mit mehr Länge aber weniger Ecken existiert: der kürzere Pfad muss bevorzugt werden (Länge hat Vorrang).

### Szenario 11 – Exitpunkt im Sperrbereich, Connector außerhalb
Ein Connector liegt knapp außerhalb eines Sperrbereichs, aber `minLength` schiebt den Exitpunkt hinein. Prüft: keine `console.warn()` für den Connector selbst; stattdessen `console.warn()` für den Exitpunkt; Stub endet im Sperrbereich; Escape geht auf dem kürzesten Weg heraus, nicht zurück durch den Stub; Stub + Escape werden blau gezeichnet; der Escape-Abschnitt ist für alle anderen Wires gesperrt.


## Logging

Die Bibliothek besitzt ein integriertes Debug-Logging zur Analyse des Routing-Verhaltens im Browser-Debugger (Chrome DevTools). Das Logging wird über die Option `logging` (Default: `true`) aktiviert oder deaktiviert. Es erfolgt ausschließlich über `console.log()` und dient dazu, Routing-Probleme ohne Screenshots reproduzierbar analysieren zu können.

### Geloggte Informationen

Wenn `logging: true` gesetzt ist, schreibt die Bibliothek strukturierte Informationen über den gesamten Routing-Prozess in die Browser-Konsole:

- Initialisierungsdaten und verwendete Optionen
- Containergröße
- Connectoren
- Connections
- Sperrbereiche
- erkannte Stromkreise (Netze)
- Routing-Start jeder Connection bzw. jedes Stromkreises
- verwendete Gridgröße und Abbiegekosten
- berechnete Austrittspunkte der Connectoren
- Pfadfindungsschritte des Routers
- blockierte Routing-Zellen
- gefundene oder verworfene Pfade
- erkannte Kreuzungen
- eingefügte Kreuzungsknoten (Steinerpunkte)
- finale Wire-Segmente
- Gesamtlänge des berechneten Netzes
- Warnungen (`console.warn()`)
- Fehler unmittelbar vor `throw new Error(...)`

### Anforderungen an die Ausgabe

Die Logs müssen so strukturiert sein, dass ein vollständiger Routing-Vorgang allein anhand der Konsolenausgabe nachvollzogen werden kann.

Die Ausgabe soll kompakt, aber eindeutig lesbar sein. Größere Datenstrukturen (z. B. Pfadlisten oder Grid-Zellen) dürfen als Objekte oder Arrays direkt an `console.log()` übergeben werden.

### Beispiel

```js
console.log("[ElectricalWire] Routing net", {
  netId: "W1,W2",
  connectors: ["C1", "C2", "C3"]
});

console.log("[ElectricalWire] A* path found", {
  connectionId: "W1",
  pathLength: 380,
  segments: [...]
});
```

## codestyle
- die export werden gesammelt am ende des files exportiert
- es gibt ein electricalWire_API.md, kein jsdoc

---

## Nicht im Scope (v1)

- Animationen
- Interaktivität (Drag & Drop, Klick-Events auf Wires)
- Gerundete Wire-Ecken
- Automatische Erkennung von Bauteil-Geometrien (Bibliothek ist layout-agnostisch)