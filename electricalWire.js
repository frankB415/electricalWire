// electricalWire.js – Einbindung via <script src="electricalWire.js"> → window.ElectricalWire
// ES-Modul:           import { ElectricalWire } from './electricalWire.module.js'

const DEFAULTS = {
  gridSize:        10,
  wireColor:       '#1a1a1a',
  wireWidth:       2,
  connectorRadius: 5,
  connectorColor:  '#e00',
  junctionRadius:  4,
  showBlockedAreas:    false,
  showConnectorLabels: true,
  showBlockLabels:     true,
  hoverColor:      '#e67e00',
  logging:         true,
  // Reiner Text-Dump (Sperrbereiche/Connectoren/Connections dieser Instanz) am
  // Ende von render(), siehe dumpTestCase(). Bewusst UNABHAENGIG von "logging":
  // dieser Dump zeichnet nichts und ist kein Routing-Rauschen, sondern die
  // Grundlage fuer reproduzierbare Testszenarien -- soll daher auch dann an
  // bleiben, wenn "logging" (die verbose Routing-Logs) aus ist.
  logTestCase:     true,
  // Optionaler Bezeichner fuer die Konsolen-Ausgabe von dumpTestCase(), nuetzlich
  // wenn mehrere Instanzen denselben Container teilen (z.B. "currentConn"/"controlConn").
  label:           '',
};

function snapToGrid(val, grid) { return Math.round(val / grid) * grid; }
function manhattanDist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

class UnionFind {
  constructor() { this.parent = {}; this.rank = {}; }
  add(id) { if (!(id in this.parent)) { this.parent[id] = id; this.rank[id] = 0; } }
  find(id) {
    if (this.parent[id] !== id) this.parent[id] = this.find(this.parent[id]);
    return this.parent[id];
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

const DIR_VEC = {
  right: { dx: 1, dy: 0 }, left: { dx: -1, dy: 0 },
  up:    { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }
};

function getExitPoint(conn, gridSize) {
  const { x, y, direction, minLength } = conn;
  if (!minLength || minLength <= 0) return { x, y };
  const v = DIR_VEC[direction];
  return { x: snapToGrid(x + v.dx * minLength, gridSize), y: snapToGrid(y + v.dy * minLength, gridSize) };
}

// Der Eintrittspunkt eines Connectors entspricht seinem Austrittspunkt: Der Wire
// erreicht einen Connector stets entlang seiner eigenen `direction`, unabhängig
// davon, ob er `from` oder `to` ist. Die minLength gilt dabei immer – auch wenn
// der Connector innerhalb eines Sperrbereichs liegt.
function getEntryPoint(conn, gridSize) {
  return getExitPoint(conn, gridSize);
}

// Der Labeltext zeigt nur die Pin-Nummer, nicht den vollen Connector-Namen:
// bei der ueblichen Konvention "ElementName:PinNummer" (z.B. "R1001:1") reicht
// am Connector selbst die Nummer nach dem letzten ":" - der Elementname steht
// ohnehin schon einmal am Block. Das haelt den Labeltext kurz, was bei eng
// benachbarten Connectoren (z.B. mehrere Pins auf derselben Elementseite)
// Ueberlappungen von vornherein vermeidet. IDs ohne ":" (synthetische Test-IDs
// wie "C1", "R", "L") werden unveraendert komplett angezeigt.
function connectorLabelText(c) {
  const i = c.id.lastIndexOf(':');
  return i === -1 ? c.id : c.id.slice(i + 1);
}

// Gruppiert Connectoren nach ihrem Element-Praefix (Teil vor dem letzten ":")
// und liefert je Gruppe den Element-Namen plus den Schwerpunkt (Mittelwert)
// aller zugehoerigen Connector-Koordinaten. Der Schwerpunkt dient als Position
// fuer das einmalige Element-Label - bei den ueblichen symmetrisch verteilten
// Connectoren (z.B. je 3 links/rechts) liegt er nahe der Mitte des Blocks,
// analog zur klassischen Refdes-Beschriftung mittig auf dem Bauteilsymbol.
// Connectoren ohne ":" (Einzel-IDs ohne Element/Pin-Trennung) bilden keine
// Gruppe - fuer sie zeigt bereits das Connector-Label selbst die volle ID.
function groupConnectorsByElement(connectors) {
  const groups = new Map();
  for (const c of connectors) {
    const i = c.id.lastIndexOf(':');
    if (i === -1) continue;
    const name = c.id.slice(0, i);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(c);
  }
  const result = [];
  for (const [name, list] of groups) {
    const x = list.reduce((s, c) => s + c.x, 0) / list.length;
    const y = list.reduce((s, c) => s + c.y, 0) / list.length;
    result.push({ name, x, y });
  }
  return result;
}

// Berechnet Position und Textausrichtung des Connector-Labels in Abhängigkeit
// von der Austrittsrichtung, damit das Label immer auf der freien Seite (Stub-
// Seite) liegt statt fix "oberhalb" (was bei down/left/right auf der
// Elementfläche landen würde). Bei allen vier Richtungen wird zusätzlich quer
// zur Stub-Achse versetzt (text-anchor "start"), weil der Wire-Pfad exakt am
// Connector-Punkt beginnt und bei up/down als senkrechte Linie bei x=c.x
// weiterläuft, bei left/right als waagrechte Linie bei y=c.y — eine mittige
// ("middle") Ausrichtung würde das Label direkt auf diese Linie legen.
function connectorLabelAttrs(c, opt) {
  const r = opt.connectorRadius, gap = 2, fontSize = 8.25;
  const base = { 'font-size': String(fontSize), fill: '#333', 'pointer-events': 'none', 'text-anchor': 'start' };
  if (c.direction === 'up')
    return { ...base, x: c.x + gap, y: c.y - r - gap };
  else if (c.direction === 'down')
    return { ...base, x: c.x + gap, y: c.y + r + gap + fontSize };
  else if (c.direction === 'right')
    return { ...base, x: c.x + r + gap, y: c.y - r - gap };
  else // 'left'
    return { ...base, x: c.x - r - gap, y: c.y - r - gap, 'text-anchor': 'end' };
}

// Liegt ein Punkt (Exitpunkt eines Connectors) innerhalb eines Sperrbereichs,
// gibt diese Funktion gerade Korridore in alle 4 Richtungen vom Punkt bis zur
// jeweiligen Sperrbereichsgrenze zurück. Diese Zellen werden in forceFreeCells
// eingetragen, damit A* den kürzesten Weg aus dem Sperrbereich selbst wählen kann.
// Der Stub bleibt dabei immer exakt minLength lang — der Router entscheidet danach frei.
function escapeFreeCells(point, blockedRects, gridSize) {
  const cells = new Set();
  if (!blockedRects.length) return cells;
  const inAny = (p) => blockedRects.some(
    a => p.x >= a.x && p.x <= a.x + a.width && p.y >= a.y && p.y <= a.y + a.height
  );
  if (!inAny(point)) return cells;
  const DIRS_VEC = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dx, dy] of DIRS_VEC) {
    let p = { x: point.x, y: point.y };
    const MAX = 2000;
    for (let i = 0; i < MAX && inAny(p); i++) {
      cells.add(`${snapToGrid(p.x, gridSize) / gridSize},${snapToGrid(p.y, gridSize) / gridSize}`);
      p = { x: snapToGrid(p.x + dx * gridSize, gridSize), y: snapToGrid(p.y + dy * gridSize, gridSize) };
    }
  }
  return cells;
}

function buildBlockedSet(areas, gridSize, gridW, gridH, logger) {
  const blocked = new Set();
  for (const a of areas) {
    const x0 = Math.floor(a.x / gridSize), y0 = Math.floor(a.y / gridSize);
    const x1 = Math.ceil((a.x + a.width) / gridSize), y1 = Math.ceil((a.y + a.height) / gridSize);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++)
        if (gx >= 0 && gy >= 0 && gx <= gridW && gy <= gridH)
          blocked.add(`${gx},${gy}`);
  }
  logger?.('Blocked grid cells', { count: blocked.size, gridW, gridH });
  return blocked;
}

// A* mit richtungserweiterten Zuständen (x, y, dir) zur Eckenminimierung.
//
// Jeder Richtungswechsel gegenüber dem vorangehenden Schritt erhöht die Pfadkosten
// um TURN_COST. TURN_COST > 1 bedeutet: A* bevorzugt aktiv weniger Ecken, auch wenn
// der Pfad dadurch einige Gridzellen länger wird. Konkret: eine Ecke wird vermieden,
// wenn das dadurch entstehende Umweg weniger als TURN_COST Gridzellen kostet.
// Beispiel: TURN_COST=10 → eine Ecke wird gespart, solange der Umweg <10 Zellen ist.
//
// forceFreeCells: Set von "gx,gy"-Schlüsseln, die aus dem Blocked-Set freigegeben
// werden. Ermöglicht A*-Start/Ziel innerhalb eines Sperrbereichs (minLength-Stub).
// startDir: Anflugrichtung am Startpunkt (Connector-Richtung), oder null für
// Steiner-Startpunkte ohne definierte Richtung.

// Binaerer Min-Heap fuer den A*-Open-Set, keyed nach f-Score. Lazy Deletion:
// beim Pop wird geprueft ob der Eintrag noch aktuell ist (fScore stimmt noch
// mit dem beim Push gespeicherten Wert ueberein); veraltete Eintraege
// (durch spaetere guenstigere Updates ueberholt) werden einfach uebersprungen
// statt sie aktiv zu entfernen (kein Decrease-Key noetig).
class MinHeap {
  constructor() { this.arr = []; }
  get size() { return this.arr.length; }
  push(item) {
    const a = this.arr; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.arr;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = 2*i+1, r = 2*i+2; let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]]; i = s;
      }
    }
    return top;
  }
}

function aStarPath(a, b, blockedAreas, gridSize, containerW, containerH, occupiedSegments, logger, label, extraBlocked, forceFreeCells, startDir, occupiedCells, currentNetId) {
  const TURN_COST = 10;  // > 1 → Ecken aktiv vermeiden (Umweg bis 10 Zellen wird akzeptiert)
  // Bewegung entlang eines Segments, das bereits von einem Wire DESSELBEN
  // Netzes belegt ist, kostet nur die Haelfte. Ohne diesen Anreiz ist das
  // Ueberlappen des eigenen Netzes zwar straffrei (keine COLLISION_COST),
  // aber auch anreizfrei - eine parallele Ruecklinie 1-2 Gridzellen neben dem
  // eigenen Trunk kostet dann exakt dasselbe wie das Reiten AUF dem Trunk,
  // und das Tie-Breaking entscheidet zufaellig. Sichtbar in Szenario 20
  // (Ketten-Netze conn2/3, conn8/9, conn14/15: L_xu:1 -> V3AC:n -> L_xl:0,
  // beide Ketten-Enden auf derselben Spalte): die zweite Kante zeichnete eine
  // knapp versetzte Parallel-Linie zurueck - optisch eine geschlossene
  // Schleife ("Kreis"). Mit dem Rabatt kollabiert die Ruecklinie von selbst
  // auf den bestehenden Trunk (identische Pixel, elektrisch derselbe Knoten)
  // und nur der kurze Abzweig zum Ziel bleibt sichtbar.
  const REUSE_COST = 0.5;

  const sx = snapToGrid(a.x, gridSize) / gridSize;
  const sy = snapToGrid(a.y, gridSize) / gridSize;
  const tx = snapToGrid(b.x, gridSize) / gridSize;
  const ty = snapToGrid(b.y, gridSize) / gridSize;
  // gridW/gridH decken auch Exit-Punkte außerhalb des Containers ab.
  const gridW = Math.max(Math.ceil(containerW / gridSize), sx, tx) + 1;
  const gridH = Math.max(Math.ceil(containerH / gridSize), sy, ty) + 1;

  const blocked = buildBlockedSet(blockedAreas, gridSize, gridW, gridH, logger);
  if (extraBlocked)    for (const k of extraBlocked)    blocked.add(k);
  if (forceFreeCells)  for (const k of forceFreeCells)  blocked.delete(k);

  // cellKey:  "gx,gy"       – für Blocked-Set-Lookup (richtungsunabhängig)
  // stateKey: "gx,gy,dir"   – für A*-Zustandsraum
  const cellKey  = (x, y)    => `${x},${y}`;
  const stateKey = (x, y, d) => `${x},${y},${d}`;
  const segKey   = (x1,y1,x2,y2) =>
    (x1 < x2 || (x1 === x2 && y1 < y2))
      ? `${x1},${y1}|${x2},${y2}` : `${x2},${y2}|${x1},${y1}`;

  // Vier Bewegungsrichtungen mit zugehörigem Richtungsbezeichner
  const DIRS = [[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']];
  const COLLISION_COST = 20;

  const open     = new MinHeap();
  const closed   = new Set();
  const gScore   = new Map();
  const fScore   = new Map();
  const cameFrom = new Map();

  // Startknoten: bekannte Anflugrichtung → einzelner Zustand; Steiner-Start → alle 4.
  // Heuristik mit REUSE_COST skaliert: seit Reuse-Segmente billiger als 1 sind,
  // ist der minimal moegliche Zellpreis REUSE_COST - eine unskalierte
  // Manhattan-Heuristik wuerde die Restkosten entlang von Reuse-Korridoren
  // ueberschaetzen (inadmissibel) und A* koennte den Reuse-Pfad verfehlen.
  const h0       = REUSE_COST * manhattanDist({ x: sx, y: sy }, { x: tx, y: ty });
  const initDirs = startDir != null ? [startDir] : ['right', 'left', 'down', 'up'];
  for (const d of initDirs) {
    const k = stateKey(sx, sy, d);
    gScore.set(k, 0);
    fScore.set(k, h0);
    open.push({ f: h0, k, x: sx, y: sy, d });
  }

  // Diagnose
  const startOOB = sx < 0 || sy < 0;
  const endOOB   = tx < 0 || ty < 0;
  logger?.('A* start/end check', {
    label,
    start: `(${sx},${sy}) = (${a.x}px,${a.y}px)`,
    end:   `(${tx},${ty}) = (${b.x}px,${b.y}px)`,
    startBlocked:     blocked.has(cellKey(sx, sy)),
    endBlocked:       blocked.has(cellKey(tx, ty)),
    startOutOfBounds: startOOB,
    endOutOfBounds:   endOOB,
    gridSize:         `${gridW}×${gridH}`,
    turnCost:         TURN_COST,
    startDir,
  });

  let iter = 0;
  // Zustandsraum ist 4× größer als reine (x,y)-Suche → MAX_ITER entsprechend skalieren
  const MAX_ITER = (gridW + 1) * (gridH + 1) * 4 * 4;

  while (open.size && iter++ < MAX_ITER) {
    const popped = open.pop();
    const curKey = popped.k;
    // Stale Eintrag (durch einen guenstigeren Pfad ueberholt, alter Heap-Eintrag
    // aber nicht aktiv entfernt) oder bereits final abgeschlossen -> ueberspringen.
    if (closed.has(curKey) || popped.f !== (fScore.get(curKey) ?? Infinity)) continue;
    const cur = { x: popped.x, y: popped.y, d: popped.d };
    closed.add(curKey);

    // Ein Hub-Shortcut (Treffer auf eine bereits belegte Zelle einer frueheren
    // Kante DESSELBEN Netzes) ist nur dann ein sinnvoller Anschlusspunkt, wenn
    // die Zelle auch achsparallel zum eigentlichen Ziel liegt (gleiche Zeile
    // oder Spalte wie tx/ty) - sonst kann er eine rein zufaellige Kreuzung mit
    // einem voellig unbeteiligten Teilstueck der frueheren Kante sein (z.B.
    // eine senkrechte Steigleitung, die die eigene Route nur passiert), nicht
    // die tatsaechliche gemeinsame Trunk-Linie. Ein solcher Zufallstreffer
    // fuehrte in Szenario 13 zu einem verfruehten Abbruch weit vor dem echten
    // Hub-Anschluss. WICHTIG: occupiedCells ist eine Map (Zelle -> netId), die
    // ueber ALLE Netze des Renders hinweg geteilt wird - ohne den Netz-Check
    // koennte ein Wire aus Netz A faelschlich an einer Zelle andocken, die zu
    // einem voellig unabhaengigen Netz B gehoert (Szenario 16: R1002:1 haette
    // sonst am Wire von conn0 andocken koennen, obwohl dafuer keine
    // elektrische Verbindung besteht).
    const occupantNetId  = occupiedCells && occupiedCells.get(`${cur.x},${cur.y}`);
    const isValidHubHit  = occupantNetId !== undefined && occupantNetId === currentNetId &&
                           !(cur.x === sx && cur.y === sy) &&
                           (cur.x === tx || cur.y === ty);
    const onTarget = (cur.x === tx && cur.y === ty) || isValidHubHit;
    if (onTarget) {
      // Pfad rekonstruieren: Schlüssel hat Format "gx,gy,dir" — erste zwei Tokens sind Koordinaten
      const path = [];
      let k = curKey;
      while (k) {
        const parts = k.split(',');
        path.unshift({ x: +parts[0] * gridSize, y: +parts[1] * gridSize });
        k = cameFrom.get(k);
      }
      logger?.('A* found', { label, pathLength: path.length });
      return path;
    }

    for (const [dx, dy, dName] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx > gridW || ny > gridH) continue;
      if (blocked.has(cellKey(nx, ny))) continue;

      const nk = stateKey(nx, ny, dName);
      if (closed.has(nk)) continue;

      const sk          = segKey(cur.x, cur.y, nx, ny);
      const occupantNet = occupiedSegments && occupiedSegments.get(sk);
      // Segmentkosten dreistufig: fremdes Netz teuer (Kollision), eigenes Netz
      // billig (Reuse-Anreiz, s. REUSE_COST oben), unbelegt normal.
      let moveCost;
      if (occupantNet !== undefined && occupantNet !== currentNetId) {
        moveCost = 1 + COLLISION_COST;
      } else if (occupantNet !== undefined && occupantNet === currentNetId) {
        moveCost = REUSE_COST;
      } else {
        moveCost = 1;
      }
      const turnPenalty = (cur.d !== dName) ? TURN_COST : 0;
      const tentative   = (gScore.get(curKey) ?? Infinity) + moveCost + turnPenalty;


      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, curKey);
        gScore.set(nk, tentative);
        // Heuristik mit REUSE_COST skaliert (Admissibilitaet, s. h0 oben).
        const nf = tentative + REUSE_COST * manhattanDist({ x: nx, y: ny }, { x: tx, y: ty });
        fScore.set(nk, nf);
        open.push({ f: nf, k: nk, x: nx, y: ny, d: dName });
      }
    }
  }
  logger?.('A* failed', { label });
  return null;
}

// Entfernt "Spikes": kollineare Hin-und-zurück-Zacken, bei denen der Pfad auf
// derselben Achse vor- und wieder zurückläuft (z. B. A→B→A oder A→B→C mit C
// zwischen A und B). Solche Überschwinger entstehen am Austrittspunkt eines
// Connectors, dessen Richtung von der Anflugrichtung wegzeigt.
function removeSpikes(points) {
  let pts = points.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      // a→b und b→c auf gleicher Achse, aber Richtung kehrt um → b ist ein Spike-Scheitel
      const abVert = a.x === b.x, bcVert = b.x === c.x;
      const abHorz = a.y === b.y, bcHorz = b.y === c.y;
      let spike = false;
      if (abVert && bcVert && a.x === c.x) {
        const dir1 = Math.sign(b.y - a.y), dir2 = Math.sign(c.y - b.y);
        if (dir1 !== 0 && dir2 !== 0 && dir1 !== dir2) spike = true;
      } else if (abHorz && bcHorz && a.y === c.y) {
        const dir1 = Math.sign(b.x - a.x), dir2 = Math.sign(c.x - b.x);
        if (dir1 !== 0 && dir2 !== 0 && dir1 !== dir2) spike = true;
      }
      if (spike) { changed = true; /* b auslassen, c bleibt für nächste Runde */ }
      else out.push(b);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// Nach A*-T-Junction-Shortcut: Den Exit-Punkt entlang des bereits belegten Drahts
// weiter wandern, bis ein Punkt erreicht ist, der mit dem Ziel achsparallel liegt
// (gleiche gx oder gy). Dadurch landet die spätere Querverbindung zum Ziel auf der
// existierenden Drahtachse → keine doppelten parallelen Linien, sauberer T-Look,
// und eine Ecke weniger im finalen Pfad.
// Wandert nur in der ursprünglichen A*-Bewegungsrichtung; verlässt den Draht nicht.
// occupiedCells ist eine Map (Zelle -> netId) - es wird nur entlang Zellen
// DESSELBEN Netzes (currentNetId) weitergegangen, sonst koennte über ein
// fremdes, unabhaengiges Netz hinweg "gerutscht" werden.
function slideAlongWire(route, occupiedCells, target, gridSize, currentNetId) {
  if (!route || route.length < 2 || !occupiedCells) return route;
  const last = route[route.length - 1];
  const prev = route[route.length - 2];
  const lx = last.x / gridSize, ly = last.y / gridSize;
  const px = prev.x / gridSize, py = prev.y / gridSize;
  const tx = target.x / gridSize, ty = target.y / gridSize;
  // Bereits achsparallel zum Ziel? → nichts tun
  if (lx === tx || ly === ty) return route;
  const dx = Math.sign(lx - px), dy = Math.sign(ly - py);
  if (dx === 0 && dy === 0) return route;
  // Schritt-für-Schritt entlang Draht wandern, bis achsparallel oder Draht endet
  const extension = [];
  let cx = lx, cy = ly;
  const MAX = 1000;
  for (let i = 0; i < MAX; i++) {
    const nx = cx + dx, ny = cy + dy;
    if (occupiedCells.get(`${nx},${ny}`) !== currentNetId) break;
    cx = nx; cy = ny;
    extension.push({ x: cx * gridSize, y: cy * gridSize });
    if (cx === tx || cy === ty) return [...route, ...extension];
  }
  // Keine Achsparallelität entlang des Drahts gefunden → Original
  return route;
}


function simplifyPath(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length-1];
    const curr = points[i];
    const next = points[i+1];
    const d1x = Math.sign(curr.x - prev.x);
    const d1y = Math.sign(curr.y - prev.y);
    const d2x = Math.sign(next.x - curr.x);
    const d2y = Math.sign(next.y - curr.y);
    if (d1x !== d2x || d1y !== d2y) result.push(curr);
  }
  result.push(points[points.length-1]);
  return result;
}



function buildMST(nodes) {
  if (nodes.length <= 1) return [];
  const inMST = new Set([nodes[0].id]);
  const edges = [];
  while (inMST.size < nodes.length) {
    let best = null, bestDist = Infinity;
    for (const a of nodes) {
      if (!inMST.has(a.id)) continue;
      for (const b of nodes) {
        if (inMST.has(b.id)) continue;
        const d = manhattanDist(a, b);
        if (d < bestDist) { bestDist = d; best = [a, b]; }
      }
    }
    if (!best) break;
    edges.push(best);
    inMST.add(best[1].id);
  }
  return edges;
}

function findSteinerPoint(connectors) {
  if (connectors.length < 3) return null;
  const candidates = [];
  for (const a of connectors)
    for (const b of connectors)
      if (a.id !== b.id) {
        candidates.push({ x: a.x, y: b.y });
        candidates.push({ x: b.x, y: a.y });
      }
  const baseMST = buildMST(connectors);
  const baseLen = baseMST.reduce((s, [a,b]) => s + manhattanDist(a,b), 0);
  let bestLen = baseLen, bestPoint = null;
  for (const cand of candidates) {
    const aug = [...connectors, { id: '__steiner__', x: cand.x, y: cand.y }];
    const mst = buildMST(aug);
    const len = mst.reduce((s, [a,b]) => s + manhattanDist(a,b), 0);
    if (len < bestLen) { bestLen = len; bestPoint = cand; }
  }
  return bestPoint;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

class ElectricalWire {
  constructor(container, options = {}) {
    if (!(container instanceof HTMLElement)) throw new Error('ElectricalWire: container must be an HTMLElement.');
    this._container = container;
    this._options = { ...DEFAULTS, ...options };
    this._connectors = null;
    this._connections = null;
    this._blocked       = null;
    this._blockedShrink = 0;
    this._svg = null;
    // Separate SVG-Ebene NUR fuer Connector-/Junction-Punkte + Labels (siehe
    // render()). Liegt ueber .sim_block (z-index 10), waehrend die Wires
    // selbst (this._svg) unveraendert darunter bleiben.
    this._pointsSvg = null;
  }

  _log(...args) { if (this._options.logging) console.log('[ElectricalWire]', ...args); }
  _warn(...args) { console.warn('[ElectricalWire]', ...args); }

  setConnectors(connectors) {
    if (!Array.isArray(connectors)) throw new Error('ElectricalWire: setConnectors() expects an array.');
    const seen = new Set();
    connectors.forEach((c, i) => {
      if (typeof c.id !== 'string' || !c.id.trim()) throw new Error(`ElectricalWire: connector at index ${i} is missing a valid "id".`);
      if (seen.has(c.id)) throw new Error(`ElectricalWire: duplicate connector id "${c.id}".`);
      seen.add(c.id);
      if (typeof c.x !== 'number' || Number.isNaN(c.x) || typeof c.y !== 'number' || Number.isNaN(c.y))
        throw new Error(`ElectricalWire: connector "${c.id}" has invalid coordinates.`);
      if (!['right','left','up','down'].includes(c.direction))
        throw new Error(`ElectricalWire: connector "${c.id}" has invalid direction "${c.direction}". Use "right", "left", "up" or "down".`);
      if (typeof c.minLength !== 'number' || Number.isNaN(c.minLength) || c.minLength < 0)
        throw new Error(`ElectricalWire: connector "${c.id}" has invalid minLength.`);
    });
    this._connectors = connectors;
  }

  setConnections(connections) {
    if (!Array.isArray(connections)) throw new Error('ElectricalWire: setConnections() expects an array.');
    const known = this._connectors ? new Set(this._connectors.map(c => c.id)) : null;
    const seen = new Set();
    connections.forEach((c, i) => {
      if (typeof c.id !== 'string' || !c.id.trim()) throw new Error(`ElectricalWire: connection at index ${i} is missing a valid "id".`);
      if (seen.has(c.id)) throw new Error(`ElectricalWire: duplicate connection id "${c.id}".`);
      seen.add(c.id);
      if (c.from === c.to) throw new Error(`ElectricalWire: connection "${c.id}" connects a connector to itself.`);
      if (known) {
        if (!known.has(c.from)) throw new Error(`ElectricalWire: connection "${c.id}" references unknown connector "${c.from}".`);
        if (!known.has(c.to))   throw new Error(`ElectricalWire: connection "${c.id}" references unknown connector "${c.to}".`);
      }
    });
    this._connections = connections;
  }

  /**
   * Sperrbereiche setzen.
   * @param {HTMLElement[]} areas   — DOM-Elemente die Sperrbereiche repräsentieren
   * @param {object}        [opts]
   * @param {number}        [opts.shrink=0] — Jeden Sperrbereich um diesen Wert (px) nach innen
   *                                          verkleinern. Nützlich wenn Connector-Dots am Rand
   *                                          des Elements liegen und sonst als „innerhalb des
   *                                          Sperrbereichs" gewertet würden (typisch: halbe Dot-Größe).
   */
  /**
   * Sperrbereiche setzen.
   * @param {Array<HTMLElement|{x,y,width,height}>} areas
   *   Entweder HTMLElement (Position wird bei render() aus DOM gelesen)
   *   oder fertiges Rechteck-Objekt {x, y, width, height} in Container-Pixeln.
   * @param {object} [opts]
   * @param {number} [opts.shrink=0] — Jeden HTMLElement-Sperrbereich um diesen Wert nach innen verkleinern.
   *                                   Gilt nicht für Rechteck-Objekte (bereits vorberechnet).
   */
  setBlockedAreas(areas, { shrink = 0 } = {}) {
    if (!Array.isArray(areas)) throw new Error('ElectricalWire: setBlockedAreas() expects an array.');
    areas.forEach((a, i) => {
      if (!(a instanceof HTMLElement) && !(typeof a === 'object' && 'x' in a && 'width' in a))
        throw new Error(`ElectricalWire: blocked area at index ${i} is not an HTMLElement or rect object.`);
    });
    this._blocked       = areas;
    this._blockedShrink = shrink;
  }

  clear() {
    if (this._svg)       { this._svg.remove();       this._svg = null; }
    if (this._pointsSvg) { this._pointsSvg.remove();  this._pointsSvg = null; }
  }

  // Routet alle Netze in der gegebenen Reihenfolge und zeichnet sie in
  // parentGroup (ein loses <g>, noch nicht zwingend im echten SVG). Gibt die
  // aufsummierte Gesamtlaenge aller gezeichneten Wires zurueck - dient render()
  // als Vergleichsmass zwischen zwei Netz-Reihenfolge-Varianten (siehe dort).
  // occupiedSegments/occupiedCells werden hier NEU angelegt (nicht von aussen
  // uebergeben), damit die beiden Varianten sich nicht gegenseitig beeinflussen.
  _routeAllNets(orderedNets, connMap, blockedRects, W, H, gs, opt, parentGroup) {
    const occupiedSegments = new Map();
    const occupiedCells    = new Map(); // Gridzelle -> netId, aller bereits gerouteten Pfade (für T-Junction)
    let totalTurns = 0; // Summe aller Richtungswechsel dieses Durchlaufs, fuer den Netz-Reihenfolge-Vergleich in render()

    for (const [root, net] of orderedNets) {
      const netConnectors = net.connectors;
      // IDs der eigenen Netz-Connectoren - fuer die extraBlocked-Ausnahme weiter
      // unten (Connectoren desselben Netzes duerfen sich nicht gegenseitig
      // blockieren, analog zur bereits bestehenden Kollisions-Ausnahme fuer
      // occupiedSegments). Einmal pro Netz berechnet statt pro Kante.
      const netConnectorIds = new Set(netConnectors.map(c => c.id));
      const netId = net.connections.map(c => c.id).join(',');
      // Hub-Erkennung: Connector der in >1 Connections vorkommt. Dient zwei
      // Zwecken: (1) Gate fuer den T-Junction-Shortcut (occupiedCells) weiter
      // unten in der Routing-Schleife - jedes Mehr-Kanten-Netz hat per
      // Union-Find-Konstruktion mindestens einen solchen geteilten Connector;
      // (2) MST-Wurzel im Redundanz-Fallback (siehe unten).
      let hubId = null;
      if (net.connections.length >= 2) {
        const connUsage = new Map();
        for (const conn of net.connections) {
          connUsage.set(conn.from, (connUsage.get(conn.from) || 0) + 1);
          connUsage.set(conn.to,   (connUsage.get(conn.to)   || 0) + 1);
        }
        for (const [id, count] of connUsage)
          if (count > 1) { hubId = id; break; }
      }
      // Kernfix: Ist das Netz bereits ein minimaler Baum (Anzahl Connections
      // == Anzahl Connectoren - 1, also keine Redundanz), werden die
      // deklarierten net.connections DIREKT als Kanten verwendet - keine
      // geometrische MST noetig. net.connections ist durch die Union-Find-
      // Gruppierung immer bereits zusammenhaengend; eine neu berechnete MST
      // kann dagegen JEDE geometrisch naechstgelegene Paarung waehlen, auch
      // eine, fuer die gar keine Connection deklariert ist. Genau das war die
      // Ursache fuer:
      //  - Szenario 12/13: Hub-Kante ging faelschlich Leaf-zu-Leaf
      //    (R1002:1<->L2001:0) statt beide separat zum Hub R1001:1.
      //  - Szenario 15: Prim verband B6_IWR1:0<->B6_IWR1:4 (zwei Pins
      //    DESSELBEN Blocks, geometrisch nah) direkt, obwohl dafuer keine
      //    Connection existiert - die Linie lief quer durchs eigene Bauteil.
      // Nur bei ECHTER Redundanz (mehr Connections als fuer einen Spannbaum
      // noetig, z.B. eine geschlossene Schleife zwischen denselben
      // Connectoren) wird weiterhin auf Hub-Stern/MST/Steiner zurueckgegriffen,
      // um die Redundanz sinnvoll zu reduzieren.
      const isMinimalTree = net.connections.length === netConnectors.length - 1;
      let edges;
      let steiner = null;
      if (isMinimalTree) {
        edges = net.connections.map(c => [connMap.get(c.from), connMap.get(c.to)]);
      } else {
        // Ohne Hub: Steiner-Punkt für optimales T-Routing.
        if (!hubId && netConnectors.length >= 3) steiner = findSteinerPoint(netConnectors);
        const allNodes = steiner
          ? [...netConnectors, { id: '__steiner__', x: steiner.x, y: steiner.y }]
          : netConnectors.slice();
        // Hub als MST-Wurzel → buildMST baut Speichen direkt zum Hub
        if (hubId) {
          const hi = allNodes.findIndex(n => n.id === hubId);
          if (hi > 0) allNodes.unshift(allNodes.splice(hi, 1)[0]);
        }
        // Bei erkanntem Hub: Speichen direkt und garantiert vom Hub aus bauen,
        // statt eine generische Prim-MST zu berechnen - ABER nur, wenn wirklich
        // JEDE Connection des Netzes den Hub beruehrt (echter Stern). Liegen
        // zwei Leaf-Connectoren geometrisch naeher zueinander als zum Hub,
        // verbindet Prim sie sonst direkt miteinander (Leaf-zu-Leaf) statt
        // ueber den Hub, obwohl dafuer keine Connection deklariert ist.
        const isPureStar = hubId && net.connections.every(c => c.from === hubId || c.to === hubId);
        edges = isPureStar
          ? allNodes.slice(1).map(n => [allNodes[0], n])
          : buildMST(allNodes);
      }
      // Bei einem echten Hub-Stern (jede Connection beruehrt denselben Hub)
      // werden die Speichen so sortiert, dass diejenige(n) zuerst verarbeitet
      // werden, deren eigene Austrittsrichtung schon zur Hub-Zielachse zeigt
      // (kostet keine zusaetzliche Abbiegung - z.B. ein "up"-Connector, dessen
      // Stub schon in Richtung der Hub-Hoehe zeigt). Diese Speiche baut dabei
      // "kostenlos" einen langen, gemeinsam nutzbaren Trunk bis zur Hub-Hoehe
      // auf. Speichen, deren eigene Richtung von der Hub-Achse WEG zeigt,
      // koennen diese Ausrichtung nur mit einer echten Zusatz-Abbiegung
      // erreichen - am billigsten unmittelbar vorm Ziel, was ohne Trunk zum
      // Andocken sonst wie eine zweite, leicht versetzte Parallel-Linie
      // aussieht (Szenario 13). Werden sie NACH der guenstigen Speiche
      // verarbeitet, docken sie ueber den T-Junction-Shortcut (occupiedCells)
      // sauber am bereits vorhandenen Trunk an, statt ihren eigenen (versetzten)
      // Trunk zu bauen.
      const isPureHubStar = hubId && net.connections.every(c => c.from === hubId || c.to === hubId);
      let hubVirtualEntry = null;
      if (isPureHubStar) {
        const hubConn = connMap.get(hubId);
        const hubAxisVertical = (hubConn.direction === 'up' || hubConn.direction === 'down');
        const approachIsFree = (leafConn) => {
          if (hubConn.direction === 'up' || hubConn.direction === 'down') {
            const targetY = hubConn.y + (hubConn.direction === 'up' ? -hubConn.minLength : hubConn.minLength);
            // Vergleich auf Basis der STUB-Position (nach minLength), nicht der
            // rohen Connector-Koordinate - massgeblich ist, ob das Fortsetzen
            // der eigenen Richtung NACH dem Stub noch zur Zielhoehe hinfuehrt
            // oder schon darueber hinaus ist.
            if (leafConn.direction === 'up')   return (leafConn.y - leafConn.minLength) > targetY;
            if (leafConn.direction === 'down') return (leafConn.y + leafConn.minLength) < targetY;
            return false;
          } else {
            const targetX = hubConn.x + (hubConn.direction === 'left' ? -hubConn.minLength : hubConn.minLength);
            if (leafConn.direction === 'left')  return (leafConn.x - leafConn.minLength) > targetX;
            if (leafConn.direction === 'right') return (leafConn.x + leafConn.minLength) < targetX;
            return false;
          }
        };
        edges = edges.slice().sort((a, b) => {
          const leafA = a[0].id === hubId ? a[1] : a[0];
          const leafB = b[0].id === hubId ? b[1] : b[0];
          const freeA = approachIsFree(leafA) ? 0 : 1;
          const freeB = approachIsFree(leafB) ? 0 : 1;
          return freeA - freeB;
        });
        // "Speichen-Bug"-Fix: Statt jede Speiche exakt auf den Hub-Eintritts-
        // punkt zu routen, wird - falls genau EINE Stub-Hoehe/-Spalte unter den
        // "unpassenden" (nicht-freien) Speichen vorkommt - ein virtueller
        // Trunk-Punkt auf GENAU dieser Stub-Position verwendet. Die unpassende(n)
        // Speiche(n) erreichen ihn dann kostenlos (keine Zusatz-Abbiegung mehr
        // noetig), freie Speichen kostet es ebenfalls nichts (sie erreichen
        // jede Hoehe/Spalte auf ihrem natuerlichen Weg kostenlos). Ein
        // gemeinsames Schluss-Segment fuehrt danach von diesem virtuellen
        // Punkt zum echten Hub-Eintrittspunkt - macht die Umleitung fuer alle
        // Speichen sichtbar, spart aber gegenueber der bisherigen Loesung
        // (Trunk exakt auf Hub-Hoehe) eine Ecke bei der unpassenden Speiche.
        // Nur anwendbar, wenn die unpassende(n) Speiche(n) auf derselben Achse
        // liegen wie der Hub selbst (sonst ist "eigene Stub-Hoehe" nicht
        // wohldefiniert) und alle betroffenen Speichen dieselbe Stub-Position
        // teilen - sonst bleibt der Hub-Eintrittspunkt selbst das Ziel.
        const leaves = edges.map(([a, b]) => connMap.get((a.id === hubId ? b : a).id));
        const costlySameAxis = leaves.filter(l => {
          const sameAxis = hubAxisVertical
            ? (l.direction === 'up' || l.direction === 'down')
            : (l.direction === 'left' || l.direction === 'right');
          return sameAxis && !approachIsFree(l);
        });
        if (costlySameAxis.length >= 1) {
          const stubCoords = new Set(costlySameAxis.map(l => hubAxisVertical
            ? (l.y + (l.direction === 'up' ? -l.minLength : l.minLength))
            : (l.x + (l.direction === 'left' ? -l.minLength : l.minLength))
          ));
          if (stubCoords.size === 1) {
            const stubCoord = [...stubCoords][0];
            hubVirtualEntry = hubAxisVertical
              ? { x: hubConn.x, y: stubCoord }
              : { x: stubCoord, y: hubConn.y };
          }
        }
      }
      const wireGroup = svgEl('g', { 'data-net-id': netId, class: 'ew-net' });
      parentGroup.appendChild(wireGroup);


      for (const [nodeA, nodeB] of edges) {
        const isASteiner = nodeA.id === '__steiner__';
        const isBSteiner = nodeB.id === '__steiner__';
        const connA = isASteiner ? null : connMap.get(nodeA.id);
        const connB = isBSteiner ? null : connMap.get(nodeB.id);

        // Finde originale Connection für Richtung
        let startConn = null, endConn = null;
        let startPoint, endPoint;

        const orig = net.connections.find(c => (c.from === nodeA.id && c.to === nodeB.id) ||
                                               (c.from === nodeB.id && c.to === nodeA.id));
        if (orig) {
          // Normale Connection mit definierter Richtung
          startConn = connMap.get(orig.from);
          endConn   = connMap.get(orig.to);
          startPoint = getExitPoint(startConn, opt.gridSize);
          endPoint   = getEntryPoint(endConn, opt.gridSize);
        } else if (isASteiner || isBSteiner) {
          // Steiner-Verbindung: Der Steiner ist immer das Ziel (neutral)
          if (isASteiner) {
            // nodeA ist Steiner (Start), nodeB ist Connector (Ziel)
            startConn = null;
            endConn   = connMap.get(nodeB.id);
            startPoint = { x: nodeA.x, y: nodeA.y };
            endPoint   = getEntryPoint(endConn, opt.gridSize);
          } else {
            // nodeB ist Steiner (Start), nodeA ist Connector (Ziel)
            startConn = null;
            endConn   = connMap.get(nodeA.id);
            startPoint = { x: nodeB.x, y: nodeB.y };
            endPoint   = getEntryPoint(endConn, opt.gridSize);
          }
        } else {
          // Fallback: nodeA als Start, nodeB als Ziel (beide Connectors)
          startConn = connA;
          endConn   = connB;
          startPoint = getExitPoint(startConn, opt.gridSize);
          endPoint   = getEntryPoint(endConn, opt.gridSize);
        }

        // "Speichen-Bug"-Fix: Fuer Hub-Stern-Kanten mit berechnetem
        // hubVirtualEntry wird NICHT der exakte Hub-Eintrittspunkt angeflogen,
        // sondern der virtuelle Trunk-Punkt auf Stub-Hoehe der unpassenden
        // Speiche - das gemeinsame Schluss-Segment zum echten Hub-Punkt wird
        // weiter unten beim Pfad-Zusammenbau ueber endConn ergaenzt.
        if (hubVirtualEntry && endConn && endConn.id === hubId) {
          endPoint = hubVirtualEntry;
        }

        // Der Stub ist immer exakt minLength lang (feste Gerade in direction).
        // Ab dem Exitpunkt ist der Router vollständig frei — auch innerhalb eines
        // Sperrbereichs. Liegt der Exitpunkt im Sperrbereich, öffnet escapeFreeCells
        // Korridore in alle 4 Richtungen bis zur Bereichsgrenze, damit A* selbst
        // den kürzesten Weg heraus wählen kann.
        const actualStart = startPoint;
        const actualEnd   = endPoint;

        this._log('Routing', { edge: `${nodeA.id}→${nodeB.id}`, start: `(${startPoint.x},${startPoint.y})`, end: `(${endPoint.x},${endPoint.y})` });

        // Connector-Zellen und ihre Stub-Korridore sperren, damit der Router nicht
        // durch einen Connector oder dessen minLength-Austrittsstub hindurchläuft
        // (würde am Anschluss einen Zacken erzeugen). A* fliegt den Exit-Punkt dann
        // sauber von der Seite an. Die beiden A*-Endpunkte selbst bleiben begehbar.
        const cellKey = (p) => `${snapToGrid(p.x, gs) / gs},${snapToGrid(p.y, gs) / gs}`;
        const extraBlocked = new Set();
        const blockStub = (conn) => {
          // alle Gridzellen vom Connector bis kurz vor seinen Exit-Punkt sperren
          const exit = getExitPoint(conn, gs);
          const x0 = snapToGrid(conn.x, gs) / gs, y0 = snapToGrid(conn.y, gs) / gs;
          const x1 = snapToGrid(exit.x, gs) / gs, y1 = snapToGrid(exit.y, gs) / gs;
          const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
          let x = x0, y = y0;
          while (true) {
            extraBlocked.add(`${x},${y}`);
            if (x === x1 && y === y1) break;
            x += dx; y += dy;
          }
        };
        for (const c of this._connectors) {
          // Geschwister-Connectoren desselben Netzes (NICHT die beiden Enden
          // der aktuellen Kante selbst!) duerfen den Router nicht blockieren -
          // sonst wird eine Speiche unnoetig von der gemeinsamen Trunk-Hoehe
          // verdraengt, sobald diese Hoehe zufaellig durch den Exit-Punkt eines
          // Geschwister-Connectors verlaeuft (Speichen-Bug 2: Hub als QUELLE,
          // z.B. V_DC:0 mit 3 Speichen zu MMC_Au/Bu/Cu:0 - conn6/conn12 wichen
          // sonst 1 Gridzelle von der eigentlich fuer alle drei identischen
          // Trunk-Hoehe ab, sichtbar als knapp parallel versetzte Doppellinie).
          // Analog zur bereits bestehenden Kollisions-Ausnahme fuer
          // occupiedSegments (dort duerfen sich Wires desselben Netzes ebenfalls
          // ueberlappen). WICHTIG: Die beiden Connectoren DIESER Kante
          // (nodeA/nodeB) muessen weiterhin ganz normal blockiert bleiben -
          // sonst faellt bei einem reinen 2-Connector-Netz (z.B. Szenario 1,
          // C1->C2 direkt) die komplette Absperrung weg und der Router laeuft
          // gerade durch und wieder zurueck (Spike) statt des erzwungenen
          // U-Turns.
          const isCurrentEdgeEndpoint = (c.id === nodeA.id || c.id === nodeB.id);
          if (!isCurrentEdgeEndpoint && netConnectorIds.has(c.id)) continue;
          extraBlocked.add(cellKey(c));
          if (c.minLength > 0) blockStub(c);
        }
        // Die tatsächlichen A*-Endpunkte aus dem extraBlocked-Set freigeben.
        extraBlocked.delete(cellKey(actualStart));
        extraBlocked.delete(cellKey(actualEnd));
        // Zellen, durch die bereits ein Wire DESSELBEN Netzes laeuft, ebenfalls
        // freigeben - dort liegt schon Leitung dieses elektrischen Knotens, und
        // auf bestehender Leitung kann kein "Zacken am Anschluss" entstehen
        // (der Schutzzweck der Stub-Sperrung). Konkreter Fall (Szenario 20,
        // Phase A): conn2s Trunk laeuft senkrecht EXAKT durch den Stub-Korridor
        // von L_Al:0; ohne diese Freigabe musste conn3 den Trunk 1-2 Zellen
        // vorm Ziel verlassen und seitlich anfliegen (hoch-rueber-runter) -
        // sichtbar als kleiner Kringel am Connector, obwohl die gerade
        // Weiterfahrt auf dem Trunk direkt zum Exit-Punkt fuehrt. Ergaenzt den
        // REUSE_COST-Rabatt in aStarPath(): der macht das Trunk-Reiten
        // attraktiv, diese Freigabe macht es bis in den Stub hinein MOEGLICH.
        for (const k of extraBlocked) {
          if (occupiedCells.get(k) === netId) {
            extraBlocked.delete(k);
          } else {
            // fremdes Netz oder unbelegt -> Sperre bleibt bestehen
          }
        }

        this._log('Routing effective', {
          edge: `${nodeA.id}→${nodeB.id}`,
          actualStart: `(${actualStart.x},${actualStart.y})`,
          actualEnd:   `(${actualEnd.x},${actualEnd.y})`,
          extraBlockedCount: extraBlocked.size,
          startInExtraBlocked: extraBlocked.has(cellKey(actualStart)),
          endInExtraBlocked:   extraBlocked.has(cellKey(actualEnd)),
        });

        // A* zwischen actualStart und actualEnd.
        // forceFreeCells: Exitpunkt-Zellen immer begehbar; liegt ein Exitpunkt im
        // Sperrbereich, werden zusätzlich Korridore in alle 4 Richtungen bis zur
        // Sperrbereichsgrenze freigegeben — A* wählt dann selbst den kürzesten Ausweg.
        const forceFreeCells = new Set([cellKey(actualStart), cellKey(actualEnd)]);
        for (const k of escapeFreeCells(actualStart, blockedRects, gs)) forceFreeCells.add(k);
        for (const k of escapeFreeCells(actualEnd,   blockedRects, gs)) forceFreeCells.add(k);
        const startDir = startConn ? startConn.direction : null;
        // T-Junction-Shortcut (occupiedCells) ist nur sinnvoll, wenn der Hub das
        // ZIEL dieser Kante ist (mehrere Speichen KONVERGIEREN zum selben Punkt -
        // eine bereits gezeichnete Speiche fuehrt dann zwangslaeufig zum selben
        // Ziel). Ist der Hub stattdessen die QUELLE (mehrere Speichen gehen vom
        // Hub aus zu VERSCHIEDENEN Zielen, Szenario 17), gibt es keinen
        // gemeinsamen Konvergenzpunkt - eine bereits gezeichnete Speiche kann
        // dann rein zufaellig dieselbe x- oder y-Koordinate wie das voellig
        // andere Ziel dieser Kante kreuzen, ohne dass das etwas mit dem echten
        // Ziel zu tun hat. Ohne diese Einschraenkung bricht die Suche dort
        // faelschlich vorzeitig ab (sichtbarer unnoetiger Umweg/Zusatzknick).
        const isHubTarget = hubId && endConn && endConn.id === hubId;
        let route = aStarPath(actualStart, actualEnd, blockedRects, opt.gridSize, W, H, occupiedSegments, this._log.bind(this), `${nodeA.id}→${nodeB.id}`, extraBlocked, forceFreeCells, startDir, isHubTarget ? occupiedCells : null, netId);
        if (!route) {
          // Liegt eine originale Connection für diese Kante vor, wird deren ID in der
          // Fehlermeldung verwendet. Bei Steiner- oder MST-Kanten ohne direkte Connection
          // werden die tatsächlichen Knoten-IDs der fehlgeschlagenen Kante gemeldet.
          const cid = orig ? orig.id : netId;
          const fId = orig ? orig.from : nodeA.id;
          const tId = orig ? orig.to   : nodeB.id;
          this._log('Error before throw', { connectionId: cid, from: fId, to: tId });
          throw new Error(`ElectricalWire: no path found for connection "${cid}" (from "${fId}" to "${tId}"). Check blocked areas.`);
        }

        // Bei T-Junction-Shortcut: Den Exit-Punkt entlang des bereits belegten Drahts
        // verschieben, bis er achsparallel zum Ziel liegt. Spart eine Ecke und sorgt
        // dafür, dass die Querverbindung auf der Drahtachse landet (visuell sauberer).
        if (isHubTarget) route = slideAlongWire(route, occupiedCells, actualEnd, opt.gridSize, netId);

        // A*-Mittelteil von Spikes bereinigen, BEVOR die festen Stub-Punkte
        // (Connector + minLength-Austrittsstub) angefügt werden. So bleiben die
        // minLength-Austrittssegmente garantiert erhalten.
        const midRoute = removeSpikes(route);

        // Gesamtpfad zusammensetzen:
        // startConn → [minLength-Stub implizit in midRoute] → endConn
        // Wichtig: endConn nur dann direkt anhängen, wenn er mit dem letzten
        // midRoute-Punkt achsparallel ausgerichtet ist (gleiche x oder gleiche y).
        // Sonst würde ein diagonales Segment entstehen (z. B. bei T-Junction-Abbruch).
        const full = [];
        if (startConn) {
          const sc = { x: startConn.x, y: startConn.y };
          full.push(sc);
          // Spiegelbildlich zur Korrektur am Pfadende: A* rundet auch den
          // START-Stub-Punkt aufs Grid, waehrend startConn selbst exakt ist.
          // Ohne Korrektur entsteht hier derselbe Mini-Zickzack wie am Ende
          // (z.B. Szenario 18, conn9: Rundung nach rechts, dann sofort wieder
          // zurueck nach links). Dieselbe "ganze zusammenhaengende Gerade
          // verschieben"-Logik, nur vorwaerts durch midRoute statt rueckwaerts.
          if (midRoute.length > 0) {
            const first = midRoute[0];
            const xNear = Math.abs(first.x - sc.x) < opt.gridSize;
            const yNear = Math.abs(first.y - sc.y) < opt.gridSize;
            if (first.x === sc.x || first.y === sc.y) {
              // schon achsparallel - nichts zu tun
            } else if (xNear && first.y !== sc.y) {
              const oldX = first.x;
              for (let i = 0; i < midRoute.length && midRoute[i].x === oldX; i++) midRoute[i] = { x: sc.x, y: midRoute[i].y };
            } else if (yNear && first.x !== sc.x) {
              const oldY = first.y;
              for (let i = 0; i < midRoute.length && midRoute[i].y === oldY; i++) midRoute[i] = { x: midRoute[i].x, y: sc.y };
            } else {
              // Nicht achsparallel -> orthogonalen Zwischenpunkt einfuegen
              // (Richtung von startConn bestimmt das erste Segment).
              const scDir = startConn.direction;
              const firstSegmentVertical = (scDir === 'up' || scDir === 'down');
              if (firstSegmentVertical) full.push({ x: sc.x, y: first.y });
              else full.push({ x: first.x, y: sc.y });
            }
          }
        }
        full.push(...midRoute);
        if (endConn) {
          const last = full[full.length - 1];
          const ec   = { x: endConn.x, y: endConn.y };
          // A* rechnet auf dem Grid (gridSize-Vielfache); die echte Connector-
          // Koordinate liegt oft dazwischen (z.B. 283.727... statt 285). Ein
          // reiner Rundungsunterschied unterhalb einer Gridzelle ist keine
          // echte Richtungsaenderung. Statt nur den letzten Punkt anzupassen
          // (was bei einlaufend andersartigem Segment eine Diagonale erzeugen
          // wuerde) wird die GESAMTE zusammenhaengende letzte Gerade - inkl.
          // des gemeinsamen Eckpunkts zum vorherigen Segment - um die
          // Rundungsdifferenz verschoben. Das ist immer sicher: der
          // Eckpunkt selbst haelt auf der JEWEILS ANDEREN Achse ohnehin schon
          // konstant, verschiebt sich also fuer das vorherige Segment nicht;
          // fuer das aktuelle (zu verschiebende) Segment bleibt die Achse
          // durchgehend konsistent, nur eben auf dem neuen, exakten Wert.
          // full[0] (die eigene, immer exakte Connector-Koordinate von
          // startConn) wird dabei nie angetastet.
          const minIdx = startConn ? 1 : 0;
          const xNear = Math.abs(last.x - ec.x) < opt.gridSize;
          const yNear = Math.abs(last.y - ec.y) < opt.gridSize;
          if (last.x === ec.x || last.y === ec.y) {
            // Achsparallel → direkt anhängen
            full.push(ec);
          } else if (xNear && last.y !== ec.y) {
            const oldX = last.x;
            for (let i = full.length - 1; i >= minIdx && full[i].x === oldX; i--) full[i] = { x: ec.x, y: full[i].y };
            full.push(ec);
          } else if (yNear && last.x !== ec.x) {
            const oldY = last.y;
            for (let i = full.length - 1; i >= minIdx && full[i].y === oldY; i--) full[i] = { x: full[i].x, y: ec.y };
            full.push(ec);
          } else {
            // Nicht achsparallel (T-Junction-Shortcut traf Zelle abseits der Ziellinie):
            // Orthogonalen Zwischenpunkt einfügen, damit kein diagonales Segment entsteht.
            // Die Connector-Richtung bestimmt das letzte Segment:
            //   up/down → letztes Segment vertikal → Zwischenpunkt teilt x mit endConn
            //   left/right → letztes Segment horizontal → Zwischenpunkt teilt y mit endConn
            const ecDir = endConn.direction;
            const lastSegmentVertical = (ecDir === 'up' || ecDir === 'down');
            if (lastSegmentVertical) {
              full.push({ x: ec.x, y: last.y });
            } else {
              full.push({ x: last.x, y: ec.y });
            }
            full.push(ec);
          }
        }

        // Entferne doppelte aufeinanderfolgende Punkte
        const unique = [];
        for (let i = 0; i < full.length; i++) {
          if (i === 0 || full[i].x !== full[i-1].x || full[i].y !== full[i-1].y)
            unique.push(full[i]);
        }
        // Vereinfache den Pfad (entferne überflüssige Zwischenpunkte)
        const simplified = simplifyPath(unique);
        const d = simplified.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
        // Eckenzahl statt Laenge als Vergleichsmass: die Manhattan-Laenge zwischen
        // zwei festen Punkten ist invariant gegenueber der Position der Abbiege-Ecke
        // (ein L-Knick weiter links oder rechts aendert die Gesamtlaenge nicht) -
        // deshalb kann ein reiner Laengenvergleich bei einem "verschobenen" Umweg
        // unentschieden ausgehen, obwohl eine Variante sichtbar mehr Ecken hat
        // (Szenario 18: conn7 hatte in einer Variante 4 statt 2 Knicke, bei exakt
        // gleicher Gesamtlaenge). simplifyPath() hat bereits alle kollinearen
        // Zwischenpunkte entfernt, jeder verbleibende Punkt ist ein echter
        // Richtungswechsel - die Eckenzahl ist also einfach length-2.
        totalTurns += Math.max(0, simplified.length - 2);

        this._log('Final path', { netId, d });

        const wire = svgEl('path', { d, stroke: opt.wireColor, 'stroke-width': opt.wireWidth, fill: 'none', 'stroke-linecap': 'square', 'data-net-id': netId, class: 'ew-wire' });
        wireGroup.appendChild(wire);
        const hit = svgEl('path', { d, stroke: opt.wireColor, 'stroke-width': Math.max(8, opt.wireWidth+6), fill: 'none', opacity: '0', 'data-net-id': netId, class: 'ew-wire-hit', 'pointer-events': 'stroke' });
        wireGroup.appendChild(hit);
        hit.addEventListener('mouseenter', () => this._highlight(netId, true));
        hit.addEventListener('mouseleave', () => this._highlight(netId, false));

        // Kollisionserkennung (vereinfacht)
        for (let i = 1; i < simplified.length; i++) {
          const ax = simplified[i-1].x / opt.gridSize, ay = simplified[i-1].y / opt.gridSize;
          const bx = simplified[i].x / opt.gridSize,   by = simplified[i].y / opt.gridSize;
          const steps = Math.abs(bx-ax) + Math.abs(by-ay);
          const dxs = steps ? (bx-ax)/steps : 0, dys = steps ? (by-ay)/steps : 0;
          for (let s = 0; s < steps; s++) {
            const x1 = Math.round(ax + dxs*s), y1 = Math.round(ay + dys*s);
            const x2 = Math.round(ax + dxs*(s+1)), y2 = Math.round(ay + dys*(s+1));
            const sk = (x1 < x2 || (x1 === x2 && y1 < y2)) ? `${x1},${y1}|${x2},${y2}` : `${x2},${y2}|${x1},${y1}`;
            occupiedSegments.set(sk, netId);
            occupiedCells.set(`${x1},${y1}`, netId);
            occupiedCells.set(`${x2},${y2}`, netId);
          }
        }
      }

      if (steiner) {
        const junc = svgEl('circle', { cx: steiner.x, cy: steiner.y, r: opt.junctionRadius, fill: '#000', 'data-net-id': netId, class: 'ew-junction' });
        wireGroup.appendChild(junc);
        this._log('Steiner point', { x: steiner.x, y: steiner.y });
      }
    }

    return totalTurns;
  }

  render(connectors, connections, blockedAreas) {
    if (connectors !== undefined) this.setConnectors(connectors);
    if (connections !== undefined) this.setConnections(connections);
    if (blockedAreas !== undefined) this.setBlockedAreas(blockedAreas);
    if (this._connectors === null) throw new Error('ElectricalWire: render() called before setConnectors().');
    if (this._connections === null) throw new Error('ElectricalWire: render() called before setConnections().');
    if (this._blocked === null) throw new Error('ElectricalWire: render() called before setBlockedAreas().');

    const W = this._container.offsetWidth, H = this._container.offsetHeight;
    if (W === 0 || H === 0) throw new Error('ElectricalWire: container has no dimensions (width or height is 0). Set an explicit size before calling render().');

    const opt = this._options;
    const gs  = opt.gridSize;

    // Sperrbereiche: Position und Größe aus dem DOM auslesen (relativ zum Container).
    // Die Auswertung erfolgt hier bei render(), damit Änderungen an der DOM-Position
    // der Elemente zwischen setBlockedAreas() und render() automatisch berücksichtigt werden.
    const containerRect = this._container.getBoundingClientRect();
    const shrink = this._blockedShrink;
    const blockedRects = this._blocked.map((el, i) => {
      let x, y, width, height;
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect();
        x      = r.left - containerRect.left + shrink;
        y      = r.top  - containerRect.top  + shrink;
        width  = r.width  - shrink * 2;
        height = r.height - shrink * 2;
      } else {
        // Fertiges Rechteck-Objekt {x, y, width, height} — bereits in Container-Koordinaten
        ({ x, y, width, height } = el);
      }
      if (width <= 0 || height <= 0)
        throw new Error(`ElectricalWire: blocked area at index ${i} has zero dimensions. Ensure the element is visible in the DOM.`);
      return { x, y, width, height };
    });

    // Warnung: fehlender Positionierungskontext
    const pos = (typeof getComputedStyle === 'function')
      ? getComputedStyle(this._container).position
      : (this._container.style && this._container.style.position);
    if (pos === 'static' || pos === '' || pos == null)
      this._warn('container has no CSS positioning context (position is "static"). Set position to "relative", "absolute" or "fixed".');

    // Warnung: Connector innerhalb eines Sperrbereichs
    for (const c of this._connectors) {
      for (const a of blockedRects) {
        if (c.x >= a.x && c.x <= a.x + a.width && c.y >= a.y && c.y <= a.y + a.height) {
          this._warn(`connector "${c.id}" lies within a blocked area. Routing may be impossible.`);
          break;
        }
      }
    }

    // Warnung: Exitpunkt liegt im Sperrbereich, obwohl der Connector selbst außerhalb liegt.
    // Tritt auf wenn minLength den Stub in einen Sperrbereich hineinstreckt.
    // Der Stub wird automatisch verlängert bis er den Bereich verlässt.
    for (const c of this._connectors) {
      const inConnector = blockedRects.some(
        a => c.x >= a.x && c.x <= a.x + a.width && c.y >= a.y && c.y <= a.y + a.height
      );
      if (inConnector) continue; // bereits durch obige Warnung abgedeckt
      const exit = getExitPoint(c, gs);
      const inExit = blockedRects.some(
        a => exit.x >= a.x && exit.x <= a.x + a.width && exit.y >= a.y && exit.y <= a.y + a.height
      );
      if (inExit)
        this._warn(`connector "${c.id}" exit point (${exit.x},${exit.y}) lands inside a blocked area. Stub will be extended in direction "${c.direction}" until clear.`);
    }

    // Warnung: Austrittspunkt eines Connectors liegt im negativen Koordinatenbereich.
    for (const c of this._connectors) {
      const exit = getExitPoint(c, gs);
      if (exit.x < 0 || exit.y < 0)
        this._warn(`connector "${c.id}" exit point (${exit.x}, ${exit.y}) is outside the container (negative coordinates). Increase container size or reduce minLength.`);
    }

    this._log('Render start', { container: { width: W, height: H } });
    this._log('Connectors', this._connectors.map(c => `${c.id}(${c.x},${c.y}) ${c.direction} ${c.minLength}`));
    this._log('Connections', this._connections);
    this._log('Blocked areas', blockedRects);

    this.clear();
    const svg = svgEl('svg', { width: W, height: H, style: 'position:absolute;top:0;left:0;pointer-events:none' });
    this._container.appendChild(svg);
    this._svg = svg;

    // Eigene, hoehere Ebene NUR fuer Connector-/Junction-Punkte + Labels: liegt
    // per z-index ueber den Bloecken (.sim_block hat z-index:10, siehe
    // lib_sym1.css), waehrend die Wires selbst (inkl. der unsichtbaren breiten
    // .ew-wire-hit-Klickpfade, s.u.) unveraendert UNTER den Bloecken bleiben --
    // sonst wuerden diese Klickpfade die Rotate/Remove/Prop-Buttons blockieren.
    // Die Punkte brauchen selbst kein Pointer-Handling (Wire-Erstellung/
    // -Erkennung laeuft in LeSimSchematic.js geometrisch, nicht per DOM-Hit-
    // Test), daher wie gehabt pointer-events:none.
    const pointsSvg = svgEl('svg', { width: W, height: H, style: 'position:absolute;top:0;left:0;pointer-events:none;z-index:20' });
    this._container.appendChild(pointsSvg);
    this._pointsSvg = pointsSvg;

    if (opt.showBlockedAreas) {
      for (const a of blockedRects)
        svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.width, height: a.height, fill: '#eee', 'fill-opacity': 0.5, stroke: '#ccc', 'stroke-width': 1 }));
    }

    const connMap = new Map(this._connectors.map(c => [c.id, c]));
    // Netze
    const uf = new UnionFind();
    for (const c of this._connectors) uf.add(c.id);
    for (const conn of this._connections) uf.union(conn.from, conn.to);
    const nets = new Map();
    for (const c of this._connectors) {
      const root = uf.find(c.id);
      if (!nets.has(root)) nets.set(root, { connectors: [], connections: [] });
      nets.get(root).connectors.push(c);
    }
    for (const conn of this._connections) {
      const root = uf.find(conn.from);
      nets.get(root).connections.push(conn);
    }

    // Map: Connector-ID -> netId (kommaseparierte Connection-IDs des Stromkreises)
    const connectorNetId = new Map();
    for (const [, net] of nets) {
      const nid = net.connections.map(c => c.id).join(',');
      for (const c of net.connectors) connectorNetId.set(c.id, nid);
    }

    // Connectoren werden VOR dem Routing gezeichnet, damit die Punkte auch dann
    // sichtbar sind, wenn das Routing fehlschlägt und render() einen Error
    // wirft. Sie leben von Anfang an in pointsSvg (nicht mehr in der Wire-SVG)
    // -- ein nachtraegliches Verschieben ans SVG-Ende ist damit unnoetig, die
    // separate Ebene liegt schon per z-index ueber allem anderen.
    const connectorLayer = svgEl('g', { class: 'ew-connector-layer' });
    pointsSvg.appendChild(connectorLayer);
    for (const c of this._connectors) {
      const nid = connectorNetId.get(c.id);
      const circle = svgEl('circle', { cx: c.x, cy: c.y, r: opt.connectorRadius, fill: opt.connectorColor, 'data-net-id': nid ?? '', class: 'ew-connector' });
      connectorLayer.appendChild(circle);
      if (opt.showConnectorLabels) {
        const label = svgEl('text', connectorLabelAttrs(c, opt));
        label.textContent = connectorLabelText(c);
        connectorLayer.appendChild(label);
      }
    }
    if (opt.showBlockLabels) {
      for (const block of groupConnectorsByElement(this._connectors)) {
        const blockLabel = svgEl('text', {
          x: block.x, y: block.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': '12', 'font-weight': 'bold', fill: '#000', 'pointer-events': 'none'
        });
        blockLabel.textContent = block.name;
        connectorLayer.appendChild(blockLabel);
      }
    }

    // Zwei Routing-Durchlaeufe mit unterschiedlicher Netz-Reihenfolge; der mit
    // der kuerzeren Gesamt-Wire-Laenge gewinnt. Ohne das haengt das Ergebnis
    // davon ab, in welcher Reihenfolge Connectoren zufaellig deklariert wurden -
    // ein zuerst verarbeitetes Netz kann einem spaeteren "die gute Route
    // wegnehmen" (gefunden in Szenario 18: conn3/conn14 vs. conn7, je nachdem
    // ob DAB_L1a oder V1002/DAB_L2a zuerst als Connector deklariert wurde).
    const netsArr   = [...nets];
    const variantA  = netsArr;
    const variantB  = [...netsArr].reverse();
    const groupA = svgEl('g', {});
    const groupB = svgEl('g', {});
    let turnsA = null, turnsB = null, errA = null, errB = null;
    try { turnsA = this._routeAllNets(variantA, connMap, blockedRects, W, H, gs, opt, groupA); } catch (e) { errA = e; }
    try { turnsB = this._routeAllNets(variantB, connMap, blockedRects, W, H, gs, opt, groupB); } catch (e) { errB = e; }
    if (errA && errB) throw errA;
    const useB = errA || (!errB && turnsB < turnsA);
    this._log('Netz-Reihenfolge-Vergleich', { turnsA, turnsB, gewaehlt: useB ? 'B (umgekehrt)' : 'A (normal)' });
    const winner = useB ? groupB : groupA;
    // Junction-/Steiner-Punkte (.ew-junction) gehoeren visuell zu den Punkten,
    // nicht zu den Wires -- bevor der Rest der Gruppe in die Wire-SVG wandert,
    // werden sie in die Punkte-Ebene (pointsSvg, via connectorLayer) umgehaengt,
    // damit sie wie die Connector-Punkte ueber den Bloecken liegen statt darunter.
    for (const junc of Array.from(winner.querySelectorAll('.ew-junction'))) {
      connectorLayer.appendChild(junc);
    }
    while (winner.firstChild) svg.appendChild(winner.firstChild);
    this._log('Render complete');
    if (opt.logTestCase) this.dumpTestCase();
  }

  /**
   * @brief Schreibt einen reinen Text-Dump (Sperrbereiche, Connectoren,
   *        Connections dieser Instanz) in die Konsole — Basis fuer
   *        reproduzierbare Testszenarien (vgl. die "Szenario N"-Kommentare in
   *        _routeAllNets(), z.B. Szenario 12/13/15/18).
   * @details Wird automatisch am Ende von render() aufgerufen, wenn
   *          opt.logTestCase true ist (Default). Bewusst UNABHAENGIG von
   *          opt.logging: dieser Dump zeichnet nichts und ist reines Text-Log,
   *          kein Routing-Rauschen, und bleibt daher auch an wenn "logging"
   *          aus ist. console.table() klappt bei groesseren Arrays beim
   *          Kopieren aus den DevTools manchmal nur als "Array(n)" zusammen,
   *          ohne die Werte mitzunehmen — dieser Text-Dump ist dagegen immer
   *          vollstaendig kopierbar, unabhaengig von Array-Groesse oder
   *          DevTools-Darstellung. Kann auch manuell aufgerufen werden (z.B.
   *          nach einem fehlgeschlagenen render(), dessen catch-Block sonst
   *          keinen Dump mehr auslöst).
   */
  dumpTestCase() {
    if (this._connectors === null || this._connections === null || this._blocked === null) {
      this._warn('dumpTestCase(): setConnectors()/setConnections()/setBlockedAreas() noch nicht aufgerufen.');
      return;
    }

    const containerRect = this._container.getBoundingClientRect();
    const shrink = this._blockedShrink;
    const blockedText = this._blocked.map((el, i) => {
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect();
        return el.id + ': x=' + (r.left - containerRect.left + shrink) + ', y=' + (r.top - containerRect.top + shrink)
          + ', w=' + (r.width - shrink * 2) + ', h=' + (r.height - shrink * 2);
      }
      return 'blockedArea' + i + ': x=' + el.x + ', y=' + el.y + ', w=' + el.width + ', h=' + el.height;
    }).join('\n');
    const connectorText = this._connectors.map(c => c.id + ': x=' + c.x + ', y=' + c.y + ', dir=' + c.direction).join('\n');
    const connectionText = this._connections.map(c => c.id + ': ' + c.from + ' -> ' + c.to).join('\n');

    const label = this._options.label ? ' ' + this._options.label : '';
    console.log('[TESTCASE_DUMP' + label + '] Klartext-Dump (immer vollstaendig kopierbar):\n\n'
      + '--- Blockierte Elemente ---\n' + blockedText + '\n\n'
      + '--- Connectoren ---\n' + connectorText + '\n\n'
      + '--- Connections ---\n' + connectionText);
  }

  _highlight(netId, on) {
    if (!this._svg) return;
    const opt = this._options;
    this._svg.querySelectorAll(`.ew-wire[data-net-id="${netId}"]`).forEach(el => el.setAttribute('stroke', on ? opt.hoverColor : opt.wireColor));
    // .ew-connector-Punkte leben seit der Punkte-Ebene (pointsSvg) nicht mehr
    // in this._svg, sondern in this._pointsSvg -- hier entsprechend nachziehen.
    if (this._pointsSvg)
      this._pointsSvg.querySelectorAll(`.ew-connector[data-net-id="${netId}"]`).forEach(el => el.setAttribute('fill', on ? opt.hoverColor : opt.connectorColor));
  }
}

// Globaler Export für <script src="electricalWire.js">
if (typeof window !== 'undefined') {
  window.ElectricalWire = ElectricalWire;
}