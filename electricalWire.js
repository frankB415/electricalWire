// electricalWire.js – minLength gilt immer (auch in Sperrbereichen); gridW/gridH deckt Exit-Punkte außerhalb des Containers ab

const DEFAULTS = {
  gridSize:        10,
  wireColor:       '#1a1a1a',
  wireWidth:       2,
  stubColor:       '#2563eb',   // Farbe des minLength-Stubs (und Escape-Pfads)
  connectorRadius: 5,
  connectorColor:  '#e00',
  junctionRadius:  4,
  showBlockedAreas:    false,
  showConnectorLabels: true,
  hoverColor:      '#e67e00',
  logging:         true
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
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

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

// forbiddenDir: Richtung, die beim Escape nicht erlaubt ist — typischerweise
// OPPOSITE[conn.direction], damit der Wire nicht durch den Stub zurückläuft.
function findShortestEscape(gx, gy, blockedGridRanges, gridSize, forbiddenDir) {
  const inBlocked = (x, y) =>
    blockedGridRanges.some(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  if (!inBlocked(gx, gy)) return null;

  const DIRS = [[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']];
  let bestPixel = null, bestSteps = Infinity;
  for (const [dx, dy, dir] of DIRS) {
    if (dir === forbiddenDir) continue;
    let x = gx, y = gy, steps = 0;
    while (inBlocked(x, y) && steps < 2000) { x += dx; y += dy; steps++; }
    if (!inBlocked(x, y) && steps < bestSteps) {
      bestSteps = steps;
      bestPixel = { x: x * gridSize, y: y * gridSize };
    }
  }
  return bestPixel;
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
// um TURN_COST. Da TURN_COST < 1 (Kosten einer einzelnen Gridzelle), hat die
// Gesamtlänge immer Vorrang; Ecken werden nur dort reduziert, wo Länge und
// Eckenanzahl gemeinsam optimiert werden können.
//
// forceFreeCells: Set von "gx,gy"-Schlüsseln, die aus dem Blocked-Set freigegeben
// werden. Ermöglicht A*-Start/Ziel innerhalb eines Sperrbereichs (minLength-Stub).
// startDir: Anflugrichtung am Startpunkt (Connector-Richtung), oder null für
// Steiner-Startpunkte ohne definierte Richtung.
function aStarPath(a, b, blockedAreas, gridSize, containerW, containerH, occupiedSegments, logger, label, extraBlocked, forceFreeCells, startDir) {
  const TURN_COST = 0.5;  // < 1 → Länge hat Vorrang vor Eckenanzahl

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

  const open     = new Map();
  const closed   = new Set();
  const gScore   = new Map();
  const fScore   = new Map();
  const cameFrom = new Map();

  // Startknoten: bekannte Anflugrichtung → einzelner Zustand; Steiner-Start → alle 4.
  const h0       = manhattanDist({ x: sx, y: sy }, { x: tx, y: ty });
  const initDirs = startDir != null ? [startDir] : ['right', 'left', 'down', 'up'];
  for (const d of initDirs) {
    const k = stateKey(sx, sy, d);
    gScore.set(k, 0);
    fScore.set(k, h0);
    open.set(k, { x: sx, y: sy, d });
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
    let curKey = null, curF = Infinity;
    for (const [k] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < curF) { curF = f; curKey = k; }
    }
    const cur = open.get(curKey);
    open.delete(curKey);
    closed.add(curKey);

    if (cur.x === tx && cur.y === ty) {
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
      const collPenalty = (occupiedSegments && occupiedSegments.has(sk)) ? COLLISION_COST : 0;
      const turnPenalty = (cur.d !== dName) ? TURN_COST : 0;
      const tentative   = (gScore.get(curKey) ?? Infinity) + 1 + collPenalty + turnPenalty;

      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, curKey);
        gScore.set(nk, tentative);
        fScore.set(nk, tentative + manhattanDist({ x: nx, y: ny }, { x: tx, y: ty }));
        open.set(nk, { x: nx, y: ny, d: dName });
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

// Pfadvereinfachung: Entfernt Punkte, die auf einer geraden Linie liegen
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
    this._blocked = null;
    this._svg = null;
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

  setBlockedAreas(areas) {
    if (!Array.isArray(areas)) throw new Error('ElectricalWire: setBlockedAreas() expects an array.');
    areas.forEach((a, i) => {
      if (!(a instanceof HTMLElement))
        throw new Error(`ElectricalWire: blocked area at index ${i} is not an HTMLElement.`);
    });
    this._blocked = areas;
  }

  clear() { if (this._svg) { this._svg.remove(); this._svg = null; } }

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
    const blockedRects = this._blocked.map((el, i) => {
      const r = el.getBoundingClientRect();
      const x = r.left - containerRect.left;
      const y = r.top  - containerRect.top;
      const width  = r.width;
      const height = r.height;
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

    // Gitterraum-Grenzen der Sperrbereiche (identisch zu buildBlockedSet) –
    // für alle Warn-Checks damit Connector- und Exitpunkt-Klassifizierung
    // konsistent mit dem Routing-Grid ist.
    const blockedGridRanges = blockedRects.map(a => ({
      x0: Math.floor(a.x / gs),
      y0: Math.floor(a.y / gs),
      x1: Math.ceil((a.x + a.width)  / gs),
      y1: Math.ceil((a.y + a.height) / gs),
    }));
    const inAnyGridRange = (px, py) => {
      const gx = Math.round(px / gs), gy = Math.round(py / gs);
      return blockedGridRanges.some(r => gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1);
    };

    // Warnung: Connector innerhalb eines Sperrbereichs
    for (const c of this._connectors) {
      if (inAnyGridRange(c.x, c.y))
        this._warn(`connector "${c.id}" lies within a blocked area. Routing may be impossible.`);
    }

    // Warnung: Exitpunkt liegt im Sperrbereich, obwohl der Connector selbst außerhalb liegt.
    for (const c of this._connectors) {
      if (inAnyGridRange(c.x, c.y)) continue; // bereits durch obige Warnung abgedeckt
      const exit = getExitPoint(c, gs);
      if (inAnyGridRange(exit.x, exit.y))
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
    const svg = svgEl('svg', { width: W, height: H, style: 'position:absolute;top:0;left:0' });
    this._container.appendChild(svg);
    this._svg = svg;

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

    // Connectoren werden VOR dem Routing in eine eigene Ebene gezeichnet, damit
    // die roten Punkte auch dann sichtbar sind, wenn das Routing fehlschlägt und
    // render() einen Error wirft. Nach erfolgreichem Routing wird diese Ebene ans
    // SVG-Ende verschoben, damit die Connectoren weiterhin über den Wires liegen.
    const connectorLayer = svgEl('g', { class: 'ew-connector-layer' });
    svg.appendChild(connectorLayer);
    for (const c of this._connectors) {
      const nid = connectorNetId.get(c.id);
      const circle = svgEl('circle', { cx: c.x, cy: c.y, r: opt.connectorRadius, fill: opt.connectorColor, 'data-net-id': nid ?? '', class: 'ew-connector' });
      connectorLayer.appendChild(circle);
      if (opt.showConnectorLabels) {
        const label = svgEl('text', { x: c.x, y: c.y - opt.connectorRadius - 4, 'text-anchor': 'middle', 'font-size': '11', fill: '#333', 'pointer-events': 'none' });
        label.textContent = c.id;
        connectorLayer.appendChild(label);
      }
    }

    const occupiedSegments = new Set();

    // Stub-Endpunkte für alle Connectoren vorausberechnen.
    // connStubInfo enthält pro Connector: exitPoint (Ende minLength-Stub) und
    // actualStart (erste freie Zelle nach Escape, = exitPoint wenn kein Escape nötig).
    // Diese Werte werden (a) für das Routing verwendet und (b) in blockStub eingetragen,
    // damit kein anderer Wire durch irgendeinen Stub oder Escape-Pfad läuft.
    const connStubInfo = new Map();
    for (const c of this._connectors) {
      const exitPoint = getExitPoint(c, gs);
      const exitGx = Math.round(exitPoint.x / gs), exitGy = Math.round(exitPoint.y / gs);
      const escape  = findShortestEscape(exitGx, exitGy, blockedGridRanges, gs, OPPOSITE[c.direction]);
      connStubInfo.set(c.id, { exitPoint, actualStart: escape ?? exitPoint });
    }

    for (const [root, net] of nets) {
      const netConnectors = net.connectors;
      const netId = net.connections.map(c => c.id).join(',');
      let steiner = null;
      if (netConnectors.length >= 3) steiner = findSteinerPoint(netConnectors);
      const allNodes = steiner ? [...netConnectors, { id: '__steiner__', x: steiner.x, y: steiner.y }] : netConnectors;
      const edges = buildMST(allNodes);
      const wireGroup = svgEl('g', { 'data-net-id': netId, class: 'ew-net' });
      svg.appendChild(wireGroup);

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

        // Stub-Endpunkte aus der vorausberechneten Map holen.
        const startInfo = startConn ? connStubInfo.get(startConn.id) : null;
        const endInfo   = endConn   ? connStubInfo.get(endConn.id)   : null;
        const actualStart = startInfo ? startInfo.actualStart : startPoint;
        const actualEnd   = endInfo   ? endInfo.actualStart   : endPoint;
        // escapeS/escapeE: non-null wenn Escape stattfand (exitPoint ≠ actualStart)
        const escapeS = startInfo && (startInfo.actualStart.x !== startInfo.exitPoint.x || startInfo.actualStart.y !== startInfo.exitPoint.y) ? startInfo.exitPoint : null;
        const escapeE = endInfo   && (endInfo.actualStart.x   !== endInfo.exitPoint.x   || endInfo.actualStart.y   !== endInfo.exitPoint.y)   ? endInfo.exitPoint   : null;

        this._log('Routing', { edge: `${nodeA.id}→${nodeB.id}`, start: `(${startPoint.x},${startPoint.y})`, end: `(${endPoint.x},${endPoint.y})` });

        // Connector-Zellen, Stub-Korridore UND Escape-Pfade aller Connectoren sperren.
        // Kein Wire darf jemals durch einen Stub (inkl. Escape) eines anderen Connectors laufen.
        const cellKey = (p) => `${snapToGrid(p.x, gs) / gs},${snapToGrid(p.y, gs) / gs}`;
        const extraBlocked = new Set();
        const blockStub = (conn) => {
          const info = connStubInfo.get(conn.id);
          // 1) connector.pos → exitPoint (minLength-Abschnitt)
          const x0 = snapToGrid(conn.x, gs) / gs,      y0 = snapToGrid(conn.y, gs) / gs;
          const x1 = snapToGrid(info.exitPoint.x, gs) / gs, y1 = snapToGrid(info.exitPoint.y, gs) / gs;
          let dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
          let x = x0, y = y0;
          while (true) { extraBlocked.add(`${x},${y}`); if (x === x1 && y === y1) break; x += dx; y += dy; }
          // 2) exitPoint → actualStart (Escape-Abschnitt, falls vorhanden)
          const x2 = snapToGrid(info.actualStart.x, gs) / gs, y2 = snapToGrid(info.actualStart.y, gs) / gs;
          if (x2 !== x1 || y2 !== y1) {
            dx = Math.sign(x2 - x1); dy = Math.sign(y2 - y1);
            x = x1; y = y1;
            while (true) { extraBlocked.add(`${x},${y}`); if (x === x2 && y === y2) break; x += dx; y += dy; }
          }
        };
        for (const c of this._connectors) {
          extraBlocked.add(cellKey(c));
          if (c.minLength > 0) blockStub(c);
        }
        // Die tatsächlichen A*-Endpunkte aus dem extraBlocked-Set freigeben.
        extraBlocked.delete(cellKey(actualStart));
        extraBlocked.delete(cellKey(actualEnd));

        this._log('Routing effective', {
          edge: `${nodeA.id}→${nodeB.id}`,
          actualStart: `(${actualStart.x},${actualStart.y})`,
          actualEnd:   `(${actualEnd.x},${actualEnd.y})`,
          escapeStart: escapeS ? `(${startPoint.x},${startPoint.y})→(${actualStart.x},${actualStart.y})` : null,
          escapeEnd:   escapeE ? `(${endPoint.x},${endPoint.y})→(${actualEnd.x},${actualEnd.y})`         : null,
          extraBlockedCount: extraBlocked.size,
        });

        // forceFreeCells: nur noch actualStart und actualEnd freischalten.
        // actualStart liegt per Konstruktion bereits außerhalb aller Sperrbereiche.
        const forceFreeCells = new Set([cellKey(actualStart), cellKey(actualEnd)]);
        const startDir = startConn ? startConn.direction : null;
        let route = aStarPath(actualStart, actualEnd, blockedRects, opt.gridSize, W, H, occupiedSegments, this._log.bind(this), `${nodeA.id}→${nodeB.id}`, extraBlocked, forceFreeCells, startDir);
        if (!route) {
          const cid = orig ? orig.id : netId;
          const fId = orig ? orig.from : nodeA.id;
          const tId = orig ? orig.to   : nodeB.id;
          this._log('Error before throw', { connectionId: cid, from: fId, to: tId });
          throw new Error(`ElectricalWire: no path found for connection "${cid}" (from "${fId}" to "${tId}"). Check blocked areas.`);
        }

        const midRoute = removeSpikes(route);

        // Gesamtpfad: connectorPos → [exitPoint wenn Escape] → actualStart → A*-Route
        //             → actualEnd → [exitPoint wenn Escape] → connectorPos
        const full = [];
        if (startConn) {
          full.push({ x: startConn.x, y: startConn.y });
          if (escapeS) full.push(startPoint); // Knickpunkt am Ende des minLength-Stubs
        }
        full.push(...midRoute);
        if (endConn) {
          if (escapeE) full.push(endPoint);
          full.push({ x: endConn.x, y: endConn.y });
        }

        const unique = [];
        for (let i = 0; i < full.length; i++) {
          if (i === 0 || full[i].x !== full[i-1].x || full[i].y !== full[i-1].y)
            unique.push(full[i]);
        }
        const simplified = simplifyPath(unique);
        const d = simplified.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');

        this._log('Final path', { netId, d });

        // Hauptpfad in wireColor
        const wire = svgEl('path', { d, stroke: opt.wireColor, 'stroke-width': opt.wireWidth, fill: 'none', 'stroke-linecap': 'square', 'data-net-id': netId, class: 'ew-wire' });
        wireGroup.appendChild(wire);
        const hit = svgEl('path', { d, stroke: opt.wireColor, 'stroke-width': Math.max(8, opt.wireWidth+6), fill: 'none', opacity: '0', 'data-net-id': netId, class: 'ew-wire-hit' });
        wireGroup.appendChild(hit);
        hit.addEventListener('mouseenter', () => this._highlight(netId, true));
        hit.addEventListener('mouseleave', () => this._highlight(netId, false));

        // Stub-Overlay in stubColor: connector → [exitPoint →] actualStart.
        // Liegt kein Escape vor (escapeS/E null), ist exitPoint = actualStart → gerade Linie.
        // Mit Escape (exitPoint ≠ actualStart) wird die L-Form gezeichnet.
        const drawStub = (from, via, to) => {
          if (from.x === to.x && from.y === to.y) return;
          const pts = [from];
          if (via && (via.x !== to.x || via.y !== to.y)) pts.push(via);
          pts.push(to);
          const ds = pts.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
          wireGroup.appendChild(svgEl('path', { d: ds, stroke: opt.stubColor, 'stroke-width': opt.wireWidth, fill: 'none', 'stroke-linecap': 'square', 'data-net-id': netId, class: 'ew-stub' }));
        };
        if (startConn) drawStub({ x: startConn.x, y: startConn.y }, escapeS ? startPoint : null, actualStart);
        if (endConn)   drawStub({ x: endConn.x,   y: endConn.y   }, escapeE ? endPoint   : null, actualEnd);

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
            occupiedSegments.add(sk);
          }
        }
      }

      if (steiner) {
        const junc = svgEl('circle', { cx: steiner.x, cy: steiner.y, r: opt.junctionRadius, fill: '#000', 'data-net-id': netId, class: 'ew-junction' });
        wireGroup.appendChild(junc);
        this._log('Steiner point', { x: steiner.x, y: steiner.y });
      }
    }

    // Connectoren wurden bereits vor dem Routing gezeichnet (siehe connectorLayer).
    // Da das Routing erfolgreich war, die Ebene ans SVG-Ende verschieben, damit die
    // roten Punkte über den Wires liegen.
    svg.appendChild(connectorLayer);
    this._log('Render complete');
  }

  _highlight(netId, on) {
    if (!this._svg) return;
    const opt = this._options;
    this._svg.querySelectorAll(`.ew-wire[data-net-id="${netId}"]`).forEach(el => el.setAttribute('stroke', on ? opt.hoverColor : opt.wireColor));
    this._svg.querySelectorAll(`.ew-stub[data-net-id="${netId}"]`).forEach(el => el.setAttribute('stroke', on ? opt.hoverColor : opt.stubColor));
    this._svg.querySelectorAll(`.ew-connector[data-net-id="${netId}"]`).forEach(el => el.setAttribute('fill', on ? opt.hoverColor : opt.connectorColor));
  }
}

export { ElectricalWire as default };



// UMD/IIFE-Export: ElectricalWire global verfügbar machen
if (typeof window !== 'undefined') {
  window.ElectricalWire = ElectricalWire;
}