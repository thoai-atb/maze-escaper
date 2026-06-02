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

function trapCellKey(x, y) {
  return `${Math.round(x)},${Math.round(y)}`;
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

function applyGameEvents(prevSnapshot, events, nowMs = Date.now()) {
  if (!prevSnapshot || !Array.isArray(events) || events.length === 0) return prevSnapshot;

  const normalizeDurationMs = (value, fallbackMs) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallbackMs;
  };

  const next = {
    ...prevSnapshot,
    players: (prevSnapshot.players || []).map((p) => ({ ...p })),
    ghosts: (prevSnapshot.ghosts || []).map((g) => ({ ...g })),
    traps: (prevSnapshot.traps || []).map((t) => ({ ...t })),
    portals: (prevSnapshot.portals || []).map((p) => ({ ...p })),
    exit: prevSnapshot.exit ? { ...prevSnapshot.exit } : prevSnapshot.exit,
    key: prevSnapshot.key ? { ...prevSnapshot.key } : prevSnapshot.key
  };

  const playerIndexById = new Map(next.players.map((p, i) => [p.id, i]));
  const ghostIndexById = new Map(next.ghosts.map((g, i) => [g.id, i]));

  const upsertTrap = (trap) => {
    const idx = next.traps.findIndex((t) => Math.round(t.x) === Math.round(trap.x) && Math.round(t.y) === Math.round(trap.y));
    if (idx >= 0) next.traps[idx] = { ...next.traps[idx], ...trap };
    else next.traps.push({ ...trap });
  };

  const closeTrap = (x, y) => {
    next.traps = next.traps.filter((t) => !(Math.round(t.x) === Math.round(x) && Math.round(t.y) === Math.round(y)));
  };

  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue;

    if (event.type === 'player_move') {
      const idx = playerIndexById.get(event.id);
      if (idx == null) continue;
      next.players[idx] = {
        ...next.players[idx],
        x: event.x,
        y: event.y,
        dead: event.dead ?? next.players[idx].dead,
        escaped: event.escaped ?? next.players[idx].escaped,
        fall: event.fall ?? next.players[idx].fall,
        hasKey: event.hasKey ?? next.players[idx].hasKey,
        teleported: false
      };
      continue;
    }

    if (event.type === 'player_fall') {
      const idx = playerIndexById.get(event.id);
      if (idx == null) continue;
      const wasFalling = Boolean(next.players[idx].fall);
      const durationMs = normalizeDurationMs(event.durationMs, 375);
      next.players[idx] = {
        ...next.players[idx],
        x: event.x,
        y: event.y,
        fall: true,
        fallStartedAtMs: wasFalling ? next.players[idx].fallStartedAtMs : nowMs,
        fallDurationMs: wasFalling ? next.players[idx].fallDurationMs : durationMs,
        teleported: false
      };
      continue;
    }

    if (event.type === 'player_die' || event.type === 'player_state') {
      const idx = playerIndexById.get(event.id);
      if (idx == null) continue;
      const current = next.players[idx];
      const nextFall = event.fall ?? current.fall;
      const fallStartedAtMs = nextFall
        ? (current.fall ? current.fallStartedAtMs : nowMs)
        : undefined;
      const fallDurationMs = nextFall
        ? (current.fall ? current.fallDurationMs : normalizeDurationMs(event.durationMs, 375))
        : undefined;
      next.players[idx] = {
        ...current,
        x: event.x ?? current.x,
        y: event.y ?? current.y,
        dead: event.dead ?? current.dead,
        escaped: event.escaped ?? current.escaped,
        fall: nextFall,
        hasKey: event.hasKey ?? current.hasKey,
        fallStartedAtMs,
        fallDurationMs,
        teleported: false
      };
      continue;
    }

    if (event.type === 'player_key') {
      const idx = playerIndexById.get(event.id);
      if (idx == null) continue;
      next.players[idx] = { ...next.players[idx], hasKey: Boolean(event.hasKey) };
      continue;
    }

    if (event.type === 'ghost_move') {
      const idx = ghostIndexById.get(event.id);
      if (idx == null) continue;
      next.ghosts[idx] = {
        ...next.ghosts[idx],
        x: event.x,
        y: event.y,
        fall: event.fall ?? next.ghosts[idx].fall,
        hasKey: event.hasKey ?? next.ghosts[idx].hasKey,
        teleported: false
      };
      continue;
    }

    if (event.type === 'ghost_fall' || event.type === 'ghost_state') {
      const idx = ghostIndexById.get(event.id);
      if (idx == null) continue;
      const current = next.ghosts[idx];
      const nextFall = event.fall ?? current.fall;
      const fallStartedAtMs = nextFall
        ? (current.fall ? current.fallStartedAtMs : nowMs)
        : undefined;
      const fallDurationMs = nextFall
        ? (current.fall ? current.fallDurationMs : normalizeDurationMs(event.durationMs, 695))
        : undefined;
      next.ghosts[idx] = {
        ...current,
        x: event.x ?? current.x,
        y: event.y ?? current.y,
        fall: nextFall,
        hasKey: event.hasKey ?? current.hasKey,
        fallStartedAtMs,
        fallDurationMs
      };
      continue;
    }

    if (event.type === 'ghost_key') {
      const idx = ghostIndexById.get(event.id);
      if (idx == null) continue;
      next.ghosts[idx] = { ...next.ghosts[idx], hasKey: Boolean(event.hasKey) };
      continue;
    }

    if (event.type === 'ghost_remove' || event.type === 'ghost_removed') {
      next.ghosts = next.ghosts.filter((g) => g.id !== event.id);
      ghostIndexById.clear();
      next.ghosts.forEach((g, i) => ghostIndexById.set(g.id, i));
      continue;
    }

    if (event.type === 'trap_open' || event.type === 'trap_placed') {
      const x = Number(event.x ?? event.trap?.x);
      const y = Number(event.y ?? event.trap?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const outer = Number(event.outer ?? event.trap?.outer ?? 0.7) || 0.7;
      const innerStart = Math.max(0, Number(event.innerStart ?? event.trap?.inner ?? 0) || 0);
      const innerEnd = Math.max(0, Number(event.innerEnd ?? (outer * 0.8)) || 0);
      const durationMs = Math.max(1, Math.round(Number(event.durationMs) || 450));
      upsertTrap({
        x,
        y,
        outer,
        inner: innerStart,
        set: false,
        active: false,
        animPhase: 'opening',
        animStartedAtMs: nowMs,
        animDurationMs: durationMs,
        animFromInner: innerStart,
        animToInner: innerEnd
      });
      continue;
    }

    if (event.type === 'trap_close' || event.type === 'trap_closed') {
      const x = Number(event.x);
      const y = Number(event.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const existing = next.traps.find((t) => Math.round(t.x) === Math.round(x) && Math.round(t.y) === Math.round(y));
      const outer = Number(event.outer ?? existing?.outer ?? 0.7) || 0.7;
      const innerStart = Math.max(0, Number(event.innerStart ?? existing?.inner ?? (outer * 0.8)) || 0);
      const durationMs = Math.max(1, Math.round(Number(event.durationMs) || 450));
      upsertTrap({
        x,
        y,
        outer,
        inner: innerStart,
        set: false,
        active: false,
        animPhase: 'closing',
        animStartedAtMs: nowMs,
        animDurationMs: durationMs,
        animFromInner: innerStart,
        animToInner: 0
      });
      continue;
    }

    if (event.type === 'portal_activated') {
      if (event.actorType === 'player') {
        const idx = playerIndexById.get(event.actorId);
        if (idx != null) {
          next.players[idx] = {
            ...next.players[idx],
            x: event.to?.x ?? next.players[idx].x,
            y: event.to?.y ?? next.players[idx].y,
            teleported: true
          };
        }
      } else if (event.actorType === 'ghost') {
        const idx = ghostIndexById.get(event.actorId);
        if (idx != null) {
          next.ghosts[idx] = {
            ...next.ghosts[idx],
            x: event.to?.x ?? next.ghosts[idx].x,
            y: event.to?.y ?? next.ghosts[idx].y,
            teleported: true
          };
        }
      }
      continue;
    }

    if (event.type === 'portal_removed') {
      next.portals = next.portals.filter((p) => !(p.x === event.x && p.y === event.y));
      continue;
    }

    if (event.type === 'portal_added') {
      if (event.portal) {
        const idx = next.portals.findIndex((p) => p.x === event.portal.x && p.y === event.portal.y);
        if (idx >= 0) next.portals[idx] = { ...next.portals[idx], ...event.portal };
        else next.portals.push({ ...event.portal });
      }
      continue;
    }

    if (event.type === 'portal_charged') {
      const idx = next.portals.findIndex((p) => p.x === event.x && p.y === event.y);
      if (idx >= 0) {
        next.portals[idx] = { ...next.portals[idx], active: true };
      } else {
        next.portals.push({ x: event.x, y: event.y, active: true, pulse: 1 });
      }
      continue;
    }

    if (event.type === 'radar_toggle') {
      next.enableRadar = Boolean(event.enabled);
      continue;
    }

    if (event.type === 'map_toggle') {
      next.enableMapView = Boolean(event.enabled);
      continue;
    }

    if (event.type === 'cheat_toggle') {
      next.cheatEnabled = Boolean(event.enabled);
      continue;
    }

    if (event.type === 'exit_lock') {
      next.exit = {
        ...(next.exit || {}),
        locked: Boolean(event.locked)
      };
      if (!Boolean(event.locked)) {
        // Exit consumed the key, so clear it from the board/owners.
        next.key = null;
      }
      continue;
    }

    if (event.type === 'key_dropped') {
      next.key = {
        type: 'cell',
        x: Math.round(Number(event.x) || 0),
        y: Math.round(Number(event.y) || 0)
      };
      continue;
    }

    if (event.type === 'key_picked_up') {
      const ownerType = String(event.by?.type || '');
      const ownerId = Number(event.by?.id);
      if (!Number.isFinite(ownerId)) {
        next.key = null;
      } else if (ownerType === 'player') {
        next.key = { type: 'player', playerId: ownerId };
      } else if (ownerType === 'ghost') {
        next.key = { type: 'ghost', ghostId: ownerId };
      }
      continue;
    }

    if (event.type === 'round_finish') {
      next.finish = true;
      if (typeof event.canRestart === 'boolean') {
        next.canRestart = event.canRestart;
      }
      if (typeof event.minBright === 'number') {
        next.minBright = event.minBright;
      }
      if (Array.isArray(event.playerGhostKills)) {
        const ghostKillsById = new Map(
          event.playerGhostKills
            .map((entry) => [Number(entry?.id), Number(entry?.ghostKills) || 0])
            .filter(([id]) => Number.isFinite(id))
        );
        next.players = next.players.map((player) => (
          ghostKillsById.has(player.id)
            ? { ...player, ghostKills: ghostKillsById.get(player.id) }
            : player
        ));
      }
      continue;
    }

    if (event.type === 'round_state') {
      next.finish = Boolean(event.finish);
      next.canRestart = Boolean(event.canRestart ?? next.canRestart);
      continue;
    }
  }

  return next;
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
  const fullHeart = '\u2665';
  const emptyHeart = '\u2661';
  return (
    <span className="round-level round-lives" title={`${count} lives remaining`}>
      <span className="round-lives-hearts" aria-hidden="true">{fullHeart.repeat(count) || emptyHeart}</span>
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
  return <div className="copyright-badge">{`\u00A9 Thoai Ly 2026`}</div>;
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
  const [hideGhostRadarBlips, setHideGhostRadarBlips] = useState(false);
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
  const trapCloseTimersRef = useRef(new Map());
  const levelActionRef = useRef({ enabled: false, mode: 'restart' });
  const showResultsRef = useRef(false);

  useEffect(() => {
    mySocketIdRef.current = mySocketId;
  }, [mySocketId]);

  useEffect(() => {
    mapPayloadRef.current = mapPayload;
  }, [mapPayload]);

  const clearTrapCloseTimers = () => {
    for (const timerId of trapCloseTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    trapCloseTimersRef.current.clear();
  };

  useEffect(() => {
    const onWelcome = (data) => setMySocketId(data.socketId);
    const onRoomUpdate = (data) => {
      if (typeof data?.roomCode === 'string' && data.roomCode) {
        setRoomCode(data.roomCode);
      }
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
      setHideGhostRadarBlips(false);
      setShowResults(false);
      setError('');
      clearTrapCloseTimers();
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };
    const onGameMap = (data) => {
      setMapPayload(data?.map || null);
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };
    const onGameInit = (data) => {
      setSnapshot(data?.snapshot || null);
      setHideGhostRadarBlips(false);
      if (Array.isArray(data?.levelHistory)) setLevelHistory(data.levelHistory);
      if (typeof data?.remainingLives === 'number') setRemainingLives(data.remainingLives);
      if (typeof data?.resultsOpened === 'boolean') setShowResults(data.resultsOpened);
      clearTrapCloseTimers();
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };
    const onGameEvents = (data) => {
      const events = Array.isArray(data?.events) ? data.events : [];
      const ui = data?.ui || null;
      const nowMs = Date.now();

      const radarEnabledNow = events.some((event) => event?.type === 'radar_toggle' && Boolean(event.enabled));
      const hasFreshGhostUpdate = events.some((event) => (
        event?.type === 'ghost_move'
        || event?.type === 'ghost_fall'
        || event?.type === 'ghost_state'
        || event?.type === 'ghost_remove'
        || event?.type === 'ghost_removed'
      ));

      if (radarEnabledNow) {
        setHideGhostRadarBlips(!hasFreshGhostUpdate);
      } else if (hasFreshGhostUpdate) {
        setHideGhostRadarBlips(false);
      }

      for (const event of events) {
        if (event?.type === 'trap_open' || (event?.type === 'trap_placed' && event.trap)) {
          const x = Number(event.x ?? event.trap?.x);
          const y = Number(event.y ?? event.trap?.y);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            predictedTrapsRef.current.delete(trapCellKey(x, y));
          }
          soundManager.play(SOUND.DOOR);
        }
        if (event?.type === 'trap_close' || event?.type === 'trap_closed') {
          soundManager.play(SOUND.DOOR_CLOSE);

          const x = Number(event.x);
          const y = Number(event.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const key = trapCellKey(x, y);
          const durationMs = Math.max(1, Math.round(Number(event.durationMs) || 450));

          const oldTimer = trapCloseTimersRef.current.get(key);
          if (oldTimer) {
            window.clearTimeout(oldTimer);
          }

          const timerId = window.setTimeout(() => {
            setSnapshot((prev) => {
              if (!prev) return prev;
              const filteredTraps = (prev.traps || []).filter((trap) => !sameCellTrap(trap, Math.round(x), Math.round(y)));
              if (filteredTraps.length === (prev.traps || []).length) return prev;
              return {
                ...prev,
                traps: filteredTraps
              };
            });
            trapCloseTimersRef.current.delete(key);
          }, durationMs + 32);

          trapCloseTimersRef.current.set(key, timerId);
        }
      }

      setSnapshot((prev) => {
        const next = applyGameEvents(prev, events, nowMs);
        const selfSocketId = mySocketIdRef.current;
        if (selfSocketId && next && pendingMovesRef.current.length > 0) {
          const me = next.players?.find((p) => p.socketId === selfSocketId);
          if (me) {
            while (pendingMovesRef.current.length > 0) {
              const head = pendingMovesRef.current[0];
              if (me.x === head.toX && me.y === head.toY) {
                pendingMovesRef.current.shift();
                continue;
              }
              if (Date.now() - head.createdAt > MOVE_PREDICTION_GRACE_MS * 3) {
                pendingMovesRef.current.shift();
                continue;
              }
              break;
            }
          }
        }
        return next;
      });

      for (const event of events) {
        if (event?.type === 'round_finish') {
          if (Array.isArray(event.levelHistory)) setLevelHistory(event.levelHistory);
          if (typeof event.remainingLives === 'number') setRemainingLives(event.remainingLives);
          if (typeof event.resultsOpened === 'boolean') setShowResults(event.resultsOpened);
          if (Array.isArray(event.exploredCellIndices)) {
            setMapPayload((prevMap) => {
              if (!prevMap?.cells || !Array.isArray(prevMap.cells)) return prevMap;
              const exploredSet = new Set(
                event.exploredCellIndices
                  .map((idx) => Number(idx))
                  .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < prevMap.cells.length)
              );
              return {
                ...prevMap,
                cells: prevMap.cells.map((cell, idx) => ({
                  ...cell,
                  explored: exploredSet.has(idx)
                }))
              };
            });
          }
        }
      }

      if (ui) {
        if (Array.isArray(ui.levelHistory)) setLevelHistory(ui.levelHistory);
        if (typeof ui.remainingLives === 'number') setRemainingLives(ui.remainingLives);
        if (typeof ui.resultsOpened === 'boolean') setShowResults(ui.resultsOpened);
      }
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
      setHideGhostRadarBlips(false);
      setLevelHistory([]);
      setRemainingLives(3);
      setShowResults(false);
      setInputState(initialInput);
      setError('');
      clearTrapCloseTimers();
      predictedTrapsRef.current.clear();
      pendingMovesRef.current.length = 0;
    };

    socket.on('welcome', onWelcome);
    socket.on('room:update', onRoomUpdate);
    socket.on('game:start', onGameStart);
    socket.on('game:map', onGameMap);
    socket.on('game:init', onGameInit);
    socket.on('game:events', onGameEvents);
    socket.on('game:audio', onGameAudio);
    socket.on('room:list:update', onRoomListUpdate);
    socket.on('room:left', onRoomLeft);

    socket.emit('room:list', (res) => {
      if (res?.ok) {
        setPublicRooms(Array.isArray(res.rooms) ? res.rooms : []);
      }
    });

    return () => {
      clearTrapCloseTimers();
      socket.off('welcome', onWelcome);
      socket.off('room:update', onRoomUpdate);
      socket.off('game:start', onGameStart);
      socket.off('game:map', onGameMap);
      socket.off('game:init', onGameInit);
      socket.off('game:events', onGameEvents);
      socket.off('game:audio', onGameAudio);
      socket.off('room:list:update', onRoomListUpdate);
      socket.off('room:left', onRoomLeft);
    };
  }, []);

  useEffect(() => {
    inputStateRef.current = inputState;
  }, [inputState]);

  useEffect(() => {
    showResultsRef.current = showResults;
  }, [showResults]);

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

      if (event.code === 'Space') {
        if (showResultsRef.current) {
          event.preventDefault();
          leaveRoom();
          return;
        }

        const action = levelActionRef.current;
        if (!action.enabled) {
          // Space should continue to behave as trap input during normal gameplay.
        } else {
          event.preventDefault();

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
        const teleportedStarted = Boolean(player.teleported) && !Boolean(prevPlayer.teleported);
        if (teleportedStarted && !player.dead && !player.escaped) {
          soundManager.play(SOUND.PORTAL);
        }
        if (movedTile && !player.dead && !player.escaped) {
          if (!teleportedStarted && Math.abs(dx) + Math.abs(dy) === 1) soundManager.play(SOUND.STEP);
          else if (!teleportedStarted && Math.abs(dx) + Math.abs(dy) !== 1) soundManager.play(SOUND.PORTAL);
        }

        if (mapPayload && movedTile && !player.dead && !player.escaped) {
          const cell = mapPayload.cells?.[player.y * mapPayload.cols + player.x];
          const prevCell = mapPayload.cells?.[prevPlayer.y * mapPayload.cols + prevPlayer.x];
          if (cell?.type === 2 && prevCell?.type !== 2) soundManager.play(SOUND.MAP);
          if (cell?.type === 1 && prevCell?.type !== 1) soundManager.play(SOUND.RADAR);
        }
      }

      for (const ghost of snapshot.ghosts || []) {
        const prevGhost = prev.ghosts?.find((g) => g.id === ghost.id);
        if (!prevGhost) continue;

        const teleportedStarted = Boolean(ghost.teleported) && !Boolean(prevGhost.teleported);
        if (teleportedStarted) {
          soundManager.play(SOUND.PORTAL);
        }

        if (!prevGhost.fall && ghost.fall) {
          soundManager.play(SOUND.GHOST_FADE);
        }
      }

      if (prev.exit?.locked && snapshot.exit && !snapshot.exit.locked) {
        soundManager.play(SOUND.DOOR_UNLOCK);
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
  const roomRows = roomStatus?.rows || 0;
  const roomCols = roomStatus?.cols || roomRows * 2;
  const connectedRoundPlayers = (snapshot?.players || []).filter((p) => p.socketId).length;
  const roundFinishPlayers = (snapshot?.players || []).filter((p) => p.socketId);
  const highestLevelReached = Math.max(displayLevel, ...levelHistory.map((entry) => entry.level));
  const levelFiveResult = levelHistory.find((entry) => entry.level === 5);
  const completedAllLevels = Boolean(levelFiveResult?.players?.some((p) => p.escaped));

  const triggerLevelAction = () => {
    if (allLevelsCleared || outOfLives) {
      viewResults();
      return;
    }
    if (levelSucceeded) {
      goToNextLevel();
      return;
    }
    restartLevel();
  };

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
            hideGhostRadarBlips={hideGhostRadarBlips}
            mapActive={Boolean(snapshot?.enableMapView)}
            enterHintText=""
            fullScreen
            overlayHeight={roundOverlayHeight}
          />

          {snapshot?.finish && (
            <div className="round-finish-overlay" role="status" aria-live="polite">
              <div className="round-finish-card">
                <h2 className="round-finish-title">Round Over</h2>
                <div className="round-finish-list">
                  {roundFinishPlayers.map((p) => (
                    <div key={p.id} className="round-finish-row">
                      <span className="dot" style={{ backgroundColor: p.color }} />
                      <span className="round-finish-name">{p.name}</span>
                      <span className="round-finish-kills">{`${Number(p.ghostKills) || 0} kills`}</span>
                      <span className={`round-finish-outcome ${p.escaped ? 'escaped' : 'died'}`}>
                        {p.escaped ? 'Escaped' : 'Died'}
                      </span>
                    </div>
                  ))}
                </div>
                {canTriggerLevelAction && !showResults && (
                  <div className="round-finish-actions">
                    <button
                      className="round-finish-action"
                      onClick={triggerLevelAction}
                      title={levelActionLabel}
                    >
                      {levelActionLabel}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {error && <p className="round-error">{error}</p>}

        {showResults && snapshot?.finish && (
          <div className="results-overlay">
            <div className="results-panel">
              <h2 className="results-title">
                {completedAllLevels ? 'All levels finished' : `Highest level reached: ${highestLevelReached}`}
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
                              <span className="results-player-meta">
                                <span className="results-player-kills">{`${Number(p.ghostKills) || 0} kills`}</span>
                                <span className={`results-outcome ${p.escaped ? 'escaped' : 'died'}`}>
                                  {p.escaped ? 'Escaped' : 'Died'}
                                </span>
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
                <button className="results-lobby-btn results-grid-btn" onClick={leaveRoom}>
                  Return to Lobby
                </button>
              </div>
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
                          {r.hostName || 'Host'} - Players {r.connectedPlayers}/{r.maxPlayers}
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
              <p>Level {roomLevel} - Maze {roomRows}x{roomCols}</p>
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
