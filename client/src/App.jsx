import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from './socket';
import GameCanvas from './game/GameCanvas';
import { soundManager, SOUND } from './audio/soundManager';
import { getTileThemeByLevel } from './config';

const initialInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  trap: false
};

const PLAYER_NAME_STORAGE_KEY = 'maze.player.name';
const MOVE_PREDICTION_GRACE_MS = 160;

function getViewportSize() {
  const visual = window.visualViewport;
  if (visual) {
    return {
      width: Math.round(visual.width),
      height: Math.round(visual.height)
    };
  }

  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight
  };
}

function keyToInput(key) {
  const k = key.toLowerCase();
  if (k === 'arrowup' || k === 'w') return 'up';
  if (k === 'arrowdown' || k === 's') return 'down';
  if (k === 'arrowleft' || k === 'a') return 'left';
  if (k === 'arrowright' || k === 'd') return 'right';
  if (k === ' ') return 'trap';
  return null;
}

function actionToDelta(action) {
  if (action === 'up') return { dx: 0, dy: -1 };
  if (action === 'down') return { dx: 0, dy: 1 };
  if (action === 'left') return { dx: -1, dy: 0 };
  if (action === 'right') return { dx: 1, dy: 0 };
  return { dx: 0, dy: 0 };
}

function hasBlockingWall(cell, action) {
  if (!cell) return true;
  if (action === 'up') return Boolean(cell.wallT);
  if (action === 'down') return Boolean(cell.wallB);
  if (action === 'left') return Boolean(cell.wallL);
  if (action === 'right') return Boolean(cell.wallR);
  return true;
}

function sameCellTrap(trap, x, y) {
  return Math.round(trap.x) === x && Math.round(trap.y) === y;
}

function applyClientPrediction(prevSnapshot, mapPayload, mySocketId, action) {
  if (!prevSnapshot || !mapPayload || !mySocketId) return prevSnapshot;

  const playerIndex = prevSnapshot.players.findIndex((p) => p.socketId === mySocketId);
  if (playerIndex < 0) return prevSnapshot;

  const me = prevSnapshot.players[playerIndex];
  if (!me || me.dead || me.escaped || me.fall) return prevSnapshot;

  if (action === 'trap') {
    const trapExists = (prevSnapshot.traps || []).some((t) => sameCellTrap(t, me.x, me.y));
    if (trapExists) return prevSnapshot;

    return {
      ...prevSnapshot,
      traps: [
        ...(prevSnapshot.traps || []),
        {
          x: me.x,
          y: me.y,
          outer: 0.7,
          inner: 0,
          set: false,
          active: false
        }
      ]
    };
  }

  const { dx, dy } = actionToDelta(action);
  if (dx === 0 && dy === 0) return prevSnapshot;

  const rows = mapPayload.rows;
  const cols = mapPayload.cols;
  const currentX = me.x;
  const currentY = me.y;

  const exitRow = prevSnapshot.exit?.y ?? mapPayload.exit?.y;
  if (action === 'right' && currentX === cols - 1 && currentY === exitRow && !prevSnapshot.exit?.locked) {
    const nextPlayers = [...prevSnapshot.players];
    nextPlayers[playerIndex] = {
      ...me,
      x: cols,
      escaped: true
    };
    return {
      ...prevSnapshot,
      players: nextPlayers
    };
  }

  const nextX = currentX + dx;
  const nextY = currentY + dy;
  if (nextX < 0 || nextY < 0 || nextX >= cols || nextY >= rows) return prevSnapshot;

  const currentCell = mapPayload.cells[currentY * cols + currentX];
  if (hasBlockingWall(currentCell, action)) return prevSnapshot;

  const nextPlayers = [...prevSnapshot.players];
  nextPlayers[playerIndex] = { ...me, x: nextX, y: nextY };

  return {
    ...prevSnapshot,
    players: nextPlayers
  };
}

function reconcilePredictedMovement(prevSnapshot, incomingSnapshot, mySocketId, pendingMovesRef) {
  if (!prevSnapshot || !incomingSnapshot || !mySocketId) return incomingSnapshot;

  const queue = pendingMovesRef.current;
  if (!queue.length) return incomingSnapshot;

  const incomingPlayerIndex = incomingSnapshot.players.findIndex((p) => p.socketId === mySocketId);
  if (incomingPlayerIndex < 0) return incomingSnapshot;

  const incomingMe = incomingSnapshot.players[incomingPlayerIndex];
  if (!incomingMe || incomingMe.dead || incomingMe.escaped || incomingMe.fall) {
    queue.length = 0;
    return incomingSnapshot;
  }

  // Consume confirmed moves in-order when server reaches predicted destination.
  while (queue.length > 0) {
    const head = queue[0];
    if (incomingMe.x === head.toX && incomingMe.y === head.toY) {
      queue.shift();
      continue;
    }
    break;
  }

  if (!queue.length) return incomingSnapshot;

  const head = queue[0];
  const ageMs = Date.now() - head.createdAt;
  const stillAtSource = incomingMe.x === head.fromX && incomingMe.y === head.fromY;

  if (stillAtSource && ageMs < MOVE_PREDICTION_GRACE_MS) {
    const prevMe = prevSnapshot.players.find((p) => p.socketId === mySocketId);
    if (!prevMe) return incomingSnapshot;

    const players = [...incomingSnapshot.players];
    players[incomingPlayerIndex] = {
      ...incomingMe,
      x: prevMe.x,
      y: prevMe.y
    };
    return {
      ...incomingSnapshot,
      players
    };
  }

  // Prediction timed out or server denied; drop this pending move and accept authoritative state.
  if (stillAtSource && ageMs >= MOVE_PREDICTION_GRACE_MS) {
    queue.shift();
  }

  return incomingSnapshot;
}

function levelTileColor(level, alpha = 1) {
  const theme = getTileThemeByLevel(level).unvisited;
  const lightness = Math.round(theme.lightnessScale * 100);
  return alpha === 1
    ? `hsl(${theme.hue} ${theme.saturation}% ${lightness}%)`
    : `hsl(${theme.hue} ${theme.saturation}% ${lightness}% / ${alpha})`;
}

function formatRoundDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatRtt(ms) {
  if (!Number.isFinite(ms)) return null;
  return `${Math.max(0, Math.round(ms))}ms`;
}

function SoundIcon({ muted }) {
  if (muted) {
    return (
      <svg className="audio-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M17 9l4 6M21 9l-4 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className="audio-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M17 10c1.6 1.5 1.6 4.5 0 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 7c3.2 3 3.2 8 0 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function KeyCap({ label }) {
  return <span className="keycap">{label}</span>;
}

function LivesBadge({ lives }) {
  const count = Math.max(0, lives);
  return (
    <span className="round-level round-lives" title={`${count} lives remaining`}>
      <span className="round-lives-hearts" aria-hidden="true">{'♥'.repeat(count) || '♡'}</span>
      <span className="round-lives-text">{count}</span>
    </span>
  );
}

function ControlsLegend({ showRoundKeys = true }) {
  return (
    <span className="controls-legend">
      <span className="control-item">
        <span className="keycap-row">
          <KeyCap label="W" />
          <KeyCap label="A" />
          <KeyCap label="S" />
          <KeyCap label="D" />
        </span>
        <span>Move</span>
      </span>
      <span className="control-item">
        <span className="keycap-row">
          <KeyCap label="Space" />
        </span>
        <span>Trap</span>
      </span>
      {showRoundKeys && null}
    </span>
  );
}

function CopyrightBadge() {
  return <div className="copyright-badge">© Thoai Ly 2026</div>;
}

export default function App() {
  const [viewportSize, setViewportSize] = useState({
    width: getViewportSize().width,
    height: getViewportSize().height
  });
  const [mySocketId, setMySocketId] = useState('');
  const [myName, setMyName] = useState(() => {
    const saved = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    return saved ? saved.slice(0, 20) : '';
  });
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(6);

  const [roomCode, setRoomCode] = useState('');
  const [roomStatus, setRoomStatus] = useState(null);
  const [hostSocketId, setHostSocketId] = useState('');
  const [started, setStarted] = useState(false);
  const [roundOverlayHeight, setRoundOverlayHeight] = useState(44);
  const [mapPayload, setMapPayload] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [levelHistory, setLevelHistory] = useState([]);
  const [remainingLives, setRemainingLives] = useState(3);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState('');
  const [publicRooms, setPublicRooms] = useState([]);
  const [inputState, setInputState] = useState(initialInput);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = window.localStorage.getItem('maze.sound.enabled');
    return saved == null ? true : saved === 'true';
  });
  const [soundVolume, setSoundVolume] = useState(() => {
    const savedRaw = window.localStorage.getItem('maze.sound.volume');
    if (savedRaw == null) return 0.4;
    const saved = Number(savedRaw);
    if (Number.isNaN(saved)) return 0.4;
    return Math.max(0, Math.min(1, saved));
  });

  const prevSnapshotRef = useRef(null);
  const prevMapGadgetRef = useRef(false);
  const prevRadarGadgetRef = useRef(false);
  const heldKeysRef = useRef(new Set());
  const inputStateRef = useRef(initialInput);
  const roundOverlayRef = useRef(null);
  const mySocketIdRef = useRef('');
  const mapPayloadRef = useRef(null);
  const predictedTrapsRef = useRef(new Set());
  const pendingMovesRef = useRef([]);
  const levelActionRef = useRef({ enabled: false, mode: 'restart' });

  useEffect(() => {
    mySocketIdRef.current = mySocketId;
  }, [mySocketId]);

  useEffect(() => {
    mapPayloadRef.current = mapPayload;
  }, [mapPayload]);

  useEffect(() => {
    const onWelcome = (data) => setMySocketId(data.socketId);
    const onRoomUpdate = (data) => {
      setRoomCode(data.roomCode);
      setRoomStatus(data.status);
      if (typeof data.status?.remainingLives === 'number') setRemainingLives(data.status.remainingLives);
      if (typeof data.status?.resultsOpened === 'boolean') setShowResults(data.status.resultsOpened);
      setHostSocketId(data.hostSocketId || '');
      setStarted(Boolean(data.started));
      setError('');
    };
    const onGameStart = () => {
      setStarted(true);
      setSnapshot(null);
      setShowResults(false);
      setError('');
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };
    const onGameMap = (data) => {
      setMapPayload(data?.map || null);
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };
    const onGameState = (data) => {
      const incomingSnapshot = data.snapshot;

      const selfSocketId = mySocketIdRef.current;
      if (selfSocketId) {
        for (const trap of incomingSnapshot?.traps || []) {
          const key = `${Math.round(trap.x)},${Math.round(trap.y)}`;
          if (predictedTrapsRef.current.has(key)) {
            predictedTrapsRef.current.delete(key);
          }
        }
      }

      setSnapshot((prev) => reconcilePredictedMovement(prev, incomingSnapshot, selfSocketId, pendingMovesRef));
      if (Array.isArray(data.levelHistory)) setLevelHistory(data.levelHistory);
      if (typeof data.remainingLives === 'number') setRemainingLives(data.remainingLives);
      if (typeof data.resultsOpened === 'boolean') setShowResults(data.resultsOpened);
    };
    const onGameAudio = (data) => {
      const soundKey = String(data?.key || '');
      if (soundKey === SOUND.SCREAM || soundKey === SOUND.FALL_SCREAM) {
        soundManager.play(soundKey, { playbackRate: data?.playbackRate });
      }
    };
    const onRoomListUpdate = (data) => {
      setPublicRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    };
    const onRoomLeft = () => {
      setRoomCode('');
      setRoomStatus(null);
      setHostSocketId('');
      setStarted(false);
      setMapPayload(null);
      setSnapshot(null);
      setLevelHistory([]);
      setRemainingLives(3);
      setShowResults(false);
      setInputState(initialInput);
      setError('');
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };

    socket.on('welcome', onWelcome);
    socket.on('room:update', onRoomUpdate);
    socket.on('game:start', onGameStart);
    socket.on('game:map', onGameMap);
    socket.on('game:state', onGameState);
    socket.on('game:audio', onGameAudio);
    socket.on('room:list:update', onRoomListUpdate);
    socket.on('room:left', onRoomLeft);

    socket.emit('room:list', (res) => {
      if (res?.ok) {
        setPublicRooms(Array.isArray(res.rooms) ? res.rooms : []);
      }
    });

    return () => {
      socket.off('welcome', onWelcome);
      socket.off('room:update', onRoomUpdate);
      socket.off('game:start', onGameStart);
      socket.off('game:map', onGameMap);
      socket.off('game:state', onGameState);
      socket.off('game:audio', onGameAudio);
      socket.off('room:list:update', onRoomListUpdate);
      socket.off('room:left', onRoomLeft);
    };
  }, []);

  useEffect(() => {
    inputStateRef.current = inputState;
  }, [inputState]);

  useEffect(() => {
    const onResize = () => {
      setViewportSize(getViewportSize());
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!started) {
      setRoundOverlayHeight(44);
      return;
    }

    const overlay = roundOverlayRef.current;
    if (!overlay) return;

    const updateOverlayHeight = () => {
      setRoundOverlayHeight(Math.ceil(overlay.getBoundingClientRect().height) || 44);
    };

    updateOverlayHeight();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateOverlayHeight())
      : null;

    observer?.observe(overlay);
    window.addEventListener('resize', updateOverlayHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateOverlayHeight);
    };
  }, [started, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!started) return;

    const onDown = (event) => {
      const keyId = event.code || event.key.toLowerCase();
      if (heldKeysRef.current.has(keyId)) return;
      heldKeysRef.current.add(keyId);
      if (event.repeat) return;

      if (event.key.toLowerCase() === 'p') {
        socket.emit('room:toggle-cheat', (res) => {
          if (!res?.ok) {
            setError(res?.error || 'Unable to toggle cheat mode.');
          }
        });
        return;
      }

      if (event.key.toLowerCase() === 'o') {
        socket.emit('room:skip-level', (res) => {
          if (!res?.ok) {
            setError(res?.error || 'Unable to skip level.');
          }
        });
        return;
      }

      if (event.key === 'Enter') {
        const action = levelActionRef.current;
        if (!action.enabled) return;

        if (action.mode === 'results') {
          socket.emit('room:view-results', (res) => {
            if (!res?.ok) {
              setError(res?.error || 'Unable to open results.');
            }
          });
          return;
        }

        if (action.mode === 'next') {
          socket.emit('room:next-level', (res) => {
            if (!res?.ok) {
              setError(res?.error || 'Unable to start next level.');
            }
          });
          return;
        }

        socket.emit('room:restart', (res) => {
          if (!res?.ok) {
            setError(res?.error || 'Unable to restart level.');
          }
        });
        return;
      }

      const mapped = keyToInput(event.key);
      if (!mapped) return;
      if (inputStateRef.current[mapped]) return;
      const next = { ...inputStateRef.current, [mapped]: true };
      inputStateRef.current = next;
      setInputState(next);

      setSnapshot((prev) => {
        const meBefore = prev?.players?.find((p) => p.socketId === mySocketIdRef.current) || null;
        const nextSnapshot = applyClientPrediction(
          prev,
          mapPayloadRef.current,
          mySocketIdRef.current,
          mapped
        );

        if (mapped !== 'trap' && meBefore) {
          const meAfter = nextSnapshot?.players?.find((p) => p.socketId === mySocketIdRef.current) || null;
          const moved = Boolean(meAfter) && (meAfter.x !== meBefore.x || meAfter.y !== meBefore.y);
          if (moved) {
            pendingMovesRef.current.push({
              fromX: meBefore.x,
              fromY: meBefore.y,
              toX: meAfter.x,
              toY: meAfter.y,
              createdAt: Date.now()
            });
            if (pendingMovesRef.current.length > 8) {
              pendingMovesRef.current.shift();
            }
          }
        }

        if (mapped === 'trap' && nextSnapshot !== prev) {
          const me = prev?.players?.find((p) => p.socketId === mySocketIdRef.current);
          if (me) {
            predictedTrapsRef.current.add(`${me.x},${me.y}`);
          }
        }

        return nextSnapshot;
      });

      socket.emit('input:enqueue', { action: mapped });
    };

    const onUp = (event) => {
      const keyId = event.code || event.key.toLowerCase();
      heldKeysRef.current.delete(keyId);

      const mapped = keyToInput(event.key);
      if (!mapped) return;
      if (!inputStateRef.current[mapped]) return;
      const next = { ...inputStateRef.current, [mapped]: false };
      inputStateRef.current = next;
      setInputState(next);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      heldKeysRef.current.clear();
    };
  }, [started]);

  const myPlayer = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.players.find((p) => p.socketId === mySocketId);
  }, [snapshot, mySocketId]);

  const myCurrentCell = useMemo(() => {
    if (!mapPayload || !myPlayer) return null;
    const idx = myPlayer.y * mapPayload.cols + myPlayer.x;
    return mapPayload.cells?.[idx] || null;
  }, [mapPayload, myPlayer]);

  const hasRadarGadget = Boolean(
    myPlayer
    && !myPlayer.dead
    && !myPlayer.escaped
    && myCurrentCell?.type === 1
  );

  const hasMapGadget = Boolean(
    myPlayer
    && !myPlayer.dead
    && !myPlayer.escaped
    && myCurrentCell?.type === 2
  );

  useEffect(() => {
    soundManager.load();
    soundManager.setEnabled(soundEnabled);
    soundManager.setVolume(soundVolume);
    window.localStorage.setItem('maze.sound.enabled', String(soundEnabled));
    window.localStorage.setItem('maze.sound.volume', String(soundVolume));
  }, [soundEnabled, soundVolume]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, myName.trim().slice(0, 20));
  }, [myName]);

  useEffect(() => {
    if (!started || !snapshot) {
      prevSnapshotRef.current = null;
      prevMapGadgetRef.current = false;
      prevRadarGadgetRef.current = false;
      return;
    }

    const prev = prevSnapshotRef.current;

    if (prev) {
      let revivedAny = false;
      for (const player of snapshot.players || []) {
        if (!player.socketId) continue;
        const prevPlayer = prev.players?.find((p) => p.id === player.id);
        if (!prevPlayer) continue;

        if (!prevPlayer.hasKey && player.hasKey) soundManager.play(SOUND.KEY);
        if (!prevPlayer.escaped && player.escaped) soundManager.play(SOUND.EXIT);
        if (!revivedAny && prevPlayer.dead === 1 && player.dead === 0) {
          soundManager.play(SOUND.REVIVAL);
          revivedAny = true;
        }

        const dx = player.x - prevPlayer.x;
        const dy = player.y - prevPlayer.y;
        const movedTile = dx !== 0 || dy !== 0;
        if (movedTile && !player.dead && !player.escaped) {
          if (Math.abs(dx) + Math.abs(dy) === 1) soundManager.play(SOUND.STEP);
          else soundManager.play(SOUND.PORTAL);
        }

        if (mapPayload && movedTile && !player.dead && !player.escaped) {
          const cell = mapPayload.cells?.[player.y * mapPayload.cols + player.x];
          const prevCell = mapPayload.cells?.[prevPlayer.y * mapPayload.cols + prevPlayer.x];
          if (cell?.type === 2 && prevCell?.type !== 2) soundManager.play(SOUND.MAP);
          if (cell?.type === 1 && prevCell?.type !== 1) soundManager.play(SOUND.RADAR);
        }
      }

      if (prev.exit?.locked && snapshot.exit && !snapshot.exit.locked) {
        soundManager.play(SOUND.DOOR_UNLOCK);
      }
      if ((snapshot.traps?.length || 0) > (prev.traps?.length || 0)) {
        soundManager.play(SOUND.DOOR);
      }
      if ((snapshot.traps?.length || 0) < (prev.traps?.length || 0)) {
        soundManager.play(SOUND.DOOR_CLOSE);
      }
    }

    prevMapGadgetRef.current = hasMapGadget;
    prevRadarGadgetRef.current = hasRadarGadget;
    prevSnapshotRef.current = snapshot;
  }, [hasMapGadget, hasRadarGadget, mapPayload, snapshot, started]);

  useEffect(() => {
    if (!roomCode) return undefined;

    let active = true;
    const sendPing = () => {
      const sentAt = Date.now();
      socket.emit('net:ping', sentAt, (res) => {
        if (!active || !res?.ok) return;
        socket.emit('net:rtt', Date.now() - sentAt);
      });
    };

    sendPing();
    const intervalId = window.setInterval(sendPing, 2000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [roomCode]);

  const createRoom = () => {
    const enteredName = myName.trim();
    if (!enteredName) {
      setError('Please enter your name before creating or joining a room.');
      return;
    }

    socket.emit(
      'room:create',
      {
        name: enteredName,
        maxPlayers
      },
      (res) => {
        if (!res?.ok) {
          setError(res?.error || 'Failed to create room.');
          return;
        }
        setRoomCode(res.roomCode);
      }
    );
  };

  const joinRoom = () => {
    const enteredName = myName.trim();
    if (!enteredName) {
      setError('Please enter your name before creating or joining a room.');
      return;
    }

    socket.emit(
      'room:join',
      {
        roomCode: roomCodeInput,
        name: enteredName
      },
      (res) => {
        if (!res?.ok) {
          setError(res?.error || 'Failed to join room.');
          return;
        }
        setRoomCode(res.roomCode);
      }
    );
  };

  const joinRoomByCode = (targetCode) => {
    const enteredName = myName.trim();
    if (!enteredName) {
      setError('Please enter your name before creating or joining a room.');
      return;
    }

    socket.emit(
      'room:join',
      {
        roomCode: targetCode,
        name: enteredName
      },
      (res) => {
        if (!res?.ok) {
          setError(res?.error || 'Failed to join room.');
          return;
        }
        setRoomCode(res.roomCode);
      }
    );
  };

  const startRoom = () => {
    socket.emit('room:start', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to start game.');
      }
    });
  };

  const restartLevel = () => {
    socket.emit('room:restart', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to restart level.');
      }
    });
  };

  const goToNextLevel = () => {
    socket.emit('room:next-level', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to start next level.');
      }
    });
  };

  const leaveRoom = () => {
    socket.emit('room:leave', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to leave room.');
      }
    });
  };

  const viewResults = () => {
    socket.emit('room:view-results', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to open results.');
      }
    });
  };

  const inRoom = Boolean(roomCode);
  const hasValidName = Boolean(myName.trim());
  const isHost = mySocketId && hostSocketId === mySocketId;
  const connectedPlayers = (roomStatus?.players || []).filter((p) => p.connected);
  const roomLevel = roomStatus?.level || 1;
  const displayLevel = snapshot?.level || roomLevel;
  const levelSucceeded = Boolean(snapshot?.players?.some((p) => p.escaped));
  const allLevelsCleared = levelSucceeded && displayLevel === 5;
  const outOfLives = !levelSucceeded && remainingLives <= 0;
  const levelActionLabel = allLevelsCleared || outOfLives ? 'View Results' : levelSucceeded ? 'Next Level' : 'Restart Level';
  const cheatEnabled = Boolean(snapshot?.cheatEnabled);
  const showLevelActionButton = Boolean(snapshot?.finish);
  const showResultActionForAll = allLevelsCleared || outOfLives;
  const canTriggerLevelAction = showLevelActionButton && (isHost || showResultActionForAll);
  const enterHintText = canTriggerLevelAction ? `Press Enter to ${levelActionLabel}` : '';
  const roomRows = roomStatus?.rows || 0;
  const roomCols = roomStatus?.cols || roomRows * 2;
  const connectedRoundPlayers = (snapshot?.players || []).filter((p) => p.socketId).length;
  const highestLevelReached = Math.max(displayLevel, ...levelHistory.map((entry) => entry.level));
  const levelFiveResult = levelHistory.find((entry) => entry.level === 5);
  const completedAllLevels = Boolean(levelFiveResult?.players?.some((p) => p.escaped));

  useEffect(() => {
    let mode = 'restart';
    if (allLevelsCleared || outOfLives) mode = 'results';
    else if (levelSucceeded) mode = 'next';
    levelActionRef.current = { enabled: canTriggerLevelAction, mode };
  }, [allLevelsCleared, canTriggerLevelAction, levelSucceeded, outOfLives]);

  if (inRoom && started) {
    return (
      <div className="round-shell">
        <div className="round-overlay" role="status" aria-live="polite" ref={roundOverlayRef}>
          <div className="round-overlay-main">
            <span className="round-left">
              <span className="round-room">Room {roomCode}</span>
              <span className="round-level">{displayLevel}/5</span>
              <LivesBadge lives={remainingLives} />
              {showLevelActionButton && (isHost || showResultActionForAll) && (
                <button
                  className="round-level-action"
                  onClick={() => {
                    if (allLevelsCleared || outOfLives) {
                      viewResults();
                    } else if (levelSucceeded) {
                      goToNextLevel();
                    } else {
                      restartLevel();
                    }
                  }}
                  disabled={!isHost && !showResultActionForAll}
                  title={levelActionLabel}
                >
                  {levelActionLabel}
                </button>
              )}
              {cheatEnabled && <span className="round-level round-cheat-badge">Cheat On</span>}
              <span className="round-audio-inline">
                <button
                  className="icon-button sound-toggle"
                  onClick={() => setSoundEnabled((v) => !v)}
                  aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
                  title="Toggle sound"
                >
                  <SoundIcon muted={!soundEnabled} />
                </button>
                <input
                  className="audio-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(soundVolume * 100)}
                  style={{ '--value': `${Math.round(soundVolume * 100)}%` }}
                  onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
                  title="Volume"
                />
              </span>
            </span>

            <span className="round-right">
              <span className="round-right-info">
                <span className="round-players">
                  {connectedPlayers.map((p) => (
                    <span key={p.id} className="round-player-pill">
                      <span className="dot" style={{ backgroundColor: p.color }} />
                      <span>{p.name}</span>
                      {formatRtt(p.rttMs) && <span className="round-player-rtt">{formatRtt(p.rttMs)}</span>}
                    </span>
                  ))}
                </span>
              </span>
              <button
                className="round-lobby-action"
                onClick={leaveRoom}
                title="Return to lobby"
              >
                Return to Lobby
              </button>
            </span>
          </div>

          <span className="round-controls round-controls-floating"><ControlsLegend showRoundKeys={false} /></span>
        </div>

        <div className="round-canvas-wrap">
          <GameCanvas
            snapshot={snapshot}
            mapPayload={mapPayload}
            radarActive={Boolean(snapshot?.enableRadar)}
            mapActive={Boolean(snapshot?.enableMapView)}
            enterHintText={enterHintText}
            fullScreen
            overlayHeight={roundOverlayHeight}
          />
        </div>
        {error && <p className="round-error">{error}</p>}

        {showResults && (
          <div className="results-overlay">
            <div className="results-panel">
              <h2 className="results-title">
                {completedAllLevels ? 'All level finished 🏆' : `Highest level reached: ${highestLevelReached}`}
              </h2>
              <div className="results-levels">
                {[1, 2, 3, 4, 5].map((lvl) => {
                  const entry = levelHistory.find((h) => h.level === lvl);
                  const borderColor = levelTileColor(lvl, 0.75);
                  const shadowColor = levelTileColor(lvl, 0.18);
                  const deaths = entry
                    ? entry.players.filter((p) => !p.escaped && Number(p.dead) > 0).length
                    : 0;

                  return (
                    <div
                      key={lvl}
                      className="results-level-row"
                      style={{ borderColor, boxShadow: `inset 0 0 0 1px ${shadowColor}` }}
                    >
                      <div className="results-level-header">
                        <span className="results-level-badge">Level {lvl}</span>
                        {entry && (
                          <span className="results-attempts">
                            {entry.attempts === 1 ? '1 attempt' : `${entry.attempts} attempts`}
                          </span>
                        )}
                      </div>
                      {entry && (
                        <div className="results-level-stats">
                          <span className="results-time">
                            {formatRoundDuration(entry.durationMs)}
                          </span>
                          <span className="results-deaths">
                            {deaths === 1 ? '1 death' : `${deaths} deaths`}
                          </span>
                        </div>
                      )}
                      {entry ? (
                        <div className="results-players">
                          {entry.players.map((p) => (
                            <span key={p.id} className="results-player">
                              <span className="dot" style={{ backgroundColor: p.color }} />
                              <span className="results-player-name">{p.name}</span>
                              <span className={`results-outcome ${p.escaped ? 'escaped' : 'died'}`}>
                                {p.escaped ? 'Escaped' : 'Died'}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="results-players results-no-data">-</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="results-lobby-btn" onClick={leaveRoom}>
                Return to Lobby
              </button>
            </div>
          </div>
        )}
        <CopyrightBadge />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <h1>Maze Escaper</h1>
        <p>Multiplayer edition, no p5.js, same maze chaos.</p>
      </header>

      {!inRoom && (
        <section className="panel panel-forms">
          <div className="field">
            <label>Player Name</label>
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value.slice(0, 20))}
              placeholder="Your name"
              required
              aria-invalid={!hasValidName}
            />
          </div>
          {!hasValidName && <p className="error">Please enter your name before creating or joining a room.</p>}

          <div className="forms-grid">
            <article className="card">
              <h2>Create Room</h2>
              <p>Level starts at 1 and increases to 5 each restart.</p>
              <div className="field">
                <label>Player Slots</label>
                <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                </select>
              </div>
              <button onClick={createRoom} disabled={!hasValidName}>Create</button>
            </article>

            <article className="card">
              <h2>Join Room</h2>
              <div className="field">
                <label>Room Code</label>
                <input
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
              </div>
              <button className="join" onClick={joinRoom} disabled={!hasValidName}>Join</button>
            </article>

            <article className="card room-browser-card">
              <div className="room-browser-head">
                <h2>Open Rooms</h2>
                <span>{publicRooms.length}</span>
              </div>

              {publicRooms.length === 0 && <p className="room-browser-empty">No open rooms right now.</p>}

              {publicRooms.length > 0 && (
                <div className="room-browser-list">
                  {publicRooms.map((r) => (
                    <div key={r.roomCode} className="room-browser-row">
                      <div>
                        <div className="room-browser-code">{r.roomCode}</div>
                        <div className="room-browser-meta">
                          {r.hostName || 'Host'} • Players {r.connectedPlayers}/{r.maxPlayers}
                        </div>
                      </div>
                      <button className="join tiny-join" onClick={() => joinRoomByCode(r.roomCode)} disabled={!hasValidName}>
                        Join
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      )}

      {inRoom && !started && (
        <section className="panel panel-room">
          <div className="room-head">
            <div>
              <p className="room-label">Room</p>
              <h2>{roomCode}</h2>
            </div>
            <div className="room-actions">
              {!started && isHost && (
                <button onClick={startRoom} className="start">
                  Start Maze
                </button>
              )}
              <button onClick={leaveRoom} className="leave-room">
                Exit Room
              </button>
            </div>
          </div>

          <div className="status-grid">
            <div className="status-card">
              <h3>Players</h3>
              {roomStatus?.players?.filter((p) => p.connected)?.map((p) => (
                <div key={p.id} className="player-row">
                  <span className="dot" style={{ backgroundColor: p.color }} />
                  <span>{p.name}</span>
                  <span className="player-rtt">{formatRtt(p.rttMs) || '--'}</span>
                  {started && <span>{p.escaped ? 'Escaped' : p.dead ? 'Wasted' : 'Alive'}</span>}
                </div>
              ))}
            </div>

            <div className="status-card">
              <h3>Controls</h3>
              <p>Level {roomLevel} • Maze {roomRows}x{roomCols}</p>
              <ControlsLegend showRoundKeys={false} />
              <p>Radar: Step on radar tile to show pings.</p>
              <p>Goal: Find key, unlock exit, escape right side.</p>

              {myPlayer && (
                <p>
                  You are <strong>{myPlayer.name}</strong>
                  {myPlayer.escaped ? ' (Escaped)' : myPlayer.dead ? ' (Wasted)' : ' (Alive)'}
                </p>
              )}
            </div>
          </div>

          <p className="waiting">Waiting for host to start...</p>
          {error && <p className="error">{error}</p>}
        </section>
      )}
      <CopyrightBadge />
    </div>
  );
}
