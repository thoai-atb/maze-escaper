import { useEffect, useMemo, useRef } from 'react';
import { drawGame } from './drawGame';

const CLIENT_RENDER_CONFIG = {
  interpolationLerpBase: 0.993,
  maxDeltaMs: 48
};

function cloneSnapshot(source) {
  if (!source) return null;
  return {
    ...source,
    exit: source.exit ? { ...source.exit } : null,
    key: source.key ? { ...source.key } : null,
    cells: source.cells.map((c) => ({ ...c })),
    walls: source.walls.map((w) => ({ ...w, p1: { ...w.p1 }, p2: { ...w.p2 } })),
    players: source.players.map((p) => ({ ...p })),
    ghosts: source.ghosts.map((g) => ({ ...g })),
    portals: source.portals.map((p) => ({ ...p })),
    traps: source.traps.map((t) => ({ ...t }))
  };
}

function canInterpolate(prev, next) {
  if (!prev || !next) return false;
  return (
    prev.rows === next.rows
    && prev.cols === next.cols
    && prev.players.length === next.players.length
    && prev.ghosts.length === next.ghosts.length
  );
}

function blendSnapshot(prev, next, dtMs) {
  if (!canInterpolate(prev, next)) return cloneSnapshot(next);

  const ratio = 1 - Math.pow(1 - CLIENT_RENDER_CONFIG.interpolationLerpBase, dtMs / 1000);
  const out = cloneSnapshot(next);

  for (let i = 0; i < out.players.length; i += 1) {
    const current = prev.players[i];
    const target = next.players[i];
    if (!current || !target || target.dead === 2) continue;
    out.players[i].cx = current.cx + (target.cx - current.cx) * ratio;
    out.players[i].cy = current.cy + (target.cy - current.cy) * ratio;
    out.players[i].diameter = current.diameter + (target.diameter - current.diameter) * ratio;
  }

  for (let i = 0; i < out.ghosts.length; i += 1) {
    const current = prev.ghosts[i];
    const target = next.ghosts[i];
    if (!current || !target) continue;
    out.ghosts[i].cx = current.cx + (target.cx - current.cx) * ratio;
    out.ghosts[i].cy = current.cy + (target.cy - current.cy) * ratio;
  }

  return out;
}

export default function GameCanvas({ snapshot, interpolateEnabled, radarActive, mapActive }) {
  const canvasRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const renderSnapshotRef = useRef(null);
  const frameRef = useRef(0);
  const lastFrameMsRef = useRef(0);

  const size = useMemo(() => {
    const viewportW = window.innerWidth;
    const width = Math.max(680, Math.min(1240, viewportW - 48));
    const height = Math.floor(width / 2);
    return { width, height };
  }, []);

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
    if (!interpolateEnabled) {
      renderSnapshotRef.current = snapshot;
      return;
    }

    if (!renderSnapshotRef.current) {
      renderSnapshotRef.current = cloneSnapshot(snapshot);
    }
  }, [interpolateEnabled, snapshot]);

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
      const latest = latestSnapshotRef.current;
      if (latest) {
        if (!interpolateEnabled) {
          renderSnapshotRef.current = latest;
        } else {
          const last = lastFrameMsRef.current || nowMs;
          const dtMs = Math.min(CLIENT_RENDER_CONFIG.maxDeltaMs, nowMs - last);
          renderSnapshotRef.current = blendSnapshot(renderSnapshotRef.current, latest, dtMs);
          lastFrameMsRef.current = nowMs;
        }

        drawGame(ctx, renderSnapshotRef.current, size.width, size.height, {
          radarActive,
          mapActive
        });
      }

      frameRef.current = window.requestAnimationFrame(drawFrame);
    };

    frameRef.current = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [interpolateEnabled, mapActive, radarActive, size.height, size.width]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Maze game board" />;
}
