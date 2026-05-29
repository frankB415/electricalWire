# electricalWire.js — API-Dokumentation

## Einbindung

```html
<script type="module">
  import ElectricalWire from './electricalWire.js';
</script>
```

Kein Bundler erforderlich. Die Datei wird als natives ES-Modul geladen.

---

## Schnellstart

```js
import ElectricalWire from './electricalWire.js';

const container = document.getElementById('schaltplan');

const wiring = new ElectricalWire(container, { wireColor: '#003', hoverColor: '#e67e00' });

wiring.render(
  [
    { id: 'C1', x: 50,  y: 100, direction: 'right', minLength: 20 },
    { id: 'C2', x: 300, y: 100, direction: 'left',  minLength: 20 },
    { id: 'C3', x: 300, y: 200, direction: 'left',  minLength: 20 },
  ],
  [
    { id: 'W1', from: 'C1', to: 'C2' },
    { id: 'W2', from: 'C2', to: 'C3' },
  ],
  []
);
```

---

## Voraussetzungen für den Container

```css
#schaltplan {
  position: relative; /* oder absolute / fixed */
  width: 600px;
  height: 400px;
}
```

- Der Container muss **explizite Dimensionen** haben (`width` und `height` ≠ 0).
- Der Container muss einen **CSS-Positionierungskontext** haben (`position` ≠ `static`).
- Alle `x`/`y`-Koordinaten beziehen sich auf die **linke obere Ecke des Containers** (`0 / 0`).

---

## Konstruktor

```js
new ElectricalWire(container, options?)
```

| Parameter   | Typ           | Pflicht | Beschreibung                                     |
|-------------|---------------|---------|--------------------------------------------------|
| `container` | `HTMLElement` | ✓       | Das div, in das gezeichnet wird.                 |
| `options`   | `Object`      | –       | Optionale Konfiguration (siehe unten). Unbekannte Keys werden ignoriert. |

### options

| Eigenschaft       | Typ       | Default      | Beschreibung                                                  |
|-------------------|-----------|--------------|---------------------------------------------------------------|
| `gridSize`        | `number`  | `10`         | Rastergröße in px für den A\*-Router.                         |
| `wireColor`       | `string`  | `"#1a1a1a"`  | Farbe der Wires.                                              |
| `wireWidth`       | `number`  | `2`          | Linienstärke der Wires in px.                                 |
| `connectorRadius` | `number`  | `5`          | Radius der Connector-Kreise in px.                            |
| `connectorColor`  | `string`  | `"#e00"`     | Füllfarbe der Connector-Kreise.                               |
| `junctionRadius`  | `number`  | `4`          | Radius der Kreuzungsknoten-Punkte in px.                      |
| `showBlockedAreas`| `boolean` | `false`      | Sperrbereiche als hellgraue Fläche einzeichnen (Debugging).   |
| `hoverColor`      | `string`  | `"#e67e00"`  | Farbe beim Hover über einen Wire (ganzer Stromkreis).         |

---

## Methoden

### `setConnectors(connectors)`

Setzt die Liste der Anschlusspunkte. Muss vor `render()` aufgerufen werden (oder direkt an `render()` übergeben werden).

```js
wiring.setConnectors([
  { id: 'C1', x: 100, y: 150, direction: 'right', minLength: 20 },
  { id: 'C2', x: 300, y: 150, direction: 'left',  minLength: 20 },
]);
```

**Connector-Objekt:**

| Eigenschaft  | Typ      | Pflicht | Beschreibung                                                              |
|--------------|----------|---------|---------------------------------------------------------------------------|
| `id`         | `string` | ✓       | Eindeutige ID.                                                            |
| `x`          | `number` | ✓       | X-Position relativ zur linken oberen Ecke des Containers (px).            |
| `y`          | `number` | ✓       | Y-Position relativ zur linken oberen Ecke des Containers (px).            |
| `direction`  | `string` | ✓       | Richtung, in die der Wire den Connector verlässt: `"right"` \| `"left"` \| `"up"` \| `"down"`. |
| `minLength`  | `number` | ✓       | Mindestlänge des ersten Wire-Segments in px, bevor abgebogen werden darf. Muss ≥ 0 sein. |

---

### `setConnections(connections)`

Setzt die logischen Verbindungen zwischen Connectoren.

```js
wiring.setConnections([
  { id: 'W1', from: 'C1', to: 'C2' },
]);
```

**Connection-Objekt:**

| Eigenschaft | Typ      | Pflicht | Beschreibung                          |
|-------------|----------|---------|---------------------------------------|
| `id`        | `string` | ✓       | Eindeutige ID.                        |
| `from`      | `string` | ✓       | ID eines Connectors (Startpunkt).     |
| `to`        | `string` | ✓       | ID eines Connectors (Endpunkt).       |

`from` und `to` müssen auf existierende Connector-IDs verweisen und dürfen nicht identisch sein. Die Referenzprüfung erfolgt bei `render()`.

---

### `setBlockedAreas(areas)`

Setzt rechteckige Sperrbereiche, durch die keine Wires geführt werden dürfen.

```js
wiring.setBlockedAreas([
  { x: 150, y: 80, width: 120, height: 100 },
]);
```

Leeres Array `[]` ist gültig (keine Sperrbereiche).

**Sperrbereich-Objekt:**

| Eigenschaft | Typ      | Pflicht | Beschreibung                                 |
|-------------|----------|---------|----------------------------------------------|
| `x`         | `number` | ✓       | X-Position der linken oberen Ecke (px).      |
| `y`         | `number` | ✓       | Y-Position der linken oberen Ecke (px).      |
| `width`     | `number` | ✓       | Breite in px. Muss > 0 sein.                 |
| `height`    | `number` | ✓       | Höhe in px. Muss > 0 sein.                   |

Überlappende Sperrbereiche werden als Vereinigung behandelt — kein Wire-Segment darf irgendeinen der Bereiche schneiden.

---

### `render(connectors?, connections?, blockedAreas?)`

Berechnet alle Wire-Pfade und zeichnet sie in den Container. Räumt vorherige Inhalte automatisch ab.

```js
// Variante A – Setter vorher aufrufen
wiring.setConnectors(connectors);
wiring.setConnections(connections);
wiring.setBlockedAreas([]);
wiring.render();

// Variante B – Shortcut: alles direkt an render() übergeben
wiring.render(connectors, connections, []);

// Variante C – nur einen Datensatz aktualisieren
wiring.render(undefined, newConnections, undefined);
```

Wird ein Argument als `undefined` übergeben, bleibt der zuletzt per Setter gesetzte Zustand unverändert.

---

### `clear()`

Entfernt alle gezeichneten SVG-Elemente aus dem Container. Der interne Zustand (Connectoren, Connections, Sperrbereiche) bleibt erhalten. Ein erneutes `render()` zeichnet alles neu.

```js
wiring.clear();
```

---

## Stromkreise

Connections, die mindestens einen Connector teilen, werden transitiv zu einem **Stromkreis** (Netz) zusammengefasst. Jede einzelne Connection bildet bereits einen Stromkreis.

```
W1: C1 → C2  }
W2: C2 → C3  }  → Stromkreis A: {C1, C2, C3}

W3: C4 → C5     → Stromkreis B: {C4, C5}
```

Für Stromkreise mit ≥ 3 Connectoren berechnet die Bibliothek automatisch das kürzeste Leitungsnetz (Steiner-Baum-Näherung). Die `from`/`to`-Angaben der Connections definieren nur die Netzzugehörigkeit — das tatsächliche Routing kann davon abweichen.

---

## Kreuzungsknoten

Bei Stromkreisen mit ≥ 3 Connectoren kann die Bibliothek einen **Kreuzungsknoten** (Steinerpunkt) einfügen, wenn dies die Gesamtlänge aller Wires des Stromkreises reduziert. Der Punkt wird als schwarzer Kreis (Radius `junctionRadius`) gezeichnet.

Kreuzungen zwischen Wires **verschiedener** Stromkreise erhalten keinen schwarzen Punkt.

---

## Hover-Interaktion

Beim Hovern über einen Wire wird der **gesamte zugehörige Stromkreis** hervorgehoben:

- Alle Wires des Stromkreises wechseln auf `hoverColor`.
- Alle Connectoren des Stromkreises wechseln auf `hoverColor`.
- Beim Verlassen (`mouseleave`) kehren alle Elemente zur Ursprungsfarbe zurück.

---

## SVG-Struktur

Die Bibliothek erzeugt folgende SVG-Elemente im Container:

```
<svg>
  <!-- Sperrbereiche (optional, showBlockedAreas: true) -->
  <rect class="ew-blocked" … />

  <!-- Pro Stromkreis -->
  <g class="ew-net" data-net-id="W1,W2">
    <path class="ew-wire"     data-net-id="W1,W2" … />   <!-- sichtbarer Wire -->
    <path class="ew-wire-hit" data-net-id="W1,W2" … />   <!-- breite Hit-Zone (opacity:0) -->
    <circle class="ew-junction" data-net-id="W1,W2" … /> <!-- Kreuzungsknoten (optional) -->
  </g>

  <!-- Connectoren (über Wires gezeichnet) -->
  <circle class="ew-connector" data-net-id="W1,W2" … />
</svg>
```

### `data-net-id`

Jedes Wire-, Connector- und Junction-Element trägt das Attribut `data-net-id` mit den kommaseparierten Connection-IDs des zugehörigen Stromkreises, z. B. `data-net-id="W1,W2,W3"`. Damit lassen sich alle Elemente eines Stromkreises von außen selektieren:

```js
svg.querySelectorAll('[data-net-id="W1,W2"]');
```

---

## Fehlerverhalten

**`Error` (Abbruch)** bei strukturell ungültigen Eingaben oder nicht lösbarem Routing:

| Wo               | Fehlerfall                                          | Meldung |
|------------------|-----------------------------------------------------|---------|
| `setConnectors`  | `id` fehlt oder kein String                         | `connector at index {i} is missing a valid "id".` |
| `setConnectors`  | Doppelte Connector-ID                               | `duplicate connector id "{id}".` |
| `setConnectors`  | `x` oder `y` kein Number                           | `connector "{id}" has invalid coordinates.` |
| `setConnectors`  | `direction` ungültig                                | `connector "{id}" has invalid direction "{value}". Use "right", "left", "up" or "down".` |
| `setConnectors`  | `minLength` kein Number ≥ 0                         | `connector "{id}" has invalid minLength.` |
| `setConnections` | `id` fehlt oder kein String                         | `connection at index {i} is missing a valid "id".` |
| `setConnections` | Doppelte Connection-ID                              | `duplicate connection id "{id}".` |
| `setConnections` | `from`/`to` verweist auf unbekannte Connector-ID    | `connection "{id}" references unknown connector "{connectorId}".` |
| `setConnections` | `from === to`                                       | `connection "{id}" connects a connector to itself.` |
| `setBlockedAreas`| Fehlende oder nicht-numerische Dimension            | `blocked area at index {i} has invalid dimensions.` |
| `setBlockedAreas`| `width` oder `height` ≤ 0                          | `blocked area at index {i} has non-positive width or height.` |
| `render`         | `setConnectors` nicht aufgerufen                    | `render() called before setConnectors().` |
| `render`         | `setConnections` nicht aufgerufen                   | `render() called before setConnections().` |
| `render`         | `setBlockedAreas` nicht aufgerufen                  | `render() called before setBlockedAreas().` |
| `render`         | Container hat Breite oder Höhe 0                    | `container has no dimensions (width or height is 0). Set an explicit size before calling render().` |
| `render`         | Kein Pfad für eine Connection gefunden              | `no path found for connection "{id}" (from "{fromId}" to "{toId}"). Check blocked areas.` |

Alle Meldungen haben das Präfix `ElectricalWire: `.

**`console.warn()` (Warnung, Rendering wird fortgesetzt):**

| Warnfall                                    | Meldung |
|---------------------------------------------|---------|
| Connector liegt innerhalb eines Sperrbereichs | `connector "{id}" lies within a blocked area. Routing may be impossible.` |
| Container hat `position: static`            | `container has no CSS positioning context (position is "static"). Set position to "relative", "absolute" or "fixed".` |

Liegt ein Connector im Sperrbereich, verlässt der Wire den Bereich auf dem kürzesten orthogonalen Weg. Die `minLength`-Anforderung gilt erst ab dem Punkt, an dem der Wire den Sperrbereich verlassen hat.
