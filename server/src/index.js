import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { GameEngine } from './gameEngine.js';
import { SERVER_CONFIG } from './config.js';

const app = express();
app.use(cors());
app.get('/health', (_, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const rooms = new Map();
const socketRoom = new Map();
const inputStateBySocket = new Map();

function getPublicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    const status = room.engine.getRoomStatus();
    const connectedCount = status.players.filter((p) => p.connected).length;
    if (room.started) continue;
    list.push({
      roomCode: room.roomCode,
      hostSocketId: room.hostSocketId,
      hostName: status.players.find((p) => p.socketId === room.hostSocketId)?.name || 'Host',
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

function createRoom({ hostSocketId, hostName, rows, maxPlayers }) {
  const roomCode = nanoid();
  const engine = new GameEngine({ rows, maxPlayers });
  const createdAt = Date.now();
  const room = {
    roomCode,
    createdAt,
    hostSocketId,
    started: false,
    engine
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
  inputStateBySocket.delete(socketId);
  if (!room) return;

  room.engine.detachPlayer(socketId);

  if (room.hostSocketId === socketId) {
    const nextHost = room.engine.getConnectedPlayers()[0];
    room.hostSocketId = nextHost ? nextHost.socketId : null;
  }

  io.to(roomCode).emit('room:update', {
    roomCode,
    status: room.engine.getRoomStatus(),
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
    status: room.engine.getRoomStatus(),
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
        rows: Number(payload?.rows || 10),
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

    room.started = true;
    io.to(roomCode).emit('game:start', {
      roomCode,
      status: room.engine.getRoomStatus()
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

    const nextEngine = GameEngine.fromExistingRoom(room);

    io.to(roomCode).emit('game:start', {
      roomCode,
      status: nextEngine.getRoomStatus()
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

  socket.on('input:update', (payload) => {
    inputStateBySocket.set(socket.id, {
      up: Boolean(payload?.up),
      down: Boolean(payload?.down),
      left: Boolean(payload?.left),
      right: Boolean(payload?.right),
      trap: Boolean(payload?.trap)
    });
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

    room.engine.update(dt, inputStateBySocket);
    const snapshot = room.engine.getSnapshot();

    io.to(roomCode).emit('game:state', {
      roomCode,
      snapshot
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
