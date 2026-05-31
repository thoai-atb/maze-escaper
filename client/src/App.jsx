import { useEffect, useMemo, useState } from 'react';
import { socket } from './socket';
import GameCanvas from './game/GameCanvas';

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

export default function App() {
  const [mySocketId, setMySocketId] = useState('');
  const [myName, setMyName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [rows, setRows] = useState(10);
  const [maxPlayers, setMaxPlayers] = useState(2);

  const [roomCode, setRoomCode] = useState('');
  const [roomStatus, setRoomStatus] = useState(null);
  const [hostSocketId, setHostSocketId] = useState('');
  const [started, setStarted] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [inputState, setInputState] = useState(initialInput);
  const [clientInterpolationEnabled, setClientInterpolationEnabled] = useState(false);

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
    socket.on('room:left', onRoomLeft);

    return () => {
      socket.off('welcome', onWelcome);
      socket.off('room:update', onRoomUpdate);
      socket.off('game:start', onGameStart);
      socket.off('game:state', onGameState);
      socket.off('room:left', onRoomLeft);
    };
  }, []);

  useEffect(() => {
    if (!started) return;

    const onDown = (event) => {
      const k = event.key.toLowerCase();
      if (snapshot?.finish) {
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

  const startRoom = () => {
    socket.emit('room:start', (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Unable to start game.');
      }
    });
  };

  const inRoom = Boolean(roomCode);
  const isHost = mySocketId && hostSocketId === mySocketId;

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
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      )}

      {inRoom && (
        <section className="panel panel-room">
          <div className="room-head">
            <div>
              <p className="room-label">Room</p>
              <h2>{roomCode}</h2>
            </div>
            {!started && isHost && (
              <button onClick={startRoom} className="start">
                Start Match
              </button>
            )}
          </div>

          <div className="status-grid">
            <div className="status-card">
              <h3>Players</h3>
              {roomStatus?.players?.map((p) => (
                <div key={p.id} className="player-row">
                  <span className="dot" style={{ backgroundColor: p.color }} />
                  <span>{p.name}</span>
                  <span>{p.connected ? 'Connected' : 'Waiting'}</span>
                  {started && <span>{p.escaped ? 'Escaped' : p.dead ? 'Wasted' : 'Alive'}</span>}
                </div>
              ))}
            </div>

            <div className="status-card">
              <h3>Controls</h3>
              <p>Move: WASD or Arrow Keys</p>
              <p>Trap: Q, E, or Space</p>
              <p>Radar: Step on radar tile to show pings.</p>
              <p>Goal: Find key, unlock exit, escape right side.</p>
              <p>Game Over: R to restart, L to lobby.</p>
              {myPlayer && (
                <p>
                  You are <strong>{myPlayer.name}</strong>
                  {myPlayer.escaped ? ' (Escaped)' : myPlayer.dead ? ' (Wasted)' : ' (Alive)'}
                </p>
              )}
            </div>
          </div>

          <div className="render-toggle">
            <label>
              <input
                type="checkbox"
                checked={clientInterpolationEnabled}
                onChange={(e) => setClientInterpolationEnabled(e.target.checked)}
              />
              Smooth Client Interpolation
            </label>
            <span>{clientInterpolationEnabled ? 'ON (smoothed)' : 'OFF (true server positions)'}</span>
          </div>

          {started ? (
            <GameCanvas
              snapshot={snapshot}
              interpolateEnabled={clientInterpolationEnabled}
              radarActive={hasRadarGadget}
              mapActive={hasMapGadget}
            />
          ) : (
            <p className="waiting">Waiting for host to start...</p>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}
    </div>
  );
}
