import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from './socket';
import GameCanvas from './game/GameCanvas';
import { soundManager, SOUND } from './audio/soundManager';

const initialInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  trap: false
};

function keyToInput(key) {
  const k = key.toLowerCase();
  if (k === 'arrowup' || k === 'w') return 'up';
  if (k === 'arrowdown' || k === 's') return 'down';
  if (k === 'arrowleft' || k === 'a') return 'left';
  if (k === 'arrowright' || k === 'd') return 'right';
  if (k === 'q' || k === 'e' || k === ' ') return 'trap';
  return null;
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
          <KeyCap label="Q" />
          <KeyCap label="E" />
          <KeyCap label="Space" />
        </span>
        <span>Trap</span>
      </span>
      {showRoundKeys && (
        <>
          <span className="control-item">
            <span className="keycap-row">
              <KeyCap label="R" />
            </span>
            <span>Restart</span>
          </span>
          <span className="control-item">
            <span className="keycap-row">
              <KeyCap label="L" />
            </span>
            <span>Lobby</span>
          </span>
        </>
      )}
    </span>
  );
}

export default function App() {
  const [mySocketId, setMySocketId] = useState('');
  const [myName, setMyName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [rows, setRows] = useState(10);
  const [maxPlayers, setMaxPlayers] = useState(6);

  const [roomCode, setRoomCode] = useState('');
  const [roomStatus, setRoomStatus] = useState(null);
  const [hostSocketId, setHostSocketId] = useState('');
  const [started, setStarted] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [publicRooms, setPublicRooms] = useState([]);
  const [inputState, setInputState] = useState(initialInput);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = window.localStorage.getItem('maze.sound.enabled');
    return saved == null ? true : saved === 'true';
  });
  const [soundVolume, setSoundVolume] = useState(() => {
    const saved = Number(window.localStorage.getItem('maze.sound.volume'));
    if (Number.isNaN(saved)) return 0.5;
    return Math.max(0, Math.min(1, saved));
  });

  const prevSnapshotRef = useRef(null);
  const prevMapGadgetRef = useRef(false);
  const prevRadarGadgetRef = useRef(false);

  useEffect(() => {
    const onWelcome = (data) => setMySocketId(data.socketId);
    const onRoomUpdate = (data) => {
      setRoomCode(data.roomCode);
      setRoomStatus(data.status);
      setHostSocketId(data.hostSocketId || '');
      setStarted(Boolean(data.started));
      setError('');
    };
    const onGameStart = () => {
      setStarted(true);
      setError('');
    };
    const onGameState = (data) => {
      setSnapshot(data.snapshot);
    };
    const onRoomListUpdate = (data) => {
      setPublicRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    };
    const onRoomLeft = () => {
      setRoomCode('');
      setRoomStatus(null);
      setHostSocketId('');
      setStarted(false);
      setSnapshot(null);
      setInputState(initialInput);
      setError('');
    };

    socket.on('welcome', onWelcome);
    socket.on('room:update', onRoomUpdate);
    socket.on('game:start', onGameStart);
    socket.on('game:state', onGameState);
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
      socket.off('game:state', onGameState);
      socket.off('room:list:update', onRoomListUpdate);
      socket.off('room:left', onRoomLeft);
    };
  }, []);

  useEffect(() => {
    if (!started) return;

    const onDown = (event) => {
      const k = event.key.toLowerCase();
      if (k === 'r') {
        socket.emit('room:restart', (res) => {
          if (!res?.ok) {
            setError(res?.error || 'Unable to restart match.');
          }
        });
        return;
      }

      if (k === 'l') {
        socket.emit('room:leave', (res) => {
          if (!res?.ok) {
            setError(res?.error || 'Unable to return to lobby.');
          }
        });
        return;
      }

      const mapped = keyToInput(event.key);
      if (!mapped) return;
      setInputState((prev) => {
        if (prev[mapped]) return prev;
        const next = { ...prev, [mapped]: true };
        socket.emit('input:update', next);
        return next;
      });
    };

    const onUp = (event) => {
      const mapped = keyToInput(event.key);
      if (!mapped) return;
      setInputState((prev) => {
        if (!prev[mapped]) return prev;
        const next = { ...prev, [mapped]: false };
        socket.emit('input:update', next);
        return next;
      });
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      socket.emit('input:update', initialInput);
    };
  }, [snapshot?.finish, started]);

  const myPlayer = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.players.find((p) => p.socketId === mySocketId);
  }, [snapshot, mySocketId]);

  const myCurrentCell = useMemo(() => {
    if (!snapshot || !myPlayer) return null;
    const idx = myPlayer.y * snapshot.cols + myPlayer.x;
    return snapshot.cells[idx] || null;
  }, [myPlayer, snapshot]);

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
    if (!started || !snapshot) {
      prevSnapshotRef.current = null;
      prevMapGadgetRef.current = false;
      prevRadarGadgetRef.current = false;
      return;
    }

    const prev = prevSnapshotRef.current;
    const me = snapshot.players?.find((p) => p.socketId === mySocketId);
    const prevMe = prev?.players?.find((p) => p.socketId === mySocketId);

    if (me && prevMe) {
      if (!prevMe.hasKey && me.hasKey) soundManager.play(SOUND.KEY);
      if (prevMe.dead === 0 && me.dead === 1) soundManager.play(SOUND.SCREAM);
      if (prevMe.dead !== 2 && me.dead === 2) soundManager.play(SOUND.FALL_SCREAM);
      if (!prevMe.escaped && me.escaped) soundManager.play(SOUND.EXIT);

      const dx = me.x - prevMe.x;
      const dy = me.y - prevMe.y;
      const movedTile = dx !== 0 || dy !== 0;
      if (movedTile && !me.dead && !me.escaped) {
        if (Math.abs(dx) + Math.abs(dy) === 1) soundManager.play(SOUND.STEP);
        else soundManager.play(SOUND.PORTAL);
      }
    }

    if (!prevMapGadgetRef.current && hasMapGadget) {
      soundManager.play(SOUND.MAP);
    }
    if (!prevRadarGadgetRef.current && hasRadarGadget) {
      soundManager.play(SOUND.RADAR);
    }

    if (prev) {
      if (prev.exit?.locked && snapshot.exit && !snapshot.exit.locked) {
        soundManager.play(SOUND.DOOR_UNLOCK);
      }

      for (const player of snapshot.players || []) {
        if (!player.socketId) continue;
        const prevPlayer = prev.players?.find((p) => p.id === player.id);
        if (prevPlayer?.dead === 1 && player.dead === 0) {
          soundManager.play(SOUND.REVIVAL);
          break;
        }
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
  }, [hasMapGadget, hasRadarGadget, mySocketId, snapshot, started]);

  const createRoom = () => {
    socket.emit(
      'room:create',
      {
        name: myName,
        rows,
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
    socket.emit(
      'room:join',
      {
        roomCode: roomCodeInput,
        name: myName
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
    socket.emit(
      'room:join',
      {
        roomCode: targetCode,
        name: myName
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

  const leaveRoom = () => {
    socket.emit('room:leave', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to leave room.');
      }
    });
  };

  const inRoom = Boolean(roomCode);
  const isHost = mySocketId && hostSocketId === mySocketId;
  const connectedPlayers = (roomStatus?.players || []).filter((p) => p.connected);

  if (inRoom && started) {
    return (
      <div className="round-shell">
        <div className="round-overlay" role="status" aria-live="polite">
          <div className="round-overlay-main">
            <span className="round-left">
              <span className="round-room">Room {roomCode}</span>
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

            <span className="round-players">
              {connectedPlayers.map((p) => (
                <span key={p.id} className="round-player-pill">
                  <span className="dot" style={{ backgroundColor: p.color }} />
                  <span>{p.name}</span>
                </span>
              ))}
            </span>
          </div>

          <span className="round-controls round-controls-floating"><ControlsLegend /></span>
        </div>

        <div className="round-canvas-wrap">
          <GameCanvas
            snapshot={snapshot}
            radarActive={Boolean(snapshot?.enableRadar)}
            mapActive={Boolean(snapshot?.enableMapView)}
            fullScreen
            overlayHeight={44}
          />
        </div>
        {error && <p className="round-error">{error}</p>}
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
            />
          </div>

          <div className="forms-grid">
            <article className="card">
              <h2>Create Room</h2>
              <div className="field">
                <label>Maze Size: {rows} x {rows * 2}</label>
                <input
                  type="range"
                  min="6"
                  max="20"
                  value={rows}
                  onChange={(e) => setRows(Number(e.target.value))}
                />
              </div>
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
              <button onClick={createRoom}>Create</button>
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
              <button className="join" onClick={joinRoom}>Join</button>
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
                          Host {r.hostName} • {r.connectedPlayers}/{r.maxPlayers} • {r.rows}x{r.cols}
                        </div>
                      </div>
                      <button className="join tiny-join" onClick={() => joinRoomByCode(r.roomCode)}>
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
                  Start Match
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
                  {started && <span>{p.escaped ? 'Escaped' : p.dead ? 'Wasted' : 'Alive'}</span>}
                </div>
              ))}
            </div>

            <div className="status-card">
              <h3>Controls</h3>
              <ControlsLegend showRoundKeys={false} />
              <p>Radar: Step on radar tile to show pings.</p>
              <p>Goal: Find key, unlock exit, escape right side.</p>
              <p className="game-over-help">
                Game Over:
                {' '}
                <KeyCap label="R" /> restart,
                {' '}
                <KeyCap label="L" /> lobby.
              </p>
              <div className="lobby-audio-row">
                <button
                  className="icon-button tiny-button"
                  onClick={() => setSoundEnabled((v) => !v)}
                  aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
                  title="Toggle sound"
                >
                  <SoundIcon muted={!soundEnabled} />
                </button>
                <input
                  className="audio-slider volume-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(soundVolume * 100)}
                  style={{ '--value': `${Math.round(soundVolume * 100)}%` }}
                  onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
                  title="Volume"
                />
              </div>
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
    </div>
  );
}
