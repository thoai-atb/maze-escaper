import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { GameEngine } from './gameEngine.js';
import { SERVER_CONFIG } from './config.js';

const app = express();
app.use(cors());
app.get('/health', (_, res) => res.json({ ok: true }));

const clientDistPath = path.resolve(process.cwd(), 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const rooms = new Map();
const socketRoom = new Map();
const inputQueueBySocket = new Map();
const rttBySocket = new Map();
const INPUT_QUEUE_MAX = 24;
const VALID_INPUT_ACTIONS = new Set(['up', 'down', 'left', 'right', 'trap']);
const INITIAL_LIVES = 3;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function getRandomPlaybackRate(soundKey) {
  const rateRange = SERVER_CONFIG.audio?.randomRateBySound?.[soundKey];
  if (!Array.isArray(rateRange) || rateRange.length < 2) return undefined;
  return randomBetween(Number(rateRange[0]) || 1, Number(rateRange[1]) || 1);
}

function emitRoomAudio(ioServer, roomCode, soundKey) {
  const playbackRate = getRandomPlaybackRate(soundKey);
  ioServer.to(roomCode).emit('game:audio', {
    key: soundKey,
    playbackRate
  });
}

function emitPlayerDeathAudioEvents(ioServer, roomCode, room, snapshot) {
  const prevStateById = room.playerAudioStateById;
  const nextStateById = new Map();

  for (const player of snapshot.players || []) {
    const current = {
      dead: player.dead,
      fall: Boolean(player.fall)
    };
    nextStateById.set(player.id, current);

    if (!player.socketId) continue;
    const previous = prevStateById.get(player.id);
    if (!previous) continue;

    if (previous.dead === 0 && current.dead === 1 && !previous.fall && !current.fall) {
      emitRoomAudio(ioServer, roomCode, 'SCREAM');
    }

    if (!previous.fall && current.fall) {
      emitRoomAudio(ioServer, roomCode, 'FALL_SCREAM');
    }
  }

  room.playerAudioStateById = nextStateById;
}

function getMapPayload(room) {
  const engine = room.engine;
  return {
    version: room.mapVersion,
    level: engine.level,
    rows: engine.rows,
    cols: engine.cols,
    maxSightDistance: engine.maxSightDistance,
    exit: {
      x: engine.exit.x,
      y: engine.exit.y
    },
    cells: engine.cells.map((c) => ({
      x: c.x,
      y: c.y,
      type: c.type,
      wallT: Boolean(c.wallT?.enable),
      wallB: Boolean(c.wallB?.enable),
      wallL: Boolean(c.wallL?.enable),
      wallR: Boolean(c.wallR?.enable)
    })),
    walls: engine.walls.map((w) => ({
      a: w.a,
      b: w.b,
      p1: w.p1,
      p2: w.p2,
      enable: w.enable
    }))
  };
}

function buildDynamicSnapshot(room, fullSnapshot) {
  return {
    mapVersion: room.mapVersion,
    level: fullSnapshot.level,
    rows: fullSnapshot.rows,
    cols: fullSnapshot.cols,
    finish: fullSnapshot.finish,
    cheatEnabled: fullSnapshot.cheatEnabled,
    minBright: fullSnapshot.minBright,
    enableRadar: fullSnapshot.enableRadar,
    enableMapView: fullSnapshot.enableMapView,
    canRestart: fullSnapshot.canRestart,
    exit: fullSnapshot.exit,
    key: fullSnapshot.key,
    players: fullSnapshot.players.map((p) => ({
      id: p.id,
      socketId: p.socketId,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      dead: p.dead,
      escaped: p.escaped,
      fall: p.fall,
      diameter: p.diameter,
      hasKey: p.hasKey
    })),
    ghosts: fullSnapshot.ghosts.map((g) => ({
      id: g.id,
      x: g.x,
      y: g.y,
      fall: g.fall,
      diameter: g.diameter,
      crazy: g.crazy,
      hasKey: g.hasKey
    })),
    portals: fullSnapshot.portals,
    traps: fullSnapshot.traps,
    particles: []
  };
}

function getRoundDurationMs(room, now = Date.now()) {
  if (!room.roundStartedAt) return 0;
  const effectiveNow = room.roundFinishedAt || now;
  return Math.max(0, effectiveNow - room.roundStartedAt);
}

function getPublicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    const status = room.engine.getRoomStatus();
    const connectedCount = status.players.filter((p) => p.connected).length;
    const hostPlayer = room.engine.players.find((p) => p.socketId === room.hostSocketId);
    if (room.started) continue;
    list.push({
      roomCode: room.roomCode,
      hostSocketId: room.hostSocketId,
      hostName: hostPlayer?.name || 'Host',
      level: room.engine.level,
      rows: room.engine.rows,
      cols: room.engine.cols,
      maxPlayers: room.engine.maxPlayers,
      connectedPlayers: connectedCount,
      createdAt: room.createdAt
    });
  }

  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function emitRoomList() {
  io.emit('room:list:update', { rooms: getPublicRoomList() });
}

function getStatusWithRtt(room) {
  const status = room.engine.getRoomStatus();
  const rttByPlayerId = new Map();

  for (const player of room.engine.players) {
    if (!player.socketId) continue;
    const rttMs = rttBySocket.get(player.socketId);
    if (typeof rttMs === 'number') {
      rttByPlayerId.set(player.id, rttMs);
    }
  }

  return {
    ...status,
    players: status.players.map((player) => ({
      ...player,
      rttMs: rttByPlayerId.get(player.id) ?? null
    }))
  };
}

function getResultPlayers(room, engine = room.engine) {
  const participantIds = room.resultPlayerIds?.length
    ? new Set(room.resultPlayerIds)
    : new Set(engine.getConnectedPlayers().map((player) => player.id));

  return engine.players
    .filter((player) => participantIds.has(player.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      escaped: Boolean(player.escaped),
      dead: player.dead
    }));
}

function recordLevelOutcome(room) {
  const engine = room.engine;
  const level = engine.level;
  const attempts = room.levelAttempts[level] || 1;
  const players = getResultPlayers(room, engine);
  const durationMs = getRoundDurationMs(room);
  room.levelHistory.push({ level, attempts, durationMs, players });
}

function getLevelResults(room) {
  const levelHistory = [...room.levelHistory];
  const currentLevel = room.engine.level;
  const alreadyRecorded = levelHistory.some((entry) => entry.level === currentLevel);

  if (!alreadyRecorded && room.engine.finish) {
    const attempts = room.levelAttempts[currentLevel] || 1;
    const players = getResultPlayers(room, room.engine);
    const durationMs = getRoundDurationMs(room);
    levelHistory.push({ level: currentLevel, attempts, durationMs, players });
  }

  return levelHistory;
}

function createRoom({ hostSocketId, hostName, maxPlayers }) {
  const roomCode = nanoid();
  const engine = new GameEngine({ level: 1, maxPlayers });
  const createdAt = Date.now();
  const room = {
    roomCode,
    createdAt,
    hostSocketId,
    started: false,
    engine,
    mapVersion: 1,
    levelHistory: [],
    levelAttempts: { 1: 1 },
    roundStartedAt: 0,
    roundFinishedAt: 0,
    resultsOpened: false,
    resultPlayerIds: [],
    remainingLives: INITIAL_LIVES,
    failurePenaltyApplied: false,
    playerAudioStateById: new Map()
  };

  const attached = engine.attachPlayer(hostSocketId, hostName || 'Host');
  if (!attached) return null;

  rooms.set(roomCode, room);
  socketRoom.set(hostSocketId, roomCode);
  return room;
}

function joinRoom({ socketId, roomCode, playerName }) {
  const room = rooms.get(roomCode);
  if (!room) {
    return { error: 'Room not found.' };
  }

  if (room.started) {
    return { error: 'Game already started in this room.' };
  }

  const slot = room.engine.attachPlayer(socketId, playerName || 'Player');
  if (!slot) {
    return { error: 'Room is full.' };
  }

  socketRoom.set(socketId, roomCode);
  return { room };
}

function leaveCurrentRoom(socketId) {
  const roomCode = socketRoom.get(socketId);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  socketRoom.delete(socketId);
  inputQueueBySocket.delete(socketId);
  rttBySocket.delete(socketId);
  if (!room) return;

  room.engine.detachPlayer(socketId);

  if (room.hostSocketId === socketId) {
    const nextHost = room.engine.getConnectedPlayers()[0];
    room.hostSocketId = nextHost ? nextHost.socketId : null;
  }

  io.to(roomCode).emit('room:update', {
    roomCode,
    status: {
      ...getStatusWithRtt(room),
      remainingLives: room.remainingLives,
      resultsOpened: room.resultsOpened
    },
    hostSocketId: room.hostSocketId,
    started: room.started
  });

  if (room.engine.isEmptyRoom()) {
    rooms.delete(roomCode);
  }

  emitRoomList();
}

function emitRoomUpdate(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  io.to(roomCode).emit('room:update', {
    roomCode,
    status: {
      ...getStatusWithRtt(room),
      remainingLives: room.remainingLives,
      resultsOpened: room.resultsOpened
    },
    hostSocketId: room.hostSocketId,
    started: room.started
  });
}

function removeSocketFromRoom(socket) {
  const roomCode = socketRoom.get(socket.id);
  if (roomCode) {
    socket.leave(roomCode);
  }
  leaveCurrentRoom(socket.id);
}

function levelSucceeded(engine) {
  return engine.players.some((player) => player.escaped);
}

function getParticipantIdSet(room) {
  if (room.resultPlayerIds?.length) {
    return new Set(room.resultPlayerIds);
  }
  return new Set(room.engine.getConnectedPlayers().map((player) => player.id));
}

function applySkipLevelOutcome(room) {
  const participantIds = getParticipantIdSet(room);
  for (const player of room.engine.players) {
    if (!participantIds.has(player.id)) continue;
    player.dead = 0;
    player.escaped = true;
    player.fall = false;
  }

  room.engine.finish = true;
  room.roundFinishedAt = room.roundStartedAt || Date.now();
}

io.on('connection', (socket) => {
  socket.emit('welcome', { socketId: socket.id });
  socket.emit('room:list:update', { rooms: getPublicRoomList() });

  socket.on('room:list', (cb) => {
    cb?.({ ok: true, rooms: getPublicRoomList() });
  });

  socket.on('room:create', (payload, cb) => {
    try {
      removeSocketFromRoom(socket);

      const room = createRoom({
        hostSocketId: socket.id,
        hostName: payload?.name || 'Host',
        maxPlayers: Number(payload?.maxPlayers || 6)
      });

      if (!room) {
        cb?.({ ok: false, error: 'Failed to create room.' });
        return;
      }

      socket.join(room.roomCode);
      emitRoomUpdate(room.roomCode);
      emitRoomList();
      cb?.({ ok: true, roomCode: room.roomCode });
    } catch (err) {
      cb?.({ ok: false, error: 'Unexpected error creating room.' });
    }
  });

  socket.on('room:join', (payload, cb) => {
    try {
      removeSocketFromRoom(socket);
      const roomCode = String(payload?.roomCode || '').toUpperCase().trim();
      const result = joinRoom({
        socketId: socket.id,
        roomCode,
        playerName: payload?.name || 'Player'
      });

      if (result.error) {
        cb?.({ ok: false, error: result.error });
        return;
      }

      socket.join(roomCode);
      emitRoomUpdate(roomCode);
      emitRoomList();
      cb?.({ ok: true, roomCode });
    } catch (err) {
      cb?.({ ok: false, error: 'Unexpected error joining room.' });
    }
  });

  socket.on('room:start', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'Only host can start.' });
      return;
    }

    const connectedCount = room.engine.getConnectedPlayers().length;
    if (connectedCount === 0) {
      cb?.({ ok: false, error: 'Need at least one player.' });
      return;
    }

    room.resultPlayerIds = room.engine.getConnectedPlayers().map((player) => player.id);
    room.remainingLives = INITIAL_LIVES;
    room.failurePenaltyApplied = false;
    room.roundStartedAt = Date.now();
    room.roundFinishedAt = 0;
    room.resultsOpened = false;
    room.started = true;
    room.mapVersion += 1;
    room.playerAudioStateById = new Map();
    io.to(roomCode).emit('game:start', {
      roomCode,
      status: {
        ...getStatusWithRtt(room),
        remainingLives: room.remainingLives,
        resultsOpened: room.resultsOpened
      }
    });
    io.to(roomCode).emit('game:map', {
      roomCode,
      map: getMapPayload(room)
    });
    emitRoomUpdate(roomCode);
    emitRoomList();
    cb?.({ ok: true });
  });

  socket.on('room:restart', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'Only host can restart.' });
      return;
    }

    if (room.remainingLives <= 0) {
      cb?.({ ok: false, error: 'No lives remaining.' });
      return;
    }

    const currentLevel = room.engine.level;
    const nextEngine = GameEngine.fromExistingRoom(room, { advanceLevel: false });
    room.failurePenaltyApplied = false;
    room.levelAttempts[currentLevel] = (room.levelAttempts[currentLevel] || 1) + 1;
    room.roundStartedAt = Date.now();
    room.roundFinishedAt = 0;
    room.resultsOpened = false;
    room.mapVersion += 1;
    room.playerAudioStateById = new Map();

    io.to(roomCode).emit('game:start', {
      roomCode,
      status: {
        ...getStatusWithRtt(room),
        remainingLives: room.remainingLives,
        resultsOpened: room.resultsOpened
      }
    });
    io.to(roomCode).emit('game:map', {
      roomCode,
      map: getMapPayload(room)
    });
    emitRoomUpdate(roomCode);
    emitRoomList();
    cb?.({ ok: true });
  });

  socket.on('room:next-level', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'Only host can go next level.' });
      return;
    }

    if (!levelSucceeded(room.engine)) {
      cb?.({ ok: false, error: 'Need at least one escaped player to unlock next level.' });
      return;
    }

    recordLevelOutcome(room);
    const nextLevel = room.engine.level + 1;
    const nextEngine = GameEngine.fromExistingRoom(room, { advanceLevel: true });
    room.failurePenaltyApplied = false;
    room.levelAttempts[nextLevel] = 1;
    room.remainingLives = INITIAL_LIVES;
    room.roundStartedAt = Date.now();
    room.roundFinishedAt = 0;
    room.resultsOpened = false;
    room.mapVersion += 1;
    room.playerAudioStateById = new Map();

    io.to(roomCode).emit('game:start', {
      roomCode,
      status: {
        ...getStatusWithRtt(room),
        remainingLives: room.remainingLives,
        resultsOpened: room.resultsOpened
      }
    });
    io.to(roomCode).emit('game:map', {
      roomCode,
      map: getMapPayload(room)
    });
    emitRoomUpdate(roomCode);
    emitRoomList();
    cb?.({ ok: true });
  });

  socket.on('room:leave', (cb) => {
    removeSocketFromRoom(socket);
    socket.emit('room:left');
    cb?.({ ok: true });
  });

  socket.on('room:view-results', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    if (!room.engine.finish) {
      cb?.({ ok: false, error: 'Round is not finished yet.' });
      return;
    }

    room.resultsOpened = true;
    emitRoomUpdate(roomCode);
    cb?.({ ok: true });
  });

  socket.on('room:skip-level', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    if (!room.started) {
      cb?.({ ok: false, error: 'Game has not started.' });
      return;
    }

    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'Only host can use skip shortcut.' });
      return;
    }

    if (room.engine.finish) {
      cb?.({ ok: false, error: 'Round is already finished.' });
      return;
    }

    applySkipLevelOutcome(room);
    cb?.({ ok: true });
  });

  socket.on('room:toggle-cheat', (cb) => {
    const roomCode = socketRoom.get(socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }

    room.engine.cheatEnabled = !room.engine.cheatEnabled;
    cb?.({ ok: true, cheatEnabled: room.engine.cheatEnabled });
  });

  socket.on('input:enqueue', (payload) => {
    const action = String(payload?.action || '').toLowerCase();
    if (!VALID_INPUT_ACTIONS.has(action)) return;

    const queue = inputQueueBySocket.get(socket.id) || [];
    if (queue.length >= INPUT_QUEUE_MAX) {
      queue.shift();
    }
    queue.push(action);
    inputQueueBySocket.set(socket.id, queue);
  });

  socket.on('net:ping', (_clientTs, cb) => {
    cb?.({ ok: true, serverTs: Date.now() });
  });

  socket.on('net:rtt', (payload) => {
    const parsed = Number(payload);
    if (!Number.isFinite(parsed)) return;
    const rttMs = Math.max(0, Math.min(5000, Math.round(parsed)));
    rttBySocket.set(socket.id, rttMs);

    const roomCode = socketRoom.get(socket.id);
    if (roomCode) {
      emitRoomUpdate(roomCode);
    }
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket.id);
  });
});

let previousTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(SERVER_CONFIG.net.maxDeltaMs, now - previousTick);
  previousTick = now;

  for (const [roomCode, room] of rooms.entries()) {
    if (!room.started) continue;

    room.engine.update(dt, inputQueueBySocket);
    const fullSnapshot = room.engine.getSnapshot();
    const snapshot = buildDynamicSnapshot(room, fullSnapshot);

    emitPlayerDeathAudioEvents(io, roomCode, room, snapshot);

    snapshot.players = snapshot.players.map((player) => ({
      ...player,
      rttMs: player.socketId ? (rttBySocket.get(player.socketId) ?? null) : null
    }));

    if (snapshot.finish && !room.roundFinishedAt) {
      room.roundFinishedAt = Date.now();
    }

    if (snapshot.finish && !levelSucceeded(room.engine) && !room.failurePenaltyApplied) {
      room.remainingLives = Math.max(0, room.remainingLives - 1);
      room.failurePenaltyApplied = true;
      emitRoomUpdate(roomCode);
    }

    if (snapshot.finish) {
      for (const player of room.engine.getConnectedPlayers()) {
        if (player.socketId) inputQueueBySocket.delete(player.socketId);
      }
    }

    io.to(roomCode).emit('game:state', {
      roomCode,
      snapshot,
      levelHistory: getLevelResults(room),
      remainingLives: room.remainingLives,
      resultsOpened: room.resultsOpened
    });
  }
}, SERVER_CONFIG.net.tickIntervalMs);

setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.createdAt > SERVER_CONFIG.net.roomTtlMs) {
      rooms.delete(roomCode);
    }
  }
  emitRoomList();
}, SERVER_CONFIG.net.roomGcIntervalMs);

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Maze Escaper server listening on http://localhost:${PORT}`);
});
