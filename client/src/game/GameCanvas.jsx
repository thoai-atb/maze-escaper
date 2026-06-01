import { useEffect, useRef, useState } from 'react';
import { drawGame } from './drawGame';
import { MOVEMENT_INTERPOLATION_CONFIG } from '../config';

const PLAYER_SAME_TILE_SPREAD = 0.15;

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

function buildRenderSnapshot(dynamicSnapshot, mapPayload, exploredSet, playerLerpMap, ghostLerpMap) {
  if (!dynamicSnapshot || !mapPayload) return null;

  const rows = mapPayload.rows;
  const cols = mapPayload.cols;
  const minBright = Number(dynamicSnapshot.minBright) || 0;
  const maxSightDistance = Number(mapPayload.maxSightDistance) || 6;
  const cells = mapPayload.cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    type: cell.type,
    inSight: false,
    bright: 0,
    explored: false
  }));

  const getCell = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return mapPayload.cells[y * cols + x] || null;
  };

  const visiblePlayers = (dynamicSnapshot.players || []).filter(
    (p) => p.socketId && p.dead === 0 && !p.escaped
  );

  for (const p of visiblePlayers) {
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
    exploredSet.add(py * cols + px);
  }

  if (dynamicSnapshot.finish) {
    if (visiblePlayers.length === 0) {
      for (let i = 0; i < cells.length; i += 1) {
        cells[i].inSight = true;
        cells[i].bright = minBright;
      }
    } else {
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          let nearest = Infinity;
          for (const p of visiblePlayers) {
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < nearest) nearest = d;
          }
          const idx = y * cols + x;
          cells[idx].inSight = true;
          cells[idx].bright = brightFromDistance(nearest, maxSightDistance, minBright);
        }
      }
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

  for (let i = 0; i < cells.length; i += 1) {
    cells[i].explored = exploredSet.has(i);
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
    if (!(player.dead === 0 || player.dead === 1)) continue;
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

  const players = (dynamicSnapshot.players || []).map((p) => {
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
    return {
      ...p,
      cx: pos.cx,
      cy: pos.cy
    };
  });

  const ghosts = (dynamicSnapshot.ghosts || []).map((g) => {
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
    cells,
    walls,
    players,
    ghosts,
    particles: dynamicSnapshot.particles || []
  };
}

export default function GameCanvas({
  snapshot,
  mapPayload,
  radarActive,
  mapActive,
  fullScreen = false,
  overlayHeight = 0
}) {
  const canvasRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const latestMapRef = useRef(null);
  const frameRef = useRef(0);
  const exploredRef = useRef(new Set());
  const playerLerpRef = useRef(new Map());
  const ghostLerpRef = useRef(new Map());
  const mapVersionRef = useRef(null);

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
    exploredRef.current = new Set();
    playerLerpRef.current = new Map();
    ghostLerpRef.current = new Map();
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
      const renderSnapshot = buildRenderSnapshot(
        latestDynamic,
        latestMap,
        exploredRef.current,
        playerLerpRef.current,
        ghostLerpRef.current
      );

      if (renderSnapshot) {
        drawGame(ctx, renderSnapshot, size.width, size.height, {
          radarActive,
          mapActive,
          animationTimeMs: nowMs
        });
      }

      frameRef.current = window.requestAnimationFrame(drawFrame);
    };

    frameRef.current = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [mapActive, radarActive, size.height, size.width]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Maze game board" />;
}
