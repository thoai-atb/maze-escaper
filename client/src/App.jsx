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
  if (k === 'q' || k === 'e' || k === ' ') return 'trap';
  return null;
}

function levelTileColor(level, alpha = 1) {
  const theme = getTileThemeByLevel(level).unvisited;
  const lightness = Math.round(theme.lightnessScale * 100);
  return alpha === 1
    ? `hsl(${theme.hue} ${theme.saturation}% ${lightness}%)`
    : `hsl(${theme.hue} ${theme.saturation}% ${lightness}% / ${alpha})`;
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
          <KeyCap label="Q" />
          <KeyCap label="E" />
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
  const [myName, setMyName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(6);

  const [roomCode, setRoomCode] = useState('');
  const [roomStatus, setRoomStatus] = useState(null);
  const [hostSocketId, setHostSocketId] = useState('');
  const [started, setStarted] = useState(false);
  const [roundOverlayHeight, setRoundOverlayHeight] = useState(44);
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
    const saved = Number(window.localStorage.getItem('maze.sound.volume'));
    if (Number.isNaN(saved)) return 0.5;
    return Math.max(0, Math.min(1, saved));
  });

  const prevSnapshotRef = useRef(null);
  const prevMapGadgetRef = useRef(false);
  const prevRadarGadgetRef = useRef(false);
  const heldKeysRef = useRef(new Set());
  const inputStateRef = useRef(initialInput);
  const roundOverlayRef = useRef(null);

  useEffect(() => {
    const onWelcome = (data) => setMySocketId(data.socketId);
    const onRoomUpdate = (data) => {
      setRoomCode(data.roomCode);
      setRoomStatus(data.status);
      if (typeof data.status?.remainingLives === 'number') setRemainingLives(data.status.remainingLives);
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
      if (Array.isArray(data.levelHistory)) setLevelHistory(data.levelHistory);
      if (typeof data.remainingLives === 'number') setRemainingLives(data.remainingLives);
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
      setLevelHistory([]);
      setRemainingLives(3);
      setShowResults(false);
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

      const mapped = keyToInput(event.key);
      if (!mapped) return;
      if (inputStateRef.current[mapped]) return;
      const next = { ...inputStateRef.current, [mapped]: true };
      inputStateRef.current = next;
      setInputState(next);
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
      if (prevMe.dead === 0 && me.dead === 1 && !prevMe.fall && !me.fall) soundManager.play(SOUND.SCREAM);
      if (!prevMe.fall && me.fall) soundManager.play(SOUND.FALL_SCREAM);
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

  const inRoom = Boolean(roomCode);
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
  const roomRows = roomStatus?.rows || 0;
  const roomCols = roomStatus?.cols || roomRows * 2;
  const connectedRoundPlayers = (snapshot?.players || []).filter((p) => p.socketId).length;
  const highestLevelReached = Math.max(displayLevel, ...levelHistory.map((entry) => entry.level));

  const finishButtonMetrics = useMemo(() => {
    const width = viewportSize.width;
    const height = Math.max(0, viewportSize.height - roundOverlayHeight);

    const titleSize = Math.max(34, width * 0.06);
    const rowHeight = Math.max(26, width * 0.028);
    const panelWidth = Math.min(width * 0.58, 520);
    const panelPaddingY = Math.max(10, rowHeight * 0.33);
    const panelHeight = Math.max(48, connectedRoundPlayers * rowHeight + panelPaddingY * 2);
    const titleY = height * 0.38;
    const panelY = titleY + Math.max(24, titleSize * 0.55);

    return {
      top: roundOverlayHeight + panelY + panelHeight + 8,
      width: panelWidth / 2
    };
  }, [connectedRoundPlayers, roundOverlayHeight, viewportSize.height, viewportSize.width]);

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
              <span className="round-players">
                {connectedPlayers.map((p) => (
                  <span key={p.id} className="round-player-pill">
                    <span className="dot" style={{ backgroundColor: p.color }} />
                    <span>{p.name}</span>
                  </span>
                ))}
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
            radarActive={Boolean(snapshot?.enableRadar)}
            mapActive={Boolean(snapshot?.enableMapView)}
            fullScreen
            overlayHeight={roundOverlayHeight}
          />
        </div>
        {showLevelActionButton && isHost && (
          <button
            className="round-restart-finish"
            onClick={() => {
              if (allLevelsCleared || outOfLives) {
                setShowResults(true);
              } else if (levelSucceeded) {
                goToNextLevel();
              } else {
                restartLevel();
              }
            }}
            disabled={!isHost}
            title={levelActionLabel}
            style={{ top: `${finishButtonMetrics.top}px`, width: `${finishButtonMetrics.width}px` }}
          >
            {levelActionLabel}
          </button>
        )}
        {error && <p className="round-error">{error}</p>}

        {showResults && (
          <div className="results-overlay">
            <div className="results-panel">
              <h2 className="results-title">Highest level reached: {highestLevelReached}</h2>
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
                          <>
                            <span className="results-attempts">
                              {entry.attempts === 1 ? '1 attempt' : `${entry.attempts} attempts`}
                            </span>
                            <span className="results-deaths">
                              {deaths === 1 ? '1 death' : `${deaths} deaths`}
                            </span>
                          </>
                        )}
                      </div>
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
            />
          </div>

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
                          Host {r.hostName} • Players {r.connectedPlayers}/{r.maxPlayers}
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
