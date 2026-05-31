const PLAYER_COLORS = ['#ff00ff', '#00e5ff', '#ffe600', '#00ff66'];
import { SERVER_CONFIG } from './config.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(minInclusive, maxExclusive) {
  return Math.floor(Math.random() * (maxExclusive - minInclusive)) + minInclusive;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function keyOf(x, y, cols) {
  return y * cols + x;
}

export class GameEngine {
  constructor({ rows = 10, maxPlayers = 2 }) {
    this.rows = clamp(rows, 6, 20);
    this.cols = this.rows * 2;
    this.maxPlayers = clamp(maxPlayers, 1, 4);

    this.cells = [];
    this.walls = [];
    this.players = [];
    this.ghosts = [];
    this.portals = [];
    this.traps = [];

    this.exit = { x: this.cols - 1, y: randInt(0, this.rows) };
    this.exitLocked = true;
    this.finish = false;
    this.minBright = 0;

    this.enableRadar = false;
    this.enableMapView = false;
    this.maxSightDistance = SERVER_CONFIG.vision.maxSightDistance;

    this.tickMs = 0;
    this._buildCells();
    this._buildWalls();
    this._generateMaze();
    this._spawnWorldItems();
    this._spawnPlayers();
    this._spawnKey();
    this._updateVision();
  }

  static fromExistingRoom(room) {
    const prev = room.engine;
    const next = new GameEngine({ rows: prev.rows, maxPlayers: prev.maxPlayers });

    for (const prevPlayer of prev.players) {
      if (!prevPlayer.socketId) continue;
      const slot = next.players[prevPlayer.id - 1];
      if (!slot) continue;
      slot.socketId = prevPlayer.socketId;
      slot.name = prevPlayer.name;
    }

    room.engine = next;
    room.started = true;
    return next;
  }

  _buildCells() {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        let type = 0;
        const r = Math.random();
        if (r < SERVER_CONFIG.world.radarCellChance) type = 1;
        else if (r < SERVER_CONFIG.world.bluePrintCellChance) type = 2;

        this.cells.push({
          x,
          y,
          type,
          inSight: false,
          bright: 0,
          wallT: null,
          wallB: null,
          wallL: null,
          wallR: null,
          visited: false
        });
      }
    }
  }

  _getCell(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.cells[keyOf(x, y, this.cols)];
  }

  _buildWalls() {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols - 1; x++) {
        const a = this._getCell(x, y);
        const b = this._getCell(x + 1, y);
        const wall = {
          a: keyOf(x, y, this.cols),
          b: keyOf(x + 1, y, this.cols),
          p1: { x: x + 1, y },
          p2: { x: x + 1, y: y + 1 },
          enable: true
        };
        this.walls.push(wall);
        a.wallR = wall;
        b.wallL = wall;
      }
    }

    for (let y = 0; y < this.rows - 1; y++) {
      for (let x = 0; x < this.cols; x++) {
        const a = this._getCell(x, y);
        const b = this._getCell(x, y + 1);
        const wall = {
          a: keyOf(x, y, this.cols),
          b: keyOf(x, y + 1, this.cols),
          p1: { x, y: y + 1 },
          p2: { x: x + 1, y: y + 1 },
          enable: true
        };
        this.walls.push(wall);
        a.wallB = wall;
        b.wallT = wall;
      }
    }
  }

  _generateMaze() {
    const start = pickRandom(this.cells);
    start.visited = true;

    const wallList = [];
    this._addCellWalls(start, wallList);

    while (wallList.length > 0) {
      const idx = randInt(0, wallList.length);
      const wall = wallList[idx];
      const cellA = this.cells[wall.a];
      const cellB = this.cells[wall.b];
      const exactlyOneVisited = (cellA.visited && !cellB.visited) || (!cellA.visited && cellB.visited);

      if (exactlyOneVisited) {
        wall.enable = false;
        const newCell = cellA.visited ? cellB : cellA;
        newCell.visited = true;
        this._addCellWalls(newCell, wallList);
      }

      wallList.splice(idx, 1);
    }
  }

  _addCellWalls(cell, list) {
    const maybeAdd = (wall) => {
      if (wall && wall.enable) list.push(wall);
    };
    maybeAdd(cell.wallT);
    maybeAdd(cell.wallB);
    maybeAdd(cell.wallL);
    maybeAdd(cell.wallR);
  }

  _spawnPlayers() {
    const rows = Array.from({ length: this.rows }, (_, i) => i);
    for (let i = rows.length - 1; i > 0; i--) {
      const j = randInt(0, i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }

    for (let i = 0; i < this.maxPlayers; i++) {
      this.players.push({
        id: i + 1,
        socketId: null,
        name: `Player ${i + 1}`,
        color: PLAYER_COLORS[i],
        x: 0,
        y: rows[i % rows.length],
        cx: 0,
        cy: rows[i % rows.length],
        fx: 0,
        fy: rows[i % rows.length],
        dead: 0,
        escaped: false,
        fall: false,
        diameter: 0.5,
        reviveStartedAt: 0,
        lastMoveAt: 0,
        trapCooldownAt: 0
      });
    }
  }

  _spawnWorldItems() {
    const total = this.rows * this.cols;
    for (let i = 0; i < total; i++) {
      if (Math.random() < SERVER_CONFIG.ghost.spawnChance) {
        this.ghosts.push({
          x: randInt(Math.floor(this.cols / 4), this.cols),
          y: randInt(0, this.rows),
          cx: 0,
          cy: 0,
          fx: 0,
          fy: 0,
          dead: false,
          fall: false,
          crazy: Math.random() < SERVER_CONFIG.ghost.crazyChance,
          lastMoveAt: 0,
          diameter: 0.5
        });
        const g = this.ghosts[this.ghosts.length - 1];
        g.cx = g.x;
        g.cy = g.y;
        g.fx = g.x;
        g.fy = g.y;
      }

      if (Math.random() < SERVER_CONFIG.world.portalSpawnChance) {
        this.portals.push({
          x: i % this.cols,
          y: Math.floor(i / this.cols),
          activationMs: SERVER_CONFIG.world.portalReloadMs,
          pulse: 1,
          pulseDir: 1
        });
      }
    }
  }

  _spawnKey() {
    this.keyOwner = {
      type: 'cell',
      x: randInt(1, this.cols),
      y: randInt(1, this.rows)
    };
  }

  attachPlayer(socketId, name) {
    const slot = this.players.find((p) => !p.socketId);
    if (!slot) return null;
    slot.socketId = socketId;
    if (name && String(name).trim()) slot.name = String(name).trim().slice(0, 20);
    return slot;
  }

  detachPlayer(socketId) {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    player.socketId = null;
  }

  getConnectedPlayers() {
    return this.players.filter((p) => p.socketId);
  }

  isEmptyRoom() {
    return this.players.every((p) => !p.socketId);
  }

  update(dtMs, inputBySocket) {
    this.tickMs += dtMs;

    for (const p of this.portals) {
      if (p.activationMs > 0) p.activationMs -= dtMs;
      p.pulse += dtMs * SERVER_CONFIG.world.portalPulseSpeedPerMs * p.pulseDir;
      if (p.pulse >= SERVER_CONFIG.world.portalPulseMax) {
        p.pulse = SERVER_CONFIG.world.portalPulseMax;
        p.pulseDir = -1;
      }
      if (p.pulse <= SERVER_CONFIG.world.portalPulseMin) {
        p.pulse = SERVER_CONFIG.world.portalPulseMin;
        p.pulseDir = 1;
      }
    }

    this._updatePlayers(dtMs, inputBySocket);
    this._updateGhosts(dtMs);
    this._updateTraps(dtMs);

    if (this.finish) {
      this.minBright = Math.min(100, this.minBright + (dtMs / 1000) * SERVER_CONFIG.finish.fadePerSecond);
      for (const cell of this.cells) {
        cell.inSight = true;
        cell.bright = this._ambientBright(cell);
      }
      return;
    }

    if (this._allPlayersInactive()) {
      this.finish = true;
    }

    this._updateVision();
  }

  _updatePlayers(dtMs, inputBySocket) {
    for (const player of this.players) {
      this._lerpEntity(player, dtMs);

      if (player.fall) {
        player.diameter = Math.max(0, player.diameter - dtMs * 0.0008);
        if (player.diameter <= 0.05) {
          player.dead = 2;
          player.fall = false;
          this._updateKeyOwnerOnDeath(player);
        }
      }

      if (player.escaped || player.dead === 2) continue;

      if (player.dead === 1) {
        if (this._hasActivePlayerAt(player.x, player.y)) {
          if (!player.reviveStartedAt) player.reviveStartedAt = this.tickMs;
          if (this.tickMs - player.reviveStartedAt >= SERVER_CONFIG.player.reviveMs) {
            player.dead = 0;
            player.reviveStartedAt = 0;
          }
        } else {
          player.reviveStartedAt = 0;
        }
        continue;
      }

      if (!player.socketId) continue;

      const input = inputBySocket.get(player.socketId) || {};
      const move = this._getMoveFromInput(input);
      if (move) {
        if (this.tickMs - player.lastMoveAt >= SERVER_CONFIG.player.moveCooldownMs) {
          if (this._canMove(player, move, true)) {
            this._applyMove(player, move);
          }
          player.lastMoveAt = this.tickMs;
        }

        // Edge-trigger movement: one key press -> one move attempt.
        input[move] = false;
      }

      if (input.trap && this.tickMs >= player.trapCooldownAt) {
        this._placeTrap(player.x, player.y);
        player.trapCooldownAt = this.tickMs + SERVER_CONFIG.player.trapCooldownMs;
      }

      this._checkUnlockExit(player);
      this._checkPortalFor(player);
      this._checkTrapFor(player);
    }
  }

  _updateGhosts(dtMs) {
    for (const ghost of this.ghosts) {
      this._lerpEntity(ghost, dtMs);

      if (ghost.fall) {
        ghost.dead = true;
        continue;
      }

      const moveDelay = ghost.crazy ? SERVER_CONFIG.ghost.crazyMoveMs : SERVER_CONFIG.ghost.moveMs;
      if (this.tickMs - ghost.lastMoveAt >= moveDelay) {
        const dirs = ['up', 'down', 'left', 'right'];
        let moved = false;
        for (let i = 0; i < 8 && !moved; i++) {
          const dir = pickRandom(dirs);
          if (this._canMove(ghost, dir, false)) {
            this._applyMove(ghost, dir);
            moved = true;
          }
        }
        ghost.lastMoveAt = this.tickMs;
      }

      for (const player of this.players) {
        if (player.dead || player.escaped) continue;
        if (Math.round(player.cx) === Math.round(ghost.cx) && Math.round(player.cy) === Math.round(ghost.cy)) {
          player.dead = 1;
          player.x = ghost.x;
          player.y = ghost.y;
          player.fx = ghost.x;
          player.fy = ghost.y;
          player.cx = ghost.x;
          player.cy = ghost.y;
          this._updateKeyOwnerOnDeath(player);
        }
      }

      this._checkPortalFor(ghost);
      this._checkTrapFor(ghost);
    }

    this.ghosts = this.ghosts.filter((g) => !g.dead);
  }

  _updateTraps(dtMs) {
    for (const trap of this.traps) {
      if (!trap.set) {
        trap.inner += dtMs * trap.rate;
        if (trap.inner >= trap.outer * 0.8) {
          trap.inner = trap.outer * 0.8;
          trap.set = true;
        }
        continue;
      }

      if (trap.timerMs > 0) {
        trap.timerMs -= dtMs;
      } else {
        trap.inner -= dtMs * trap.rate;
        if (trap.inner <= 0) trap.dead = true;
      }
    }

    this.traps = this.traps.filter((t) => !t.dead);
  }

  _lerpEntity(entity, dtMs) {
    // Mirror the original feel where movement eases toward target over time, not per tick.
    const ratio = 1 - Math.pow(1 - SERVER_CONFIG.motion.lerpBase, dtMs / 1000);
    entity.cx += (entity.fx - entity.cx) * ratio;
    entity.cy += (entity.fy - entity.cy) * ratio;
  }

  _getMoveFromInput(input) {
    if (input.up) return 'up';
    if (input.down) return 'down';
    if (input.left) return 'left';
    if (input.right) return 'right';
    return null;
  }

  _checkUnlockExit(player) {
    if (player.x === this.exit.x && player.y === this.exit.y && this.keyOwner?.type === 'player' && this.keyOwner.playerId === player.id) {
      this.keyOwner = null;
      this.exitLocked = false;
    }
  }

  _placeTrap(x, y) {
    if (this.traps.some((t) => t.x === x && t.y === y && !t.dead)) return;
    this.traps.push({
      x,
      y,
      outer: 0.7,
      inner: 0,
      set: false,
      dead: false,
      timerMs: SERVER_CONFIG.trap.activeMs,
      rate: SERVER_CONFIG.trap.openCloseRatePerMs
    });
  }

  _checkTrapFor(entity) {
    if (entity.dead || entity.escaped) return;

    const ex = Math.round(entity.cx);
    const ey = Math.round(entity.cy);

    for (const trap of this.traps) {
      if (!trap.set || trap.timerMs <= 0) continue;
      if (trap.x === ex && trap.y === ey) {
        entity.x = ex;
        entity.y = ey;
        entity.fx = ex;
        entity.fy = ey;
        entity.fall = true;
        trap.timerMs = 0;
        return;
      }
    }
  }

  _checkPortalFor(entity) {
    if (entity.dead || entity.escaped || entity.fall) return;

    const ex = Math.round(entity.cx);
    const ey = Math.round(entity.cy);

    for (const portal of this.portals) {
      if (portal.activationMs > 0) continue;
      if (portal.x === ex && portal.y === ey) {
        this._teleportPortal(portal);
        entity.x = portal.x;
        entity.y = portal.y;
        entity.fx = portal.x;
        entity.fy = portal.y;
        entity.cx = portal.x;
        entity.cy = portal.y;
        return;
      }
    }
  }

  _teleportPortal(portal) {
    let nextX = portal.x;
    let nextY = portal.y;
    let safe = 0;

    while (safe < 200) {
      safe += 1;
      nextX = randInt(0, this.cols);
      nextY = randInt(0, this.rows);
      if (!this.portals.some((p) => p !== portal && p.x === nextX && p.y === nextY)) break;
    }

    portal.x = nextX;
    portal.y = nextY;
    portal.activationMs = SERVER_CONFIG.world.portalReloadMs;
  }

  _updateKeyOwnerOnDeath(player) {
    if (!this.keyOwner || this.keyOwner.type !== 'player' || this.keyOwner.playerId !== player.id) return;
    this.keyOwner = { type: 'cell', x: Math.round(player.cx), y: Math.round(player.cy) };
  }

  _canMove(entity, dir, canEscape) {
    if (entity.fall || entity.dead || entity.escaped) return false;

    let nx = entity.x;
    let ny = entity.y;
    if (dir === 'up') ny -= 1;
    else if (dir === 'down') ny += 1;
    else if (dir === 'left') nx -= 1;
    else if (dir === 'right') nx += 1;
    else return false;

    if (canEscape && nx === this.cols && ny === this.exit.y) {
      return !this.exitLocked;
    }

    nx = clamp(nx, 0, this.cols - 1);
    ny = clamp(ny, 0, this.rows - 1);

    const current = this._getCell(entity.x, entity.y);
    let wall = null;
    if (ny < entity.y) wall = current.wallT;
    else if (ny > entity.y) wall = current.wallB;
    else if (nx < entity.x) wall = current.wallL;
    else if (nx > entity.x) wall = current.wallR;

    if (!wall || wall.enable) return false;
    return true;
  }

  _applyMove(entity, dir) {
    if (dir === 'up') entity.y -= 1;
    else if (dir === 'down') entity.y += 1;
    else if (dir === 'left') entity.x -= 1;
    else if (dir === 'right') entity.x += 1;

    entity.fx = entity.x;
    entity.fy = entity.y;

    if (entity.x >= this.cols) {
      entity.escaped = true;
      return;
    }

    if (entity.id && this.keyOwner?.type === 'cell' && this.keyOwner.x === entity.x && this.keyOwner.y === entity.y) {
      this.keyOwner = { type: 'player', playerId: entity.id };
    }
  }

  _allPlayersInactive() {
    const connected = this.getConnectedPlayers();
    if (connected.length === 0) return false;
    return connected.every((p) => p.dead || p.escaped);
  }

  _hasActivePlayerAt(x, y) {
    return this.players.some((p) => p.socketId && !p.dead && !p.escaped && p.x === x && p.y === y);
  }

  _ambientBright(cell) {
    const connected = this.getConnectedPlayers();
    if (connected.length === 0) return this.minBright;

    let min = Number.POSITIVE_INFINITY;
    for (const p of connected) {
      const d = Math.hypot(cell.x - p.x, cell.y - p.y);
      min = Math.min(min, d);
    }

    const t = clamp(min / this.maxSightDistance, 0, 1);
    return 100 - t * (100 - this.minBright);
  }

  _lineOfSight(a, b) {
    if (a.x === b.x) {
      if (a.y < b.y) {
        for (let y = a.y; y < b.y; y++) {
          const c = this._getCell(a.x, y);
          if (c.wallB?.enable) return false;
        }
      } else {
        for (let y = a.y; y > b.y; y--) {
          const c = this._getCell(a.x, y);
          if (c.wallT?.enable) return false;
        }
      }
      return true;
    }

    if (a.y === b.y) {
      if (a.x < b.x) {
        for (let x = a.x; x < b.x; x++) {
          const c = this._getCell(x, a.y);
          if (c.wallR?.enable) return false;
        }
      } else {
        for (let x = a.x; x > b.x; x--) {
          const c = this._getCell(x, a.y);
          if (c.wallL?.enable) return false;
        }
      }
      return true;
    }

    return false;
  }

  _updateVision() {
    this.enableRadar = false;
    this.enableMapView = false;

    for (const c of this.cells) {
      c.inSight = false;
      c.bright = 0;
    }

    for (const player of this.players) {
      if (!player.socketId || player.dead || player.escaped) continue;
      const current = this._getCell(player.x, player.y);
      if (!current) continue;

      if (current.type === 1) this.enableRadar = true;
      if (current.type === 2) this.enableMapView = true;

      current.inSight = true;
      current.bright = Math.max(current.bright, this._brightFromPlayer(current, player));

      this._castLineVision(current, 0, -1, player);
      this._castLineVision(current, 0, 1, player);
      this._castLineVision(current, -1, 0, player);
      this._castLineVision(current, 1, 0, player);
    }
  }

  _castLineVision(origin, dx, dy, player) {
    let x = origin.x + dx;
    let y = origin.y + dy;

    while (x >= 0 && y >= 0 && x < this.cols && y < this.rows) {
      const prev = this._getCell(x - dx, y - dy);
      const curr = this._getCell(x, y);
      if (!prev || !curr) break;

      let blocked = false;
      if (dx === 1) blocked = prev.wallR?.enable;
      if (dx === -1) blocked = prev.wallL?.enable;
      if (dy === 1) blocked = prev.wallB?.enable;
      if (dy === -1) blocked = prev.wallT?.enable;
      if (blocked) break;

      curr.inSight = true;
      curr.bright = Math.max(curr.bright, this._brightFromPlayer(curr, player));

      x += dx;
      y += dy;
    }
  }

  _brightFromPlayer(cell, player) {
    const d = Math.hypot(cell.x - player.x, cell.y - player.y);
    const t = clamp(d / this.maxSightDistance, 0, 1);
    return 100 - t * (100 - this.minBright);
  }

  getSnapshot() {
    const key = this._resolveKeyPosition();
    return {
      rows: this.rows,
      cols: this.cols,
      finish: this.finish,
      minBright: this.minBright,
      enableRadar: this.enableRadar,
      enableMapView: this.enableMapView,
      canRestart: this.finish,
      exit: {
        x: this.exit.x,
        y: this.exit.y,
        locked: this.exitLocked
      },
      key,
      cells: this.cells.map((c) => ({
        x: c.x,
        y: c.y,
        type: c.type,
        inSight: c.inSight,
        bright: c.bright
      })),
      walls: this.walls.map((w) => ({
        p1: w.p1,
        p2: w.p2,
        enable: w.enable,
        bright: w.enable ? Math.max(this.cells[w.a].bright, this.cells[w.b].bright) : 0,
        visible: w.enable && (this.cells[w.a].inSight || this.cells[w.b].inSight)
      })),
      players: this.players.map((p) => ({
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        cx: p.cx,
        cy: p.cy,
        dead: p.dead,
        escaped: p.escaped,
        diameter: p.diameter,
        hasKey: this.keyOwner?.type === 'player' && this.keyOwner.playerId === p.id
      })),
      ghosts: this.ghosts.map((g) => ({
        x: g.x,
        y: g.y,
        cx: g.cx,
        cy: g.cy,
        crazy: g.crazy,
        hasKey: false
      })),
      portals: this.portals.map((p) => ({
        x: p.x,
        y: p.y,
        active: p.activationMs <= 0,
        pulse: p.pulse
      })),
      traps: this.traps.map((t) => ({
        x: t.x,
        y: t.y,
        outer: t.outer,
        inner: t.inner,
        set: t.set,
        active: t.set && t.timerMs > 0
      }))
    };
  }

  _resolveKeyPosition() {
    if (!this.keyOwner) return null;
    if (this.keyOwner.type === 'cell') {
      return { type: 'cell', x: this.keyOwner.x, y: this.keyOwner.y };
    }
    const owner = this.players.find((p) => p.id === this.keyOwner.playerId);
    if (!owner) return null;
    return { type: 'player', playerId: owner.id, x: owner.cx, y: owner.cy };
  }

  getRoomStatus() {
    const players = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: Boolean(p.socketId),
      color: p.color,
      escaped: p.escaped,
      dead: p.dead
    }));

    return {
      rows: this.rows,
      maxPlayers: this.maxPlayers,
      connected: players.filter((p) => p.connected).length,
      players
    };
  }
}
