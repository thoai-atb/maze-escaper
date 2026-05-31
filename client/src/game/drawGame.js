function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

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

function cellColor(bright, type, enabled) {
  const base = Math.max(8, Math.min(95, bright));
  if (type === 1) {
    return enabled ? `hsl(162 75% ${base * 0.38}%)` : `hsl(202 62% ${base * 0.34}%)`;
  }
  if (type === 2) {
    return enabled ? `hsl(187 80% ${base * 0.4}%)` : `hsl(212 48% ${base * 0.35}%)`;
  }
  return `hsl(33 100% ${base * 0.4}%)`;
}

function drawCellGlyph(ctx, cell, x, y, unit, stroke) {
  if (cell.type === 1) {
    const size = unit * 0.62;
    ctx.save();
    ctx.translate(x + unit / 2, y + unit / 2);
    ctx.strokeStyle = '#111';
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
    const size = unit * 0.56;
    ctx.save();
    ctx.translate(x + unit / 2, y + unit / 2);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = stroke / 2;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    for (let i = -3; i <= 3; i += 2) {
      ctx.beginPath();
      ctx.moveTo(-size / 3, (i * size) / 10);
      ctx.lineTo(size / 3, (i * size) / 10);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawWallColumns(ctx, walls, unit, stroke) {
  const pointMap = new Map();
  for (const wall of walls) {
    const tone = Math.max(15, Math.min(90, wall.bright * 0.6));
    const keys = [
      `${wall.p1.x},${wall.p1.y}`,
      `${wall.p2.x},${wall.p2.y}`
    ];
    for (const key of keys) {
      const existing = pointMap.get(key);
      if (!existing || tone > existing.tone) {
        const [x, y] = key.split(',').map(Number);
        pointMap.set(key, { x, y, tone });
      }
    }
  }

  const radius = Math.max(0.8, stroke / 2);
  for (const p of pointMap.values()) {
    ctx.fillStyle = `hsl(0 0% ${p.tone}%)`;
    ctx.beginPath();
    ctx.arc(p.x * unit, p.y * unit, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMapOverlay(ctx, snapshot, unit, stroke) {
  ctx.save();
  ctx.strokeStyle = 'rgba(210, 210, 210, 0.55)';
  ctx.lineWidth = Math.max(1, stroke / 3);

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

  ctx.restore();
}

function drawRadarOverlay(ctx, snapshot, unit, cols) {
  ctx.save();
  const dotRadius = Math.max(2, unit * 0.08);

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

  ctx.restore();
}

function drawParticles(ctx, snapshot, unit) {
  if (!snapshot.particles?.length) return;

  ctx.save();
  for (const particle of snapshot.particles) {
    const lifeRatio = Math.max(0, Math.min(1, particle.life / particle.maxLife));
    const size = unit * particle.size * (0.55 + (1 - lifeRatio) * 0.4);
    ctx.fillStyle = `${particle.color}${Math.floor(70 + lifeRatio * 185)
      .toString(16)
      .padStart(2, '0')}`;
    ctx.beginPath();
    ctx.arc((particle.x + 0.5) * unit, (particle.y + 0.5) * unit, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawGame(ctx, snapshot, width, height, options = {}) {
  if (!snapshot) return;

  const { radarActive = false, mapActive = false, animationTimeMs = 0 } = options;

  const { rows, cols } = snapshot;
  const unit = height / rows;
  const stroke = unit / 8;

  fillRect(ctx, 0, 0, width, height, '#000');

  for (const cell of snapshot.cells) {
    if (!cell.inSight) continue;
    if (cell.bright <= snapshot.minBright && !snapshot.finish) continue;
    fillCellRect(ctx, cell.x, cell.y, unit, cellColor(cell.bright, cell.type, cell.type === 1 ? snapshot.enableRadar : snapshot.enableMapView));
    const x = cell.x * unit;
    const y = cell.y * unit;
    drawCellGlyph(ctx, cell, x, y, unit, stroke);
  }

  for (const wall of snapshot.walls) {
    if (!wall.enable || !wall.visible) continue;
    if (wall.bright <= snapshot.minBright && !snapshot.finish) continue;
    const tone = Math.max(15, Math.min(90, wall.bright * 0.6));
    strokeLine(
      ctx,
      wall.p1.x * unit,
      wall.p1.y * unit,
      wall.p2.x * unit,
      wall.p2.y * unit,
      `hsl(0 0% ${tone}%)`,
      stroke
    );
  }

  // Draw outer border walls; keep only the right-side exit row segment open.
  for (let x = 0; x < cols; x++) {
    const topCell = snapshot.cells[x];
    if (snapshot.finish || (topCell?.inSight && topCell.bright > snapshot.minBright)) {
      const tone = Math.max(15, Math.min(90, (topCell?.bright ?? 0) * 0.6));
      strokeLine(
        ctx,
        x * unit,
        0,
        (x + 1) * unit,
        0,
        `hsl(0 0% ${tone}%)`,
        stroke
      );
    }

    const bottomCell = snapshot.cells[(rows - 1) * cols + x];
    if (snapshot.finish || (bottomCell?.inSight && bottomCell.bright > snapshot.minBright)) {
      const tone = Math.max(15, Math.min(90, (bottomCell?.bright ?? 0) * 0.6));
      strokeLine(
        ctx,
        x * unit,
        rows * unit,
        (x + 1) * unit,
        rows * unit,
        `hsl(0 0% ${tone}%)`,
        stroke
      );
    }
  }

  for (let y = 0; y < rows; y++) {
    const leftCell = snapshot.cells[y * cols];
    if (snapshot.finish || (leftCell?.inSight && leftCell.bright > snapshot.minBright)) {
      const tone = Math.max(15, Math.min(90, (leftCell?.bright ?? 0) * 0.6));
      strokeLine(
        ctx,
        0,
        y * unit,
        0,
        (y + 1) * unit,
        `hsl(0 0% ${tone}%)`,
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
    const tone = Math.max(15, Math.min(90, (edgeCell?.bright ?? 0) * 0.6));
    strokeLine(
      ctx,
      cols * unit,
      y * unit,
      cols * unit,
      (y + 1) * unit,
      `hsl(0 0% ${tone}%)`,
      stroke
    );
  }

  const visibleWalls = snapshot.walls.filter(
    (w) => w.enable && w.visible && (snapshot.finish || w.bright > snapshot.minBright)
  );
  drawWallColumns(ctx, visibleWalls, unit, stroke);

  if (mapActive) {
    drawMapOverlay(ctx, snapshot, unit, stroke);
  }

  for (const portal of snapshot.portals) {
    const cell = snapshot.cells[portal.y * cols + portal.x];
    if (!cell?.inSight) continue;
    const cx = (portal.x + 0.5) * unit;
    const cy = (portal.y + 0.5) * unit;
    const spin = (animationTimeMs * 0.0021 + portal.x * 0.17 + portal.y * 0.11) % (Math.PI * 2);
    const charging = !portal.active;
    const bodyScale = charging ? 0 : 1;
    const glowRadius = unit * (charging ? 0.22 : 0.42 + 0.06 * portal.pulse);

    ctx.save();
    ctx.translate(cx, cy);
    const glow = ctx.createRadialGradient(0, 0, unit * 0.04, 0, 0, glowRadius);
    glow.addColorStop(0, 'rgba(0, 222, 255, 0.22)');
    glow.addColorStop(0.55, charging ? 'rgba(0, 222, 255, 0.06)' : 'rgba(0, 222, 255, 0.12)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(0, 222, 255, 0.82)';
    ctx.lineWidth = stroke / 2;
    ctx.lineCap = 'round';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    const bodyRadius = unit * 0.27 * portal.pulse * bodyScale;
    ctx.arc(0, 0, bodyRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const arcSpecs = [
      { radius: unit * 0.30, start: 0.00, end: 0.42 },
      { radius: unit * 0.34, start: 0.78, end: 1.18 },
      { radius: unit * 0.38, start: 1.55, end: 1.95 },
      { radius: unit * 0.42, start: 2.36, end: 2.78 },
      { radius: unit * 0.46, start: 3.14, end: 3.56 }
    ];

    for (const arc of arcSpecs) {
      ctx.beginPath();
      ctx.lineWidth = charging ? stroke / 6 : stroke / 4;
      ctx.arc(0, 0, arc.radius, spin + Math.PI * arc.start, spin + Math.PI * arc.end);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const trap of snapshot.traps) {
    const cx = (trap.x + 0.5) * unit;
    const cy = (trap.y + 0.5) * unit;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = stroke / 3;
    ctx.strokeRect(cx - (trap.outer * unit) / 2, cy - (trap.outer * unit) / 2, trap.outer * unit, trap.outer * unit);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - (trap.inner * unit) / 2, cy - (trap.outer * unit) / 2, trap.inner * unit, trap.outer * unit);
  }

  if (snapshot.key?.type === 'cell') {
    drawKey(ctx, snapshot.key.x * unit, snapshot.key.y * unit, unit, 1);
  }

  for (const ghost of snapshot.ghosts) {
    const cell = snapshot.cells[Math.round(ghost.cy) * cols + Math.round(ghost.cx)];
    if (!cell?.inSight) continue;
    ctx.fillStyle = ghost.crazy ? '#d8d8d8' : '#a5a5a5';
    ctx.beginPath();
    ctx.arc((ghost.cx + 0.5) * unit, (ghost.cy + 0.5) * unit, unit * 0.22, 0, Math.PI * 2);
    ctx.fill();
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
        ctx.fillStyle = 'rgba(66, 48, 18, 0.98)';
        ctx.lineWidth = Math.max(1, stroke / 2);
        const size = unit * 0.42;

        const bodyTop = -size * 0.02;
        const bodyHeight = size * 0.62;
        ctx.fillRect(-size / 2, bodyTop, size, bodyHeight);

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
        ctx.fillStyle = 'rgba(70, 255, 70, 0.75)';
        ctx.beginPath();
        ctx.moveTo(unit * 0.25, 0);
        ctx.lineTo(-unit * 0.2, -unit * 0.22);
        ctx.lineTo(-unit * 0.2, unit * 0.22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles(ctx, snapshot, unit);

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
  }

  if (radarActive) {
    drawRadarOverlay(ctx, snapshot, unit, cols);
  }

  if (snapshot.finish) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `${Math.max(32, width * 0.06)}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Round Over', width / 2, height / 2);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(16, width * 0.018)}px Space Grotesk, sans-serif`;
    ctx.fillText('Press R to restart or L to lobby', width / 2, height / 2 + Math.max(42, width * 0.055));
  }
}
