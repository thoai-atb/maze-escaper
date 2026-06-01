const PLAYER_COLORS = ['#ff00ff', '#00e5ff', '#ffe600', '#00ff66', '#ff7a00', '#8a5cff'];
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

const LEVEL_MIN = SERVER_CONFIG.level.min;
const LEVEL_MAX = SERVER_CONFIG.level.max;
const LEVEL_ROW_STEPS = SERVER_CONFIG.level.rowSteps;

function normalizeLevel(level) {
  return clamp(Number(level) || LEVEL_MIN, LEVEL_MIN, LEVEL_MAX);
}

function rowsForLevel(level) {
  const normalized = normalizeLevel(level);
  return LEVEL_ROW_STEPS[normalized - 1];
}

export class GameEngine {
  constructor({ level = 1, maxPlayers = 6, cheatEnabled = false }) {
    this.level = normalizeLevel(level);
    this.rows = rowsForLevel(this.level);
    this.cols = this.rows * 2;
    this.maxPlayers = clamp(maxPlayers, 1, 6);

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
    this.cheatEnabled = Boolean(cheatEnabled);

    this.enableRadar = false;
    this.enableMapView = false;
    this.maxSightDistance = SERVER_CONFIG.vision.maxSightDistance;
    this.nextGhostId = 1;

    this.tickMs = 0;
    this._buildCells();
    this._buildWalls();
    this._generateMaze();
    this._spawnWorldItems();
    this._spawnPlayers();
    this._spawnKey();
    this._updateVision();
  }

  static fromExistingRoom(room, options = {}) {
    const prev = room.engine;
    const shouldAdvanceLevel = Boolean(options.advanceLevel);
    const baseLevel = prev.level || LEVEL_MIN;
    const nextLevel = shouldAdvanceLevel ? normalizeLevel(baseLevel + 1) : normalizeLevel(baseLevel);
    const next = new GameEngine({ level: nextLevel, maxPlayers: prev.maxPlayers, cheatEnabled: prev.cheatEnabled });

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
          explored: false,
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
        trapCooldownAt: 0,
        ghostKillsRound: 0,
        teleported: false
      });
    }
  }

  _spawnWorldItems() {
    const total = this.rows * this.cols;
    for (let i = 0; i < total; i++) {
      if (Math.random() < SERVER_CONFIG.ghost.spawnChance) {
        this.ghosts.push({
          ghostId: this.nextGhostId++,
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
          diameter: 0.5,
          killedByPlayerId: null,
          teleported: false,
          route: [],
          targetX: null,
          targetY: null,
          routeStartedAt: 0,
          restUntilMs: 0
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

  update(dtMs, inputQueueBySocket) {
    this.tickMs += dtMs;

    for (const player of this.players) {
      player.teleported = false;
    }
    for (const ghost of this.ghosts) {
      ghost.teleported = false;
    }

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

    this._updatePlayers(dtMs, inputQueueBySocket);
    this._updateGhosts(dtMs);
    this._checkActivePlayerTraps();
    this._updateTraps(dtMs);
    this._arrangeAllPlayers();

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

  _updatePlayers(dtMs, inputQueueBySocket) {
    for (const player of this.players) {
      this._lerpEntity(player, dtMs);

      if (player.socketId && !player.escaped && player.dead === 0) {
        this._markCellExplored(player.x, player.y);
      }

      if (player.fall) {
        player.diameter = Math.max(0, player.diameter - dtMs * 0.0012);
        if (player.diameter <= 0.05) {
          const trapX = player.x;
          const trapY = player.y;
          player.fall = false;
          player.dead = 1;
          player.diameter = 0.5;
          player.reviveStartedAt = 0;
          this._relocateDownedPlayer(player, trapX, trapY);
        }
      }

      if (player.escaped || player.dead === 2) continue;

      if (player.dead === 1) {
        this._checkTrapFor(player);
        if (this._hasActivePlayerAt(player.x, player.y)) {
          if (!player.reviveStartedAt) player.reviveStartedAt = this.tickMs;
          if (this.tickMs - player.reviveStartedAt >= SERVER_CONFIG.player.reviveMs) {
            const reviveFromX = player.x;
            const reviveFromY = player.y;
            player.dead = 0;
            player.reviveStartedAt = 0;
            player.diameter = 0.5;
            this._moveRevivedPlayerOneStep(player, reviveFromX, reviveFromY);
          }
        } else {
          player.reviveStartedAt = 0;
        }
        continue;
      }

      if (!player.socketId) continue;

      const inputQueue = inputQueueBySocket.get(player.socketId) || [];
      const action = inputQueue[0];
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        if (this.tickMs - player.lastMoveAt >= SERVER_CONFIG.player.moveCooldownMs) {
          const oldX = player.x;
          const oldY = player.y;
          if (this._canMove(player, action, true)) {
            this._applyMove(player, action);
            this._markCellExplored(player.x, player.y);
            this._arrangePlayersAt(oldX, oldY);
            this._arrangePlayersAt(player.x, player.y);
          }
          player.lastMoveAt = this.tickMs;
          inputQueue.shift();
        }
      }

      if (action === 'trap') {
        if (this.tickMs >= player.trapCooldownAt) {
          this._placeTrap(player.x, player.y, player.id);
          player.trapCooldownAt = this.tickMs + SERVER_CONFIG.player.trapCooldownMs;
          inputQueue.shift();
        }
      }

      if (action && action !== 'up' && action !== 'down' && action !== 'left' && action !== 'right' && action !== 'trap') {
        inputQueue.shift();
      }

      this._checkUnlockExit(player);
      this._checkPortalFor(player);
    }
  }

  _checkActivePlayerTraps() {
    for (const player of this.players) {
      if (player.fall || player.escaped || player.dead === 2) continue;
      if (player.dead === 1) continue;
      this._checkTrapFor(player);
    }
  }

  _updateGhosts(dtMs) {
    for (const ghost of this.ghosts) {
      this._lerpEntity(ghost, dtMs);

      if (ghost.fall) {
        ghost.diameter = Math.max(0, ghost.diameter - dtMs * 0.00065);
        if (ghost.diameter <= 0.05) {
          const killerId = Number(ghost.killedByPlayerId);
          if (Number.isFinite(killerId)) {
            const killer = this.players.find((player) => player.id === killerId);
            if (killer) killer.ghostKillsRound = (Number(killer.ghostKillsRound) || 0) + 1;
          }
          this._updateKeyOwnerOnGhostDeath(ghost);
          ghost.killedByPlayerId = null;
          ghost.dead = true;
        }
        continue;
      }

      if (ghost.crazy) {
        this._updateCrazyGhost(ghost);
      } else {
        const moveDelay = SERVER_CONFIG.ghost.moveMs;
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
      }

      for (const player of this.players) {
        if (player.dead || player.escaped) continue;
        if (this.cheatEnabled) continue;
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
      this._checkKeyPickup(ghost);
    }

    this.ghosts = this.ghosts.filter((g) => !g.dead);
  }

  _updateCrazyGhost(ghost) {
    const speedMultiplier = Math.max(1, Number(SERVER_CONFIG.ghost.crazySpeedMultiplier) || 3);
    const moveDelay = Math.max(1, Math.floor(SERVER_CONFIG.ghost.moveMs / speedMultiplier));

    if (ghost.restUntilMs > this.tickMs) {
      return;
    }

    if (this.tickMs - ghost.lastMoveAt < moveDelay) {
      return;
    }

    if (!Array.isArray(ghost.route)) ghost.route = [];

    const nextStep = ghost.route[0];
    if (nextStep) {
      const adjacent = Math.abs(nextStep.x - ghost.x) + Math.abs(nextStep.y - ghost.y) === 1;
      if (!adjacent) {
        ghost.route = [];
        ghost.targetX = null;
        ghost.targetY = null;
        ghost.routeStartedAt = 0;
      }
    }

    if (ghost.route.length === 0) {
      this._prepareCrazyGhostRoute(ghost);
      if (ghost.route.length === 0) {
        ghost.lastMoveAt = this.tickMs;
        return;
      }
    }

    const step = ghost.route[0];
    const dir = this._dirFromDelta(step.x - ghost.x, step.y - ghost.y);
    if (!dir || !this._canMove(ghost, dir, false)) {
      ghost.route = [];
      ghost.targetX = null;
      ghost.targetY = null;
      ghost.routeStartedAt = 0;
      ghost.lastMoveAt = this.tickMs;
      return;
    }

    this._applyMove(ghost, dir);
    ghost.route.shift();
    ghost.lastMoveAt = this.tickMs;

    if (ghost.route.length === 0) {
      const travelMs = Math.max(0, this.tickMs - (ghost.routeStartedAt || this.tickMs));
      ghost.restUntilMs = this.tickMs + travelMs;
      ghost.targetX = null;
      ghost.targetY = null;
      ghost.routeStartedAt = 0;
    }
  }

  _prepareCrazyGhostRoute(ghost) {
    const maxAttempts = 16;

    for (let i = 0; i < maxAttempts; i += 1) {
      const tx = randInt(0, this.cols);
      const ty = randInt(0, this.rows);
      if (tx === ghost.x && ty === ghost.y) continue;

      const route = this._findShortestRoute(ghost.x, ghost.y, tx, ty);
      if (!route || route.length === 0) continue;

      ghost.route = route;
      ghost.targetX = tx;
      ghost.targetY = ty;
      ghost.routeStartedAt = this.tickMs;
      ghost.restUntilMs = 0;
      return;
    }

    ghost.route = [];
    ghost.targetX = null;
    ghost.targetY = null;
    ghost.routeStartedAt = 0;
    ghost.restUntilMs = 0;
  }

  _findShortestRoute(startX, startY, targetX, targetY) {
    if (startX === targetX && startY === targetY) return [];

    const startKey = keyOf(startX, startY, this.cols);
    const targetKey = keyOf(targetX, targetY, this.cols);

    const queue = [startKey];
    const visited = new Set([startKey]);
    const parent = new Map();

    while (queue.length > 0) {
      const currentKey = queue.shift();
      if (currentKey === targetKey) break;

      const cx = currentKey % this.cols;
      const cy = Math.floor(currentKey / this.cols);
      const currentCell = this._getCell(cx, cy);
      if (!currentCell) continue;

      const neighbors = [
        { x: cx, y: cy - 1, blocked: currentCell.wallT?.enable },
        { x: cx, y: cy + 1, blocked: currentCell.wallB?.enable },
        { x: cx - 1, y: cy, blocked: currentCell.wallL?.enable },
        { x: cx + 1, y: cy, blocked: currentCell.wallR?.enable }
      ];

      for (const neighbor of neighbors) {
        if (neighbor.blocked) continue;
        if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= this.cols || neighbor.y >= this.rows) continue;

        const neighborKey = keyOf(neighbor.x, neighbor.y, this.cols);
        if (visited.has(neighborKey)) continue;
        visited.add(neighborKey);
        parent.set(neighborKey, currentKey);
        queue.push(neighborKey);
      }
    }

    if (!visited.has(targetKey)) return [];

    const route = [];
    let cursor = targetKey;
    while (cursor !== startKey) {
      const x = cursor % this.cols;
      const y = Math.floor(cursor / this.cols);
      route.push({ x, y });
      cursor = parent.get(cursor);
      if (cursor == null) return [];
    }

    route.reverse();
    return route;
  }

  _dirFromDelta(dx, dy) {
    if (dx === 1 && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0 && dy === 1) return 'down';
    if (dx === 0 && dy === -1) return 'up';
    return null;
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

  _relocateDownedPlayer(player) {
    const nextX = randInt(0, this.cols);
    const nextY = randInt(0, this.rows);
    player.x = nextX;
    player.y = nextY;
    player.fx = nextX;
    player.fy = nextY;
    player.cx = nextX;
    player.cy = nextY;
    this._updateKeyOwnerOnDeath(player);
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

  _placeTrap(x, y, ownerPlayerId = null) {
    if (this.traps.some((t) => t.x === x && t.y === y && !t.dead)) return;
    this.traps.push({
      x,
      y,
      outer: 0.7,
      inner: 0,
      set: false,
      dead: false,
      ownerPlayerId: Number.isFinite(ownerPlayerId) ? ownerPlayerId : null,
      timerMs: SERVER_CONFIG.trap.activeMs,
      rate: SERVER_CONFIG.trap.openCloseRatePerMs
    });
  }

  _consumeTrap(trap) {
    if (!trap) return;
    trap.set = true;
    trap.timerMs = 0;
  }

  _checkTrapFor(entity) {
    if (entity.escaped) return;
    const isPlayer = Boolean(entity.id);
    if (this.cheatEnabled && isPlayer) return;
    const downedPlayer = typeof entity.dead === 'number' && entity.dead === 1;
    if (entity.dead && !downedPlayer) return;

    const ex = Math.round(entity.cx);
    const ey = Math.round(entity.cy);

    for (const trap of this.traps) {
      if (!trap.set || trap.timerMs <= 0) continue;
      if (trap.x === ex && trap.y === ey) {
        this._consumeTrap(trap);
        if (downedPlayer) {
          this._relocateDownedPlayer(entity, trap.x, trap.y);
          entity.reviveStartedAt = 0;
          return;
        }

        entity.x = ex;
        entity.y = ey;
        entity.fx = ex;
        entity.fy = ey;
        if (entity.ghostId) {
          entity.killedByPlayerId = Number.isFinite(trap.ownerPlayerId) ? trap.ownerPlayerId : null;
        }
        entity.fall = true;
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
        entity.teleported = true;
        if (entity.id) this._markCellExplored(entity.x, entity.y);
        this._checkKeyPickup(entity);

        if (entity.ghostId && entity.crazy) {
          this._resetCrazyGhostCycle(entity);
        }
        return;
      }
    }
  }

  _resetCrazyGhostCycle(ghost) {
    ghost.route = [];
    ghost.targetX = null;
    ghost.targetY = null;
    ghost.routeStartedAt = 0;
    ghost.restUntilMs = 0;
    ghost.lastMoveAt = this.tickMs;
  }

  _markCellExplored(x, y) {
    const cell = this._getCell(x, y);
    if (cell) cell.explored = true;
  }

  _checkKeyPickup(entity) {
    if (!this.keyOwner || this.keyOwner.type !== 'cell') return;
    if (this.keyOwner.x !== entity.x || this.keyOwner.y !== entity.y) return;

    if (entity.id) {
      this.keyOwner = { type: 'player', playerId: entity.id };
      return;
    }

    if (entity.ghostId) {
      this.keyOwner = { type: 'ghost', ghostId: entity.ghostId };
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

  _updateKeyOwnerOnDeath(player, dropX = null, dropY = null) {
    if (!this.keyOwner || this.keyOwner.type !== 'player' || this.keyOwner.playerId !== player.id) return;
    const hasDropOverride = Number.isFinite(dropX) && Number.isFinite(dropY);
    this.keyOwner = {
      type: 'cell',
      x: hasDropOverride ? Math.round(dropX) : Math.round(player.cx),
      y: hasDropOverride ? Math.round(dropY) : Math.round(player.cy)
    };
  }

  _updateKeyOwnerOnGhostDeath(ghost) {
    if (!this.keyOwner || this.keyOwner.type !== 'ghost' || this.keyOwner.ghostId !== ghost.ghostId) return;
    this.keyOwner = { type: 'cell', x: Math.round(ghost.cx), y: Math.round(ghost.cy) };
  }

  _relocateDownedPlayer(player, keyDropX = null, keyDropY = null) {
    const nextX = randInt(0, this.cols);
    const nextY = randInt(0, this.rows);
    player.x = nextX;
    player.y = nextY;
    player.fx = nextX;
    player.fy = nextY;
    player.cx = nextX;
    player.cy = nextY;
    this._updateKeyOwnerOnDeath(player, keyDropX, keyDropY);
  }

  _arrangePlayersAt(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;

    const list = this.players
      .filter((p) => p.socketId && !p.escaped && p.x === x && p.y === y && (p.dead === 0 || p.dead === 1))
      .sort((a, b) => a.id - b.id);

    this._applyPlayerSpread(list);
  }

  _applyPlayerSpread(list) {
    if (!list || list.length === 0) return;
    if (list.length === 1) {
      list[0].fx = list[0].x;
      list[0].fy = list[0].y;
      return;
    }

    // Match original p5 behavior: rotate a diagonal vector each step.
    const theta = (Math.PI * 2) / list.length;
    let vx = SERVER_CONFIG.player.sameTileSpread;
    let vy = SERVER_CONFIG.player.sameTileSpread;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    for (let i = 0; i < list.length; i += 1) {
      const nextX = vx * cosT - vy * sinT;
      const nextY = vx * sinT + vy * cosT;
      vx = nextX;
      vy = nextY;
      list[i].fx = list[i].x + vx;
      list[i].fy = list[i].y + vy;
    }
  }

  _arrangeAllPlayers() {
    const grouped = new Map();
    for (const p of this.players) {
      if (!p.socketId || p.escaped) continue;
      if (!(p.dead === 0 || p.dead === 1)) continue;
      const key = `${p.x},${p.y}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(p);
    }

    for (const group of grouped.values()) {
      group.sort((a, b) => a.id - b.id);
      this._applyPlayerSpread(group);
    }
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

    this._checkKeyPickup(entity);
  }

  _moveRevivedPlayerOneStep(player, fromX, fromY) {
    const dirs = ['up', 'down', 'left', 'right'];
    for (let i = dirs.length - 1; i > 0; i -= 1) {
      const j = randInt(0, i + 1);
      const tmp = dirs[i];
      dirs[i] = dirs[j];
      dirs[j] = tmp;
    }

    for (const dir of dirs) {
      if (!this._canMove(player, dir, false)) continue;
      this._applyMove(player, dir);
      this._markCellExplored(player.x, player.y);
      this._arrangePlayersAt(fromX, fromY);
      this._arrangePlayersAt(player.x, player.y);
      return;
    }

    this._arrangePlayersAt(fromX, fromY);
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
    this.enableRadar = this.cheatEnabled;
    this.enableMapView = this.cheatEnabled;

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

  getMapSnapshot() {
    return {
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      cells: this.cells.map((c) => ({
        x: c.x,
        y: c.y,
        type: c.type,
        explored: c.explored
      })),
      walls: this.walls.map((w) => ({
        a: w.a,
        b: w.b,
        p1: w.p1,
        p2: w.p2,
        enable: w.enable
      }))
    };
  }

  getDynamicSnapshot() {
    const key = this._resolveKeyPosition();
    return {
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      finish: this.finish,
      cheatEnabled: this.cheatEnabled,
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
      players: this.players.map((p) => ({
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        cx: p.cx,
        cy: p.cy,
        fall: p.fall,
        dead: p.dead,
        escaped: p.escaped,
        ghostKills: Number(p.ghostKillsRound) || 0,
        diameter: p.diameter,
        teleported: Boolean(p.teleported),
        hasKey: this.keyOwner?.type === 'player' && this.keyOwner.playerId === p.id
      })),
      ghosts: this.ghosts.map((g) => ({
        id: g.ghostId,
        x: g.x,
        y: g.y,
        cx: g.cx,
        cy: g.cy,
        diameter: g.diameter,
        fall: g.fall,
        crazy: g.crazy,
        teleported: Boolean(g.teleported),
        hasKey: this.keyOwner?.type === 'ghost' && this.keyOwner.ghostId === g.ghostId
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

  getSnapshot() {
    const dynamic = this.getDynamicSnapshot();
    const map = this.getMapSnapshot();
    const cells = map.cells.map((c) => ({
      ...c,
      inSight: this._getCell(c.x, c.y).inSight,
      bright: this._getCell(c.x, c.y).bright
    }));
    const walls = this.walls.map((w) => ({
      p1: w.p1,
      p2: w.p2,
      enable: w.enable,
      bright: w.enable ? Math.max(this.cells[w.a].bright, this.cells[w.b].bright) : 0,
      visible: w.enable && (this.cells[w.a].inSight || this.cells[w.b].inSight)
    }));
    return {
      ...dynamic,
      cells,
      walls
    };
  }

  _resolveKeyPosition() {
    if (!this.keyOwner) return null;
    if (this.keyOwner.type === 'cell') {
      return { type: 'cell', x: this.keyOwner.x, y: this.keyOwner.y };
    }
    if (this.keyOwner.type === 'ghost') {
      const ghostOwner = this.ghosts.find((g) => g.ghostId === this.keyOwner.ghostId);
      if (!ghostOwner) return null;
      return { type: 'ghost', ghostId: ghostOwner.ghostId, x: ghostOwner.cx, y: ghostOwner.cy };
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
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      maxPlayers: this.maxPlayers,
      connected: players.filter((p) => p.connected).length,
      players
    };
  }
}
