import { useEffect, useRef, useState } from 'react';
import { drawGame } from './drawGame';

export default function GameCanvas({
  snapshot,
  radarActive,
  mapActive,
  fullScreen = false,
  overlayHeight = 0
}) {
  const canvasRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const frameRef = useRef(0);

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
        drawGame(ctx, latest, size.width, size.height, {
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
