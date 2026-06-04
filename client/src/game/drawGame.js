import { TILE_COLOR_CONFIG, getTileThemeByLevel } from '../config';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const WALL_TONE = {
  // Matches base p5.js: wall lightness = bright * 0.5 (with 0..50 clamp).
  min: 0, // Darkest allowed wall lightness (%).
  max: 50, // Brightest allowed wall lightness (%).
  scale: 0.5 // Multiplier from cell/wall brightness to wall lightness.
};

function wallTone(brightness) {
  return Math.max(WALL_TONE.min, Math.min(WALL_TONE.max, brightness * WALL_TONE.scale));
}

function wallColor(tone, forceBlack = false) {
  if (forceBlack) return 'hsl(0 0% 0%)';
  return `hsl(0 0% ${tone}%)`;
}

// 3x3 burn grid — parts 0-8 burn left-to-right, top-to-bottom (rank === part index)

function fillCellRect(ctx, cx, cy, unit, color) {
  // Snap to physical pixels and add a tiny bleed to hide fractional seam artifacts.
  const x1 = Math.floor(cx * unit);
  const y1 = Math.floor(cy * unit);
  const x2 = Math.ceil((cx + 1) * unit);
  const y2 = Math.ceil((cy + 1) * unit);
  const bleed = 1;
  ctx.fillStyle = color;
  ctx.fillRect(
    x1 - bleed,
    y1 - bleed,
    Math.max(1, x2 - x1) + bleed * 2,
    Math.max(1, y2 - y1) + bleed * 2
  );
}

function hslColor(h, s, l) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

function burnCountFromDurability(cell) {
  const maxDurability = Math.max(1, Number(cell?.gadgetMaxDurability) || 9);
  const durability = Math.max(0, Math.min(maxDurability, Number(cell?.gadgetDurability) || 0));
  return Math.max(0, Math.min(9, Math.round(maxDurability - durability)));
}

function drawGadgetBurnCell(ctx, cx, cy, unit, baseHsl, cell) {
  const burnedCount = burnCountFromDurability(cell);
  const baseHue = Number(baseHsl.h);
  const baseSat = Number(baseHsl.s);
  const baseLight = Number(baseHsl.l);

  for (let part = 0; part < 9; part += 1) {
    const row = Math.floor(part / 3);
    const col = part % 3;
    const x1 = Math.floor((cx + col / 3) * unit);
    const y1 = Math.floor((cy + row / 3) * unit);
    const x2 = Math.ceil((cx + (col + 1) / 3) * unit);
    const y2 = Math.ceil((cy + (row + 1) / 3) * unit);

    const burned = part < burnedCount;
    const burnOffset = burned ? -18 : 2.4;

    const sat = Math.max(0, Math.min(100, baseSat + (burned ? -16 : 0)));
    const light = Math.max(0, Math.min(100, baseLight + burnOffset));
    ctx.fillStyle = hslColor(baseHue, sat, light);
    ctx.fillRect(x1, y1, Math.max(1, x2 - x1) + 1, Math.max(1, y2 - y1) + 1);
  }
}

function strokeLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawKey(ctx, x, y, unit, scale = 1) {
  const r = (unit / 8) * scale;
  ctx.save();
  ctx.translate(x + unit * 0.5, y + unit * 0.5);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-r, 0);

  ctx.strokeStyle = '#050505';
  ctx.lineWidth = r / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(4 * r, 0);
  ctx.moveTo(2 * r, 0);
  ctx.lineTo(2 * r, r);
  ctx.moveTo(3 * r, 0);
  ctx.lineTo(3 * r, r);
  ctx.stroke();

  ctx.restore();
}

function drawMysteryBox(ctx, x, y, unit, scale = 1) {
  const size = unit * 0.34 * scale;
  const left = x + unit * 0.5 - size / 2;
  const top = y + unit * 0.5 - size / 2;
  const radius = Math.max(1, size * 0.18);

  ctx.save();
  ctx.fillStyle = '#8b4b1f';
  ctx.strokeStyle = '#16110a';
  ctx.lineWidth = Math.max(1, unit * 0.04 * scale);

  roundedRectPath(ctx, left, top, size, size, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffd65c';
  const bandW = Math.max(1.5, size * 0.18);
  roundedRectPath(ctx, left + (size - bandW) / 2, top + size * 0.02, bandW, size * 0.96, Math.max(0.8, radius * 0.4));
  ctx.fill();
  roundedRectPath(ctx, left + size * 0.02, top + size * 0.44, size * 0.96, Math.max(1.5, size * 0.12), Math.max(0.8, radius * 0.35));
  ctx.fill();
  ctx.restore();
}

function cellColor(bright, type, enabled, explored, level, forceVisited = false) {
  const { h, s, l } = cellColorHsl(bright, type, enabled, explored, level, forceVisited);
  return hslColor(h, s, l);
}

function cellColorHsl(bright, type, enabled, explored, level, forceVisited = false, expired = false) {
  const base = Math.max(TILE_COLOR_CONFIG.brightness.min, Math.min(TILE_COLOR_CONFIG.brightness.max, bright));

  const toHsl = (palette) => ({
    h: palette.hue,
    s: palette.saturation,
    l: base * palette.lightnessScale
  });

  if (type === 1 || type === 2) {
    if (expired) return toHsl(TILE_COLOR_CONFIG.gadgetExpired);
  }
  if (type === 1) {
    return enabled ? toHsl(TILE_COLOR_CONFIG.radar.active) : toHsl(TILE_COLOR_CONFIG.radar.inactive);
  }
  if (type === 2) {
    return enabled ? toHsl(TILE_COLOR_CONFIG.map.active) : toHsl(TILE_COLOR_CONFIG.map.inactive);
  }

  const levelTheme = getTileThemeByLevel(level);
  return (explored || forceVisited) ? toHsl(levelTheme.visited) : toHsl(levelTheme.unvisited);
}

function drawCellGlyph(ctx, cell, x, y, unit, stroke, glyphColor = '#111') {
  if (cell.type === 1) {
    const size = unit * 0.62;
    ctx.save();
    ctx.translate(x + unit / 2, y + unit / 2);
    ctx.strokeStyle = glyphColor;
    ctx.lineWidth = stroke / 2;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size / 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (cell.type === 2) {
    const iconSize = unit * 0.56;
    const frameWidth = iconSize;
    const frameHeight = iconSize;
    const frameHalfW = frameWidth / 2;
    const frameHalfH = frameHeight / 2;

    // Keep equal visual breathing room so the grid stays centered in the frame.
    const gridPaddingX = frameWidth * 0.2;
    const gridPaddingY = frameHeight * 0.2;
    const gridHalfW = frameHalfW - gridPaddingX;
    const gridHalfH = frameHalfH - gridPaddingY;

    ctx.save();
    ctx.translate(x + unit / 2, y + unit / 2);

    // Draw a clean frame and grid lines.
    ctx.strokeStyle = glyphColor;
    ctx.lineWidth = stroke / 2;
    ctx.strokeRect(-frameHalfW, -frameHalfH, frameWidth, frameHeight);

    // Draw a centered plus sign.
    ctx.beginPath();
    ctx.moveTo(0, -gridHalfH);
    ctx.lineTo(0, gridHalfH);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-gridHalfW, 0);
    ctx.lineTo(gridHalfW, 0);
    ctx.stroke();

    ctx.restore();
  }
}

function drawWallColumns(ctx, snapshot, unit, stroke) {
  const pointMap = new Map();

  function addPoint(x, y, tone) {
    const key = `${x},${y}`;
    const existing = pointMap.get(key);
    if (!existing || tone > existing.tone) {
      pointMap.set(key, { x, y, tone });
    }
  }

  function getCell(x, y) {
    if (x < 0 || y < 0 || x >= snapshot.cols || y >= snapshot.rows) return null;
    return snapshot.cells[y * snapshot.cols + x];
  }

  function isVisibleCell(cell) {
    if (!cell) return false;
    return snapshot.finish || (cell.inSight && cell.bright > snapshot.minBright);
  }

  // Always draw column caps for visible wall endpoints.
  for (const wall of snapshot.walls) {
    if (!wall.enable || !wall.visible) continue;
    if (!snapshot.finish && wall.bright <= snapshot.minBright) continue;
    const tone = wallTone(wall.bright);
    addPoint(wall.p1.x, wall.p1.y, tone);
    addPoint(wall.p2.x, wall.p2.y, tone);
  }

  for (let y = 0; y <= snapshot.rows; y++) {
    for (let x = 0; x <= snapshot.cols; x++) {
      const adjacent = [
        getCell(x - 1, y - 1),
        getCell(x, y - 1),
        getCell(x - 1, y),
        getCell(x, y)
      ];

      let visibleCount = 0;
      let hiddenCount = 0;
      let maxBright = 0;

      for (const cell of adjacent) {
        if (isVisibleCell(cell)) {
          visibleCount += 1;
          maxBright = Math.max(maxBright, cell.bright ?? 0);
        } else {
          hiddenCount += 1;
        }
      }

      if (visibleCount === 0 || hiddenCount === 0) continue;

      const tone = wallTone(maxBright);
      addPoint(x, y, tone);
    }
  }

  const radius = Math.max(0.8, stroke / 2);
  for (const p of pointMap.values()) {
    ctx.fillStyle = wallColor(p.tone, snapshot.finish);
    ctx.beginPath();
    ctx.arc(p.x * unit, p.y * unit, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMapOverlay(ctx, snapshot, unit, stroke) {
  ctx.save();
  const mapOverlayStroke = snapshot.finish ? 'rgba(0, 0, 0, 1)' : 'rgba(220, 220, 220, 0.7)';
  const mapOverlayLineWidth = Math.max(1, stroke / 3);
  ctx.strokeStyle = mapOverlayStroke;
  ctx.lineWidth = mapOverlayLineWidth;

  for (const wall of snapshot.walls) {
    if (!wall.enable) continue;
    if (wall.visible && wall.bright > snapshot.minBright && !snapshot.finish) continue;
    ctx.beginPath();
    ctx.moveTo(wall.p1.x * unit, wall.p1.y * unit);
    ctx.lineTo(wall.p2.x * unit, wall.p2.y * unit);
    ctx.stroke();
  }

  // Draw outer border on map view; keep only the right-side exit opening clear.
  for (let x = 0; x < snapshot.cols; x++) {
    const topCell = snapshot.cells[x];
    if (!(topCell?.inSight && topCell.bright > snapshot.minBright && !snapshot.finish)) {
      ctx.beginPath();
      ctx.moveTo(x * unit, 0);
      ctx.lineTo((x + 1) * unit, 0);
      ctx.stroke();
    }

    const bottomCell = snapshot.cells[(snapshot.rows - 1) * snapshot.cols + x];
    if (!(bottomCell?.inSight && bottomCell.bright > snapshot.minBright && !snapshot.finish)) {
      ctx.beginPath();
      ctx.moveTo(x * unit, snapshot.rows * unit);
      ctx.lineTo((x + 1) * unit, snapshot.rows * unit);
      ctx.stroke();
    }
  }

  for (let y = 0; y < snapshot.rows; y++) {
    const leftCell = snapshot.cells[y * snapshot.cols];
    if (!(leftCell?.inSight && leftCell.bright > snapshot.minBright && !snapshot.finish)) {
      ctx.beginPath();
      ctx.moveTo(0, y * unit);
      ctx.lineTo(0, (y + 1) * unit);
      ctx.stroke();
    }
  }

  for (let y = 0; y < snapshot.rows; y++) {
    if (snapshot.exit && snapshot.exit.y === y) continue;
    const edgeCell = snapshot.cells[y * snapshot.cols + (snapshot.cols - 1)];
    if (edgeCell?.inSight && edgeCell.bright > snapshot.minBright && !snapshot.finish) continue;
    ctx.beginPath();
    ctx.moveTo(snapshot.cols * unit, y * unit);
    ctx.lineTo(snapshot.cols * unit, (y + 1) * unit);
    ctx.stroke();
  }

  // Reveal radar/map gadget locations on map view using the same glyph shapes in white.
  for (const cell of snapshot.cells) {
    if (cell.type !== 1 && cell.type !== 2) continue;
    const visibleNow = cell.inSight && cell.bright > snapshot.minBright && !snapshot.finish;
    if (visibleNow) continue;
    // Match map overlay line tone/weight for subtle gadget hints.
    drawCellGlyph(ctx, cell, cell.x * unit, cell.y * unit, unit, mapOverlayLineWidth * 2, mapOverlayStroke);
  }

  ctx.restore();
}

function drawRadarOverlay(ctx, snapshot, unit, cols, options = {}) {
  const { hideGhostBlips = false } = options;
  ctx.save();
  const dotRadius = Math.max(2, unit * 0.08);

  if (!hideGhostBlips) {
    for (const ghost of snapshot.ghosts) {
      const gx = Math.round(ghost.cx);
      const gy = Math.round(ghost.cy);
      const cell = snapshot.cells[gy * cols + gx];
      if (cell?.inSight) continue;
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.arc((ghost.cx + 0.5) * unit, (ghost.cy + 0.5) * unit, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const player of snapshot.players) {
    if (!player.socketId) continue;
    if (player.escaped) continue;
    const px = Math.round(player.cx);
    const py = Math.round(player.cy);
    const cell = snapshot.cells[py * cols + px];
    if (cell?.inSight) continue;

    const alpha = player.dead === 1 ? '88' : 'dd';
    ctx.fillStyle = `${player.color}${alpha}`;
    ctx.beginPath();
    ctx.arc((player.cx + 0.5) * unit, (player.cy + 0.5) * unit, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Show black holes (portals) on radar as small purple rings, not filled dots.
  ctx.strokeStyle = '#c58dff';
  ctx.lineWidth = Math.max(1.25, unit * 0.03);
  for (const portal of snapshot.portals || []) {
    const px = Math.round(portal.x);
    const py = Math.round(portal.y);
    const cell = snapshot.cells[py * cols + px];
    if (cell?.inSight) continue;

    const radius = Math.max(dotRadius * 1.25, unit * 0.11);
    ctx.beginPath();
    ctx.arc((portal.x + 0.5) * unit, (portal.y + 0.5) * unit, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (snapshot.key) {
    const keyX = snapshot.key.x;
    const keyY = snapshot.key.y;
    const cell = snapshot.cells[Math.round(keyY) * cols + Math.round(keyX)];
    if (!cell?.inSight) {
      ctx.fillStyle = '#35ff35';
      ctx.beginPath();
      ctx.arc((keyX + 0.5) * unit, (keyY + 0.5) * unit, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (snapshot.mysteryBox) {
    const boxX = snapshot.mysteryBox.x;
    const boxY = snapshot.mysteryBox.y;
    const cell = snapshot.cells[Math.round(boxY) * cols + Math.round(boxX)];
    if (!cell?.inSight) {
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc((boxX + 0.5) * unit, (boxY + 0.5) * unit, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawParticles(ctx, snapshot, unit) {
  if (!snapshot.particles?.length) return;

  ctx.save();
  for (const particle of snapshot.particles) {
    if (!snapshot.finish) {
      const px = Math.round(particle.x);
      const py = Math.round(particle.y);
      const cell = snapshot.cells[py * snapshot.cols + px];
      if (!cell?.inSight) continue;
      if (cell.bright <= snapshot.minBright) continue;
    }

    const lifeRatio = Math.max(0, Math.min(1, particle.life / particle.maxLife));
    const isHeart = particle.kind === 'heart';
    const size = unit * particle.size * (0.65 + (1 - lifeRatio) * 0.18);
    const alpha = isHeart
      ? Math.floor(255)
      : Math.floor(70 + lifeRatio * 185);
    const alphaHex = alpha.toString(16).padStart(2, '0');
    ctx.fillStyle = `${particle.color}${alphaHex}`;

    const cx = (particle.x + 0.5) * unit;
    const cy = (particle.y + 0.5) * unit;
    if (isHeart) {
      const fontSize = Math.max(12, size * 2.8);
      const borderFontSize = fontSize * 1.16;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.font = `700 ${borderFontSize}px "Segoe UI Symbol", "Apple Color Emoji", sans-serif`;
      ctx.fillText('\u2665', cx, cy);
      ctx.fillStyle = `${particle.color}${alphaHex}`;
      ctx.font = `700 ${fontSize}px "Segoe UI Symbol", "Apple Color Emoji", sans-serif`;
      ctx.fillText('\u2665', cx, cy);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRoundStatusIcon(ctx, x, y, size, status) {
  ctx.save();
  ctx.translate(x, y);

  if (status === 'dead') {
    // Skull icon
    ctx.fillStyle = 'rgba(245, 245, 245, 0.95)';
    ctx.beginPath();
    ctx.arc(0, -size * 0.1, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-size * 0.22, size * 0.05, size * 0.44, size * 0.23);

    ctx.fillStyle = 'rgba(18, 18, 18, 0.95)';
    ctx.beginPath();
    ctx.arc(-size * 0.11, -size * 0.12, size * 0.06, 0, Math.PI * 2);
    ctx.arc(size * 0.11, -size * 0.12, size * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -size * 0.01);
    ctx.lineTo(-size * 0.05, size * 0.09);
    ctx.lineTo(size * 0.05, size * 0.09);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(18, 18, 18, 0.95)';
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.moveTo(-size * 0.08, size * 0.06);
    ctx.lineTo(-size * 0.08, size * 0.22);
    ctx.moveTo(0, size * 0.06);
    ctx.lineTo(0, size * 0.22);
    ctx.moveTo(size * 0.08, size * 0.06);
    ctx.lineTo(size * 0.08, size * 0.22);
    ctx.stroke();
  } else if (status === 'survived') {
    // Circle + check icon
    ctx.strokeStyle = 'rgba(120, 255, 120, 0.95)';
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-size * 0.16, size * 0.02);
    ctx.lineTo(-size * 0.03, size * 0.16);
    ctx.lineTo(size * 0.18, -size * 0.12);
    ctx.stroke();
  } else {
    // Fallback alive icon
    ctx.fillStyle = 'rgba(240, 240, 240, 0.92)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawGame(ctx, snapshot, width, height, options = {}) {
  if (!snapshot) return;

  const {
    radarActive = false,
    hideGhostRadarBlips = false,
    mapActive = false,
    enterHintText = '',
    animationTimeMs = 0,
    wallClockMs = Date.now()
  } = options;

  const { rows, cols } = snapshot;
  const unit = height / rows;
  const stroke = unit / 8;

  fillRect(ctx, 0, 0, width, height, '#000');

  for (const cell of snapshot.cells) {
    if (!cell.inSight) continue;
    if (cell.bright <= snapshot.minBright && !snapshot.finish) continue;
    const enabled = cell.type === 1 ? snapshot.enableRadar : snapshot.enableMapView;
    const isGadgetCell = cell.type === 1 || cell.type === 2;
    const isExpired = isGadgetCell
      && Number.isFinite(Number(cell.gadgetDurability))
      && Number(cell.gadgetDurability) <= 0;
    const baseHsl = cellColorHsl(
      cell.bright,
      cell.type,
      enabled,
      cell.explored,
      snapshot.level,
      !snapshot.finish,
      isExpired
    );
    const hasGadgetDurability = isGadgetCell
      && Number.isFinite(Number(cell.gadgetDurability))
      && Number.isFinite(Number(cell.gadgetMaxDurability))
      && Number(cell.gadgetMaxDurability) > 0;

    if (hasGadgetDurability) {
      drawGadgetBurnCell(ctx, cell.x, cell.y, unit, baseHsl, cell);
    } else {
      fillCellRect(ctx, cell.x, cell.y, unit, hslColor(baseHsl.h, baseHsl.s, baseHsl.l));
    }

    const x = cell.x * unit;
    const y = cell.y * unit;
    drawCellGlyph(ctx, cell, x, y, unit, stroke);
  }

  for (const wall of snapshot.walls) {
    if (!wall.enable || !wall.visible) continue;
    if (wall.bright <= snapshot.minBright && !snapshot.finish) continue;
    const tone = wallTone(wall.bright);
    strokeLine(
      ctx,
      wall.p1.x * unit,
      wall.p1.y * unit,
      wall.p2.x * unit,
      wall.p2.y * unit,
      wallColor(tone, snapshot.finish),
      stroke
    );
  }

  // Draw outer border walls; keep only the right-side exit row segment open.
  for (let x = 0; x < cols; x++) {
    const topCell = snapshot.cells[x];
    if (snapshot.finish || (topCell?.inSight && topCell.bright > snapshot.minBright)) {
      const tone = wallTone(topCell?.bright ?? 0);
      strokeLine(
        ctx,
        x * unit,
        0,
        (x + 1) * unit,
        0,
        wallColor(tone, snapshot.finish),
        stroke
      );
    }

    const bottomCell = snapshot.cells[(rows - 1) * cols + x];
    if (snapshot.finish || (bottomCell?.inSight && bottomCell.bright > snapshot.minBright)) {
      const tone = wallTone(bottomCell?.bright ?? 0);
      strokeLine(
        ctx,
        x * unit,
        rows * unit,
        (x + 1) * unit,
        rows * unit,
        wallColor(tone, snapshot.finish),
        stroke
      );
    }
  }

  for (let y = 0; y < rows; y++) {
    const leftCell = snapshot.cells[y * cols];
    if (snapshot.finish || (leftCell?.inSight && leftCell.bright > snapshot.minBright)) {
      const tone = wallTone(leftCell?.bright ?? 0);
      strokeLine(
        ctx,
        0,
        y * unit,
        0,
        (y + 1) * unit,
        wallColor(tone, snapshot.finish),
        stroke
      );
    }
  }

  for (let y = 0; y < rows; y++) {
    if (snapshot.exit && snapshot.exit.y === y) continue;
    const edgeCell = snapshot.cells[y * cols + (cols - 1)];
    if (!snapshot.finish) {
      if (!edgeCell?.inSight) continue;
      if (edgeCell.bright <= snapshot.minBright) continue;
    }
    const tone = wallTone(edgeCell?.bright ?? 0);
    strokeLine(
      ctx,
      cols * unit,
      y * unit,
      cols * unit,
      (y + 1) * unit,
      wallColor(tone, snapshot.finish),
      stroke
    );
  }

  drawWallColumns(ctx, snapshot, unit, stroke);

  if (mapActive) {
    drawMapOverlay(ctx, snapshot, unit, stroke);
  }

  for (const portal of snapshot.portals) {
    const cell = snapshot.cells[portal.y * cols + portal.x];
    if (!cell?.inSight) continue;
    const cx = (portal.x + 0.5) * unit;
    const cy = (portal.y + 0.5) * unit;
    const charging = !portal.active;
    const spinRate = charging ? 0.0042 : 0.0021;
    const spin = (animationTimeMs * spinRate + portal.x * 0.17 + portal.y * 0.11) % (Math.PI * 2);
    const outerSpin = (animationTimeMs * spinRate * 3 + portal.x * 0.17 + portal.y * 0.11) % (Math.PI * 2);
    const bodyScale = charging ? 0 : 1;
    const glowRadius = unit * (charging ? 0.22 : 0.42 + 0.06 * portal.pulse);

    ctx.save();
    ctx.translate(cx, cy);
    const glow = ctx.createRadialGradient(0, 0, unit * 0.04, 0, 0, glowRadius);
    glow.addColorStop(0, 'rgba(174, 96, 255, 0.22)');
    glow.addColorStop(0.55, charging ? 'rgba(174, 96, 255, 0.06)' : 'rgba(174, 96, 255, 0.12)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(196, 126, 255, 0.82)';
    ctx.lineWidth = stroke / 2;
    ctx.lineCap = 'round';
    ctx.fillStyle = '#000';
    const bodyRadius = unit * 0.27 * portal.pulse * bodyScale;
    if (bodyRadius > 0.001) {
      ctx.beginPath();
      ctx.arc(0, 0, bodyRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    const arcSpecs = [
      { radius: unit * 0.22, start: 0.00, end: 0.42, s: spin },
      { radius: unit * 0.25, start: 0.78, end: 1.18, s: spin },
      { radius: unit * 0.28, start: 1.55, end: 1.95, s: spin },
      { radius: unit * 0.31, start: 2.36, end: 2.78, s: spin },
      { radius: unit * 0.32, start: 3.14, end: 3.56, s: outerSpin }
    ];

    for (const arc of arcSpecs) {
      ctx.beginPath();
      ctx.lineWidth = charging ? stroke / 4 : (stroke * 3) / 8;
      const arcRadius = charging ? arc.radius * 1.08 : arc.radius;
      ctx.arc(0, 0, arcRadius, arc.s + Math.PI * arc.start, arc.s + Math.PI * arc.end);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const trap of snapshot.traps) {
    const trapCell = snapshot.cells[Math.round(trap.y) * cols + Math.round(trap.x)];
    if (!snapshot.finish) {
      if (!trapCell?.inSight) continue;
      if (trapCell.bright <= snapshot.minBright) continue;
    }

    const outer = Math.max(0, Number(trap.outer) || 0.7);
    let inner = Math.max(0, Number(trap.inner) || 0);

    if (typeof trap.animStartedAtMs === 'number' && typeof trap.animDurationMs === 'number') {
      const fromInner = Math.max(0, Number(trap.animFromInner) || inner);
      const toInner = Math.max(0, Number(trap.animToInner) || 0);
      const duration = Math.max(1, Number(trap.animDurationMs) || 1);
      const t = clamp((wallClockMs - trap.animStartedAtMs) / duration, 0, 1);
      inner = fromInner + (toInner - fromInner) * t;

      if (trap.animPhase === 'closing' && t >= 1) {
        continue;
      }
    }

    const cx = (trap.x + 0.5) * unit;
    const cy = (trap.y + 0.5) * unit;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = stroke / 3;
    ctx.strokeRect(cx - (outer * unit) / 2, cy - (outer * unit) / 2, outer * unit, outer * unit);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - (inner * unit) / 2, cy - (outer * unit) / 2, inner * unit, outer * unit);
  }

  if (snapshot.exit) {
    const ex = snapshot.exit.x * unit;
    const ey = snapshot.exit.y * unit;
    const exitCell = snapshot.cells[snapshot.exit.y * cols + snapshot.exit.x];
    if (exitCell?.inSight) {
      ctx.save();
      ctx.translate(ex + unit / 2, ey + unit / 2);
      if (snapshot.exit.locked) {
        ctx.strokeStyle = 'rgba(6, 6, 6, 0.95)';
        ctx.fillStyle = 'rgba(255, 210, 54, 0.98)';
        ctx.lineWidth = Math.max(1, stroke / 2);
        const size = unit * 0.42;

        const bodyTop = -size * 0.02;
        const bodyHeight = size * 0.62;
        ctx.fillRect(-size / 2, bodyTop, size, bodyHeight);
        ctx.lineWidth = Math.max(1, stroke / 3);
        ctx.strokeRect(-size / 2, bodyTop, size, bodyHeight);

        const shackleRadius = size * 0.32;
        const shackleCenterY = bodyTop - size * 0.2;
        const shackleBottomY = bodyTop + size * 0.03;
        ctx.beginPath();
        ctx.arc(0, shackleCenterY, shackleRadius, Math.PI, 0);
        ctx.moveTo(-shackleRadius, shackleCenterY);
        ctx.lineTo(-shackleRadius, shackleBottomY);
        ctx.moveTo(shackleRadius, shackleCenterY);
        ctx.lineTo(shackleRadius, shackleBottomY);
        ctx.stroke();

        // Keyhole
        ctx.fillStyle = 'rgba(8, 8, 8, 0.92)';
        const holeY = bodyTop + bodyHeight * 0.44;
        ctx.beginPath();
        ctx.arc(0, holeY, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-size * 0.03, holeY, size * 0.06, size * 0.16);
      } else {
        ctx.strokeStyle = 'rgba(6, 6, 6, 0.95)';
        ctx.lineWidth = Math.max(1, stroke / 2);
        ctx.lineJoin = 'round';
        ctx.fillStyle = 'rgba(70, 255, 70, 0.75)';
        ctx.beginPath();
        ctx.moveTo(unit * 0.25, 0);
        ctx.lineTo(-unit * 0.2, -unit * 0.22);
        ctx.lineTo(-unit * 0.2, unit * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  if (snapshot.key?.type === 'cell') {
    drawKey(ctx, snapshot.key.x * unit, snapshot.key.y * unit, unit, 1);
  }

  if (snapshot.mysteryBox?.type === 'cell') {
    const boxCell = snapshot.cells[Math.round(snapshot.mysteryBox.y) * cols + Math.round(snapshot.mysteryBox.x)];
    const boxVisible = snapshot.finish || (boxCell?.inSight && boxCell.bright > snapshot.minBright);
    if (boxVisible) {
      drawMysteryBox(ctx, snapshot.mysteryBox.x * unit, snapshot.mysteryBox.y * unit, unit, 1);
    }
  }

  for (const player of snapshot.players) {
    if (!player.socketId) continue;

    const playerCell = snapshot.cells[Math.round(player.cy) * cols + Math.round(player.cx)];
    if (player.dead === 2) continue;
    if (player.dead === 1 && !playerCell?.inSight) continue;

    const alpha = player.dead === 1 ? '88' : 'f2';
    ctx.fillStyle = `${player.color}${alpha}`;
    ctx.strokeStyle = player.dead === 1 ? 'rgba(0, 0, 0, 0.32)' : 'rgba(0, 0, 0, 0.88)';
    ctx.lineWidth = stroke / 2;
    ctx.beginPath();
    ctx.arc((player.cx + 0.5) * unit, (player.cy + 0.5) * unit, unit * 0.24 * player.diameter * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (player.hasKey) {
      drawKey(ctx, player.cx * unit, player.cy * unit, unit, 0.45);
    }
    const playerCarriesMysteryBox = Boolean(player.hasMysteryBox)
      || (snapshot.mysteryBox?.type === 'player' && snapshot.mysteryBox.playerId === player.id);
    if (playerCarriesMysteryBox) {
      drawMysteryBox(ctx, player.cx * unit, player.cy * unit, unit, 0.6);
    }
  }

  for (const ghost of snapshot.ghosts) {
    const cell = snapshot.cells[Math.round(ghost.cy) * cols + Math.round(ghost.cx)];
    if (!cell?.inSight) continue;
    const ghostDiameter = ghost.diameter ?? 0.5;
    const isFalling = Boolean(ghost.fall);
    const fallProgress = isFalling ? Math.max(0, Math.min(1, 1 - ghostDiameter / 0.5)) : 0;
    const alpha = isFalling ? Math.max(0.2, Math.min(0.9, ghostDiameter * 1.6)) : 1;
    ctx.fillStyle = ghost.type === 'crazy'
      ? `rgba(255, 255, 255, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`;

    const cx = (ghost.cx + 0.5) * unit;
    const cy = (ghost.cy + 0.5) * unit + fallProgress * unit * 0.1;
    const radius = unit * 0.22 * ghostDiameter * 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (isFalling) {
      ctx.scale(1 + fallProgress * 0.28, 1 - fallProgress * 0.42);
    }
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (ghost.hasKey) {
      drawKey(ctx, ghost.cx * unit, ghost.cy * unit, unit, 0.45);
    }
    const ghostCarriesMysteryBox = Boolean(ghost.hasMysteryBox)
      || (snapshot.mysteryBox?.type === 'ghost' && snapshot.mysteryBox.ghostId === ghost.id);
    if (ghostCarriesMysteryBox) {
      drawMysteryBox(ctx, ghost.cx * unit, ghost.cy * unit, unit, 0.6);
    }
  }
  
  drawParticles(ctx, snapshot, unit);

  if (radarActive) {
    drawRadarOverlay(ctx, snapshot, unit, cols, { hideGhostBlips: hideGhostRadarBlips });
  }

  if (snapshot.finish) {
    ctx.fillStyle = 'rgba(4, 4, 4, 0.16)';
    ctx.fillRect(0, 0, width, height);
  }
}
