import { useEffect, useRef, useState } from 'react';
import { drawGame } from './drawGame';
import { MOVEMENT_INTERPOLATION_CONFIG } from '../config';

const PLAYER_SAME_TILE_SPREAD = 0.15;
const PLAYER_FALL_SHRINK_MS = 375;
const GHOST_FALL_SHRINK_MS = 695;

function spawnBurst(particles, x, y, color, count = 12, speed = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.25;
    const dist = 0.08 + Math.random() * 0.16;
    particles.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      vx: Math.cos(angle) * (0.0008 + Math.random() * 0.0012) * speed,
      vy: Math.sin(angle) * (0.0008 + Math.random() * 0.0012) * speed,
      life: 420 + Math.random() * 260,
      maxLife: 680,
      color,
      size: 0.05 + Math.random() * 0.05,
      kind: 'dot'
    });
  }
}

function spawnHeartBurst(particles, x, y) {
  particles.push({
    x,
    y,
    vx: (Math.random() - 0.5) * 0.00015,
    vy: -0.00055,
    life: 900,
    maxLife: 900,
    color: '#ff4d7a',
    size: 0.34,
    kind: 'heart'
  });
}

function updateParticles(particles, dtMs) {
  const dt = Math.max(0, dtMs || 0);
  for (const particle of particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

function addTransitionParticles(prevSnapshot, nextSnapshot, particles) {
  if (!prevSnapshot || !nextSnapshot) return;

  if (prevSnapshot.mysteryBox && !nextSnapshot.mysteryBox) {
    const boxX = Number(prevSnapshot.mysteryBox.x);
    const boxY = Number(prevSnapshot.mysteryBox.y);
    if (Number.isFinite(boxX) && Number.isFinite(boxY)) {
      spawnBurst(particles, boxX, boxY, '#ff5c8d', 18, 1.2);
      spawnBurst(particles, boxX, boxY, '#ffd65c', 12, 1.05);
    }
  }

  const prevOpenSeq = Number(prevSnapshot.mysteryBoxLastOpen?.seq) || 0;
  const nextOpenSeq = Number(nextSnapshot.mysteryBoxLastOpen?.seq) || 0;
  if (nextOpenSeq > prevOpenSeq) {
    const open = nextSnapshot.mysteryBoxLastOpen;
    if (open?.outcome === 'add_life') {
      spawnHeartBurst(particles, Number(open.x) || 0, Number(open.y) || 0);
    } else if (open?.outcome === 'spawn_map_tile') {
      spawnBurst(particles, Number(open.x) || 0, Number(open.y) || 0, '#4dc6ff', 14, 1.05);
    } else if (open?.outcome === 'spawn_radar_tile') {
      spawnBurst(particles, Number(open.x) || 0, Number(open.y) || 0, '#7bff7b', 14, 1.05);
    }
  }

  for (const player of nextSnapshot.players || []) {
    const prevPlayer = prevSnapshot.players?.find((p) => p.id === player.id);
    if (!prevPlayer) continue;

    const teleportedStarted = Boolean(player.teleported) && !Boolean(prevPlayer.teleported);
    if (teleportedStarted) {
      spawnBurst(particles, prevPlayer.x, prevPlayer.y, '#c58dff', 10, 1.15);
      spawnBurst(particles, player.x, player.y, '#c58dff', 12, 1.2);
    }

    const threwSomewhere = player.dead === 1
      && (prevPlayer.fall || prevPlayer.dead === 1)
      && (player.x !== prevPlayer.x || player.y !== prevPlayer.y);
    if (threwSomewhere) {
      spawnBurst(particles, player.x, player.y, player.color || '#d8d8d8', 14, 0.9);
    }

    const revived = prevPlayer.dead === 1 && player.dead === 0;
    if (revived) {
      spawnBurst(particles, prevPlayer.x, prevPlayer.y, player.color || '#d8d8d8', 18, 1);
    }
  }

  for (const ghost of nextSnapshot.ghosts || []) {
    const prevGhost = prevSnapshot.ghosts?.find((g) => g.id === ghost.id);
    if (!prevGhost) continue;

    const teleportedStarted = Boolean(ghost.teleported) && !Boolean(prevGhost.teleported);
    if (teleportedStarted) {
      spawnBurst(particles, prevGhost.x, prevGhost.y, '#c58dff', 10, 1.15);
      spawnBurst(particles, ghost.x, ghost.y, '#c58dff', 12, 1.2);
    }

    const ghostFellIntoTrap = !prevGhost.fall && ghost.fall;
    if (ghostFellIntoTrap) {
      const ghostColor = ghost.crazy ? '#d8d8d8' : '#a5a5a5';
      spawnBurst(particles, ghost.x, ghost.y, ghostColor, 14, 0.8);
    }
  }

  for (const prevGhost of prevSnapshot.ghosts || []) {
    const stillExists = (nextSnapshot.ghosts || []).some((ghost) => ghost.id === prevGhost.id);
    if (!stillExists && prevGhost.fall) {
      const ghostColor = prevGhost.crazy ? '#d8d8d8' : '#a5a5a5';
      spawnBurst(particles, prevGhost.x, prevGhost.y, ghostColor, 12, 0.75);
    }
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function brightFromDistance(distance, maxSightDistance, minBright) {
  const t = clamp(distance / Math.max(1, maxSightDistance), 0, 1);
  return 100 - t * (100 - minBright);
}

function isBlocked(cell, dx, dy) {
  if (dx === 1) return cell.wallR;
  if (dx === -1) return cell.wallL;
  if (dy === 1) return cell.wallB;
  if (dy === -1) return cell.wallT;
  return false;
}

function buildRenderSnapshot(
  dynamicSnapshot,
  mapPayload,
  playerLerpMap,
  ghostLerpMap,
  finishBrightOverride = null,
  animationTimeMs = 0,
  playerFallStartedAtMap = new Map(),
  ghostFallStartedAtMap = new Map(),
  wallClockMs = Date.now()
) {
  if (!dynamicSnapshot || !mapPayload) return null;

  const rows = mapPayload.rows;
  const cols = mapPayload.cols;
  const minBright = Number(dynamicSnapshot.minBright) || 0;
  const maxSightDistance = Number(mapPayload.maxSightDistance) || 6;
  const cells = mapPayload.cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    type: cell.type,
    gadgetDurability: (cell.gadgetDurability != null && Number.isFinite(Number(cell.gadgetDurability)))
      ? Math.max(0, Math.round(Number(cell.gadgetDurability)))
      : null,
    gadgetMaxDurability: (cell.gadgetMaxDurability != null && Number.isFinite(Number(cell.gadgetMaxDurability)))
      ? Math.max(1, Math.round(Number(cell.gadgetMaxDurability)))
      : null,
    inSight: false,
    bright: 0,
    explored: Boolean(cell.explored)
  }));

  const getCell = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return mapPayload.cells[y * cols + x] || null;
  };

  const visiblePlayers = (dynamicSnapshot.players || []).filter(
    (p) => p.socketId && Number(p.dead) === 0 && !p.escaped && !p.relocating
  );

  if (dynamicSnapshot.finish) {
    const finishBright = clamp(
      Number(finishBrightOverride ?? dynamicSnapshot.minBright ?? 100),
      Number(dynamicSnapshot.minBright) || 0,
      100
    );
    for (let i = 0; i < cells.length; i += 1) {
      cells[i].inSight = true;
      cells[i].bright = finishBright;
    }
  } else {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    for (const p of visiblePlayers) {
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;

      const startIdx = sy * cols + sx;
      cells[startIdx].inSight = true;
      cells[startIdx].bright = Math.max(cells[startIdx].bright, 100);

      for (const [dx, dy] of dirs) {
        let cx = sx;
        let cy = sy;
        for (let step = 1; step <= maxSightDistance; step += 1) {
          const fromCell = getCell(cx, cy);
          if (!fromCell || isBlocked(fromCell, dx, dy)) break;
          cx += dx;
          cy += dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) break;

          const idx = cy * cols + cx;
          const bright = brightFromDistance(step, maxSightDistance, minBright);
          cells[idx].inSight = true;
          cells[idx].bright = Math.max(cells[idx].bright, bright);
        }
      }
    }
  }

  const interpolateEntity = (entity, refMap, keyPrefix, lerpFactor) => {
    const key = `${keyPrefix}:${entity.id}`;
    const targetX = Number(entity.x) || 0;
    const targetY = Number(entity.y) || 0;
    const prev = refMap.get(key);
    if (!prev) {
      const initial = { cx: targetX, cy: targetY };
      refMap.set(key, initial);
      return initial;
    }

    const manhattan = Math.abs(targetX - prev.cx) + Math.abs(targetY - prev.cy);
    if (manhattan > 1.5) {
      prev.cx = targetX;
      prev.cy = targetY;
      return prev;
    }

    prev.cx += (targetX - prev.cx) * lerpFactor;
    prev.cy += (targetY - prev.cy) * lerpFactor;
    return prev;
  };

  // Build same-tile spread offsets first, then lerp players toward adjusted targets.
  const playerOffsetById = new Map();
  const groupedPlayers = new Map();
  for (const player of dynamicSnapshot.players || []) {
    if (!player.socketId || player.escaped) continue;
    if (player.relocating) continue; // invisible while awaiting teleport
    if (!(Number(player.dead) === 0 || Number(player.dead) === 1)) continue;
    const groupKey = `${player.x},${player.y}`;
    if (!groupedPlayers.has(groupKey)) groupedPlayers.set(groupKey, []);
    groupedPlayers.get(groupKey).push(player);
  }

  for (const group of groupedPlayers.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.id - b.id);
    for (let i = 0; i < group.length; i += 1) {
      const angle = (Math.PI * 2 * i) / group.length;
      playerOffsetById.set(group[i].id, {
        dx: Math.cos(angle) * PLAYER_SAME_TILE_SPREAD,
        dy: Math.sin(angle) * PLAYER_SAME_TILE_SPREAD
      });
    }
  }

  const players = (dynamicSnapshot.players || []).filter((p) => !p.relocating).map((p) => {
    const offset = playerOffsetById.get(p.id) || { dx: 0, dy: 0 };
    const adjusted = {
      ...p,
      x: p.x + offset.dx,
      y: p.y + offset.dy
    };

    const pos = interpolateEntity(
      adjusted,
      playerLerpMap,
      'player',
      MOVEMENT_INTERPOLATION_CONFIG.playerLerpFactor
    );
    const eventFallStartedAt = Number(p.fallStartedAtMs);
    const fallbackFallStartedAt = playerFallStartedAtMap.get(p.id);
    const fallStartedAt = Number.isFinite(eventFallStartedAt) ? eventFallStartedAt : fallbackFallStartedAt;
    const eventFallDurationMs = Number(p.fallDurationMs);
    const fallDurationMs = (Number.isFinite(eventFallDurationMs) && eventFallDurationMs > 0)
      ? eventFallDurationMs
      : PLAYER_FALL_SHRINK_MS;
    if (p.fall && typeof fallStartedAt === 'number') {
      const t = clamp((wallClockMs - fallStartedAt) / fallDurationMs, 0, 1);
      const localDiameter = 0.5 - (0.5 - 0.05) * t;
      p = {
        ...p,
        diameter: Math.min(Number(p.diameter) || 0.5, localDiameter)
      };
    }

    return {
      ...p,
      cx: pos.cx,
      cy: pos.cy
    };
  });

  const ghosts = (dynamicSnapshot.ghosts || []).map((g) => {
    const eventFallStartedAt = Number(g.fallStartedAtMs);
    const fallbackFallStartedAt = ghostFallStartedAtMap.get(g.id);
    const fallStartedAt = Number.isFinite(eventFallStartedAt) ? eventFallStartedAt : fallbackFallStartedAt;
    const eventFallDurationMs = Number(g.fallDurationMs);
    const fallDurationMs = (Number.isFinite(eventFallDurationMs) && eventFallDurationMs > 0)
      ? eventFallDurationMs
      : GHOST_FALL_SHRINK_MS;

    if (g.fall && typeof fallStartedAt === 'number') {
      const t = clamp((wallClockMs - fallStartedAt) / fallDurationMs, 0, 1);
      const localDiameter = 0.5 - (0.5 - 0.05) * t;
      g = {
        ...g,
        diameter: Math.min(Number(g.diameter) || 0.5, localDiameter)
      };
    }

    const pos = interpolateEntity(
      g,
      ghostLerpMap,
      'ghost',
      MOVEMENT_INTERPOLATION_CONFIG.ghostLerpFactor
    );
    return {
      ...g,
      cx: pos.cx,
      cy: pos.cy
    };
  });

  const walls = mapPayload.walls.map((w) => {
    const aCell = cells[w.a];
    const bCell = cells[w.b];
    const bright = w.enable ? Math.max(aCell?.bright || 0, bCell?.bright || 0) : 0;
    const visible = w.enable && Boolean(aCell?.inSight || bCell?.inSight);
    return {
      p1: w.p1,
      p2: w.p2,
      enable: w.enable,
      bright,
      visible
    };
  });

  let key = dynamicSnapshot.key;
  if (key?.type === 'player') {
    const owner = players.find((p) => p.id === key.playerId);
    if (owner) key = { ...key, x: owner.cx, y: owner.cy };
  }
  if (key?.type === 'ghost') {
    const owner = ghosts.find((g) => g.id === key.ghostId);
    if (owner) key = { ...key, x: owner.cx, y: owner.cy };
  }

  let mysteryBox = dynamicSnapshot.mysteryBox;
  if (mysteryBox?.type === 'player') {
    const owner = players.find((p) => p.id === mysteryBox.playerId);
    if (owner) mysteryBox = { ...mysteryBox, x: owner.cx, y: owner.cy };
  }
  if (mysteryBox?.type === 'ghost') {
    const owner = ghosts.find((g) => g.id === mysteryBox.ghostId);
    if (owner) mysteryBox = { ...mysteryBox, x: owner.cx, y: owner.cy };
  }

  return {
    ...dynamicSnapshot,
    rows,
    cols,
    level: mapPayload.level,
    exit: {
      ...(dynamicSnapshot.exit || {}),
      x: mapPayload.exit?.x ?? dynamicSnapshot.exit?.x,
      y: mapPayload.exit?.y ?? dynamicSnapshot.exit?.y
    },
    key,
    mysteryBox,
    cells,
    walls,
    players,
    ghosts,
    traps: dynamicSnapshot.traps || [],
    particles: dynamicSnapshot.particles || []
  };
}

export default function GameCanvas({
  snapshot,
  mapPayload,
  radarActive,
  hideGhostRadarBlips = false,
  mapActive,
  enterHintText = '',
  fullScreen = false,
  overlayHeight = 0
}) {
  const canvasRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const latestMapRef = useRef(null);
  const frameRef = useRef(0);
  const playerLerpRef = useRef(new Map());
  const ghostLerpRef = useRef(new Map());
  const mapVersionRef = useRef(null);
  const localParticlesRef = useRef([]);
  const prevDynamicRef = useRef(null);
  const lastFrameTimeRef = useRef(0);
  const finishFadeStartRef = useRef(0);
  const playerFallStartedAtRef = useRef(new Map());
  const ghostFallStartedAtRef = useRef(new Map());

  const getCanvasSize = () => {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    if (fullScreen) {
      const availableH = Math.max(220, viewportH - overlayHeight - 8);
      let width = viewportW;
      let height = Math.floor(width / 2);

      if (height > availableH) {
        height = availableH;
        width = Math.floor(height * 2);
      }

      return { width, height };
    }

    const width = Math.max(680, Math.min(1240, viewportW - 48));
    const height = Math.floor(width / 2);
    return { width, height };
  };

  const [size, setSize] = useState(getCanvasSize);

  useEffect(() => {
    const onResize = () => {
      setSize(getCanvasSize());
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [fullScreen, overlayHeight]);

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    latestMapRef.current = mapPayload;
  }, [mapPayload]);

  useEffect(() => {
    const version = mapPayload?.version ?? null;
    if (version === mapVersionRef.current) return;
    mapVersionRef.current = version;
    playerLerpRef.current = new Map();
    ghostLerpRef.current = new Map();
    localParticlesRef.current = [];
    prevDynamicRef.current = null;
    lastFrameTimeRef.current = 0;
    finishFadeStartRef.current = 0;
    playerFallStartedAtRef.current = new Map();
    ghostFallStartedAtRef.current = new Map();
  }, [mapPayload]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const drawFrame = (nowMs) => {
      const latestDynamic = latestSnapshotRef.current;
      const latestMap = latestMapRef.current;
      const wallClockMs = Date.now();

      const prevDynamic = prevDynamicRef.current;
      if (latestDynamic && latestDynamic !== prevDynamic) {
        addTransitionParticles(prevDynamic, latestDynamic, localParticlesRef.current);

        const stillFalling = new Set();
        for (const player of latestDynamic.players || []) {
          if (player.fall) {
            stillFalling.add(player.id);
            if (!playerFallStartedAtRef.current.has(player.id)) {
              playerFallStartedAtRef.current.set(player.id, wallClockMs);
            }
          }
        }
        for (const id of Array.from(playerFallStartedAtRef.current.keys())) {
          if (!stillFalling.has(id)) {
            playerFallStartedAtRef.current.delete(id);
          }
        }

        const stillGhostFalling = new Set();
        for (const ghost of latestDynamic.ghosts || []) {
          if (ghost.fall) {
            stillGhostFalling.add(ghost.id);
            if (!ghostFallStartedAtRef.current.has(ghost.id)) {
              ghostFallStartedAtRef.current.set(ghost.id, wallClockMs);
            }
          }
        }
        for (const id of Array.from(ghostFallStartedAtRef.current.keys())) {
          if (!stillGhostFalling.has(id)) {
            ghostFallStartedAtRef.current.delete(id);
          }
        }

        prevDynamicRef.current = latestDynamic;
      }

      const dtMs = lastFrameTimeRef.current ? nowMs - lastFrameTimeRef.current : 0;
      lastFrameTimeRef.current = nowMs;
      updateParticles(localParticlesRef.current, dtMs);

      let finishBright = null;
      if (latestDynamic?.finish) {
        if (!finishFadeStartRef.current) finishFadeStartRef.current = nowMs;
        const startBright = Number(latestDynamic.minBright) || 0;
        const elapsedMs = Math.max(0, nowMs - finishFadeStartRef.current);
        // Match server fade pace (100 brightness per second) without per-tick network state.
        finishBright = clamp(startBright + elapsedMs * 0.1, startBright, 100);
      } else {
        finishFadeStartRef.current = 0;
      }

      const renderSnapshot = buildRenderSnapshot(
        latestDynamic,
        latestMap,
        playerLerpRef.current,
        ghostLerpRef.current,
        finishBright,
        nowMs,
        playerFallStartedAtRef.current,
        ghostFallStartedAtRef.current,
        wallClockMs
      );

      if (renderSnapshot) {
        renderSnapshot.particles = [
          ...(renderSnapshot.particles || []),
          ...localParticlesRef.current
        ];
        drawGame(ctx, renderSnapshot, size.width, size.height, {
          radarActive,
          hideGhostRadarBlips,
          mapActive,
          enterHintText,
          animationTimeMs: nowMs,
          wallClockMs: Date.now()
        });
      }

      frameRef.current = window.requestAnimationFrame(drawFrame);
    };

    frameRef.current = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [enterHintText, hideGhostRadarBlips, mapActive, radarActive, size.height, size.width]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Maze game board" />;
}
