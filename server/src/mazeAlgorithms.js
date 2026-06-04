const ALGORITHMS = {
  prim: {
    id: 'prim',
    label: 'Randomized Prim'
  },
  dfs: {
    id: 'dfs',
    label: 'DFS + Braiding'
  },
  backbite: {
    id: 'backbite',
    label: 'Backbite'
  },
  subdivspiral: {
    id: 'subdivspiral',
    label: 'Subdivided Spirals'
  },
  growingtree: {
    id: 'growingtree',
    label: 'Growing Tree'
  }
};

export const MAZE_ALGORITHM_OPTIONS = Object.values(ALGORITHMS);
export const DEFAULT_MAZE_ALGORITHM = ALGORITHMS.prim.id;

function randInt(minInclusive, maxExclusive) {
  return Math.floor(Math.random() * (maxExclusive - minInclusive)) + minInclusive;
}

function pickRandom(arr) {
  return arr[randInt(0, arr.length)];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function addCellWalls(cell, list) {
  const maybeAdd = (wall) => {
    if (wall && wall.enable) list.push(wall);
  };

  maybeAdd(cell.wallT);
  maybeAdd(cell.wallB);
  maybeAdd(cell.wallL);
  maybeAdd(cell.wallR);
}

function cellIndex(x, y, cols) {
  return y * cols + x;
}

function getNeighbors(cell, getCell) {
  const neighbors = [];
  const top = getCell(cell.x, cell.y - 1);
  const right = getCell(cell.x + 1, cell.y);
  const bottom = getCell(cell.x, cell.y + 1);
  const left = getCell(cell.x - 1, cell.y);

  if (top) neighbors.push(top);
  if (right) neighbors.push(right);
  if (bottom) neighbors.push(bottom);
  if (left) neighbors.push(left);

  return neighbors;
}

function wallBetween(a, b, cols) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return a.wallR;
  if (dx === -1 && dy === 0) return a.wallL;
  if (dx === 0 && dy === 1) return a.wallB;
  if (dx === 0 && dy === -1) return a.wallT;

  const idA = cellIndex(a.x, a.y, cols);
  const idB = cellIndex(b.x, b.y, cols);
  const aWalls = [a.wallT, a.wallB, a.wallL, a.wallR].filter(Boolean);
  for (const wall of aWalls) {
    if ((wall.a === idA && wall.b === idB) || (wall.a === idB && wall.b === idA)) return wall;
  }
  return null;
}

function carveBetween(a, b, cols) {
  const wall = wallBetween(a, b, cols);
  if (wall) wall.enable = false;
}

function regionCells(x, y, w, h, getCell) {
  const list = [];
  for (let ry = y; ry < y + h; ry += 1) {
    for (let rx = x; rx < x + w; rx += 1) {
      const cell = getCell(rx, ry);
      if (cell) list.push(cell);
    }
  }
  return list;
}

function carvePathByCoordinates(coords, getCell, cols) {
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = getCell(coords[i].x, coords[i].y);
    const b = getCell(coords[i + 1].x, coords[i + 1].y);
    if (!a || !b) continue;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
    carveBetween(a, b, cols);
    a.visited = true;
    b.visited = true;
  }
}

function buildSerpentineHamiltonianPath(cols, rows) {
  const path = [];
  for (let y = 0; y < rows; y += 1) {
    if (y % 2 === 0) {
      for (let x = 0; x < cols; x += 1) path.push({ x, y });
    } else {
      for (let x = cols - 1; x >= 0; x -= 1) path.push({ x, y });
    }
  }
  return path;
}

function randomizeHamiltonianPath(path, cols, getCell, steps) {
  const indexById = new Map();
  const refreshIndex = () => {
    indexById.clear();
    for (let i = 0; i < path.length; i += 1) {
      indexById.set(cellIndex(path[i].x, path[i].y, cols), i);
    }
  };

  refreshIndex();

  for (let step = 0; step < steps; step += 1) {
    const useHead = Math.random() < 0.5;
    const endpointIdx = useHead ? 0 : path.length - 1;
    const endpoint = path[endpointIdx];
    const endpointCell = getCell(endpoint.x, endpoint.y);
    if (!endpointCell) continue;

    const neighboringPathIndices = getNeighbors(endpointCell, getCell)
      .map((n) => indexById.get(cellIndex(n.x, n.y, cols)))
      .filter((idx) => idx != null);

    let candidates;
    if (useHead) {
      candidates = neighboringPathIndices.filter((idx) => idx > 1);
    } else {
      candidates = neighboringPathIndices.filter((idx) => idx < path.length - 2);
    }

    if (candidates.length === 0) continue;
    const pivot = pickRandom(candidates);

    if (useHead) {
      const headToPivotPrev = path.slice(0, pivot).reverse();
      const pivotToEnd = path.slice(pivot);
      path.splice(0, path.length, ...headToPivotPrev, ...pivotToEnd);
    } else {
      const startToPivot = path.slice(0, pivot + 1);
      const pivotNextToTail = path.slice(pivot + 1).reverse();
      path.splice(0, path.length, ...startToPivot, ...pivotNextToTail);
    }

    refreshIndex();
  }
}

function resetMazeState(cells, walls) {
  for (const cell of cells) {
    cell.visited = false;
  }

  for (const wall of walls) {
    wall.enable = true;
  }
}

function generatePrim(cells) {
  const start = pickRandom(cells);
  start.visited = true;

  const wallList = [];
  addCellWalls(start, wallList);

  while (wallList.length > 0) {
    const idx = randInt(0, wallList.length);
    const wall = wallList[idx];
    const cellA = cells[wall.a];
    const cellB = cells[wall.b];
    const exactlyOneVisited = (cellA.visited && !cellB.visited) || (!cellA.visited && cellB.visited);

    if (exactlyOneVisited) {
      wall.enable = false;
      const newCell = cellA.visited ? cellB : cellA;
      newCell.visited = true;
      addCellWalls(newCell, wallList);
    }

    wallList.splice(idx, 1);
  }
}

function generateDfsBacktracker(cells, cols, getCell) {
  const start = pickRandom(cells);
  start.visited = true;

  const stack = [start];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = [];

    const top = getCell(current.x, current.y - 1);
    const right = getCell(current.x + 1, current.y);
    const bottom = getCell(current.x, current.y + 1);
    const left = getCell(current.x - 1, current.y);

    if (top && !top.visited) neighbors.push({ cell: top, wall: current.wallT });
    if (right && !right.visited) neighbors.push({ cell: right, wall: current.wallR });
    if (bottom && !bottom.visited) neighbors.push({ cell: bottom, wall: current.wallB });
    if (left && !left.visited) neighbors.push({ cell: left, wall: current.wallL });

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const choice = pickRandom(neighbors);
    if (choice.wall) choice.wall.enable = false;
    choice.cell.visited = true;
    stack.push(cells[choice.cell.y * cols + choice.cell.x]);
  }

  // Light braiding pass keeps DFS style while reducing a small portion of dead ends.
  braidDeadEnds(cells, cols, getCell, 0.06);
}

// Braiding: for each dead-end cell (only one open passage), remove one additional
// wall to a neighbour with some probability, creating a loop and reducing dead ends.
function braidDeadEnds(cells, cols, getCell, probability) {
  for (const cell of cells) {
    // Count open passages (disabled walls = carved passages).
    const dirs = [
      { neighbor: getCell(cell.x, cell.y - 1), wall: cell.wallT },
      { neighbor: getCell(cell.x + 1, cell.y), wall: cell.wallR },
      { neighbor: getCell(cell.x, cell.y + 1), wall: cell.wallB },
      { neighbor: getCell(cell.x - 1, cell.y), wall: cell.wallL }
    ];
    const openCount = dirs.filter((d) => d.wall && !d.wall.enable).length;
    if (openCount !== 1) continue; // only braid true dead ends
    if (Math.random() >= probability) continue;

    // Pick a random still-walled neighbour to carve into.
    const candidates = dirs.filter((d) => d.neighbor && d.wall && d.wall.enable);
    if (candidates.length === 0) continue;
    const choice = pickRandom(candidates);
    choice.wall.enable = false;
  }
}

function generateBackbite(cells, cols, getCell) {
  const rows = Math.floor(cells.length / cols);
  const path = buildSerpentineHamiltonianPath(cols, rows);

  // Backbite shuffling keeps a Hamiltonian path while making it look random.
  randomizeHamiltonianPath(path, cols, getCell, path.length * 12);

  carvePathByCoordinates(path, getCell, cols);

  // Light braiding pass: randomly open a small fraction of dead ends to add loops.
  braidDeadEnds(cells, cols, getCell, 1);
}

function spiralPathForRegion(x, y, w, h, clockwise = true) {
  const path = [];
  let left = x;
  let right = x + w - 1;
  let top = y;
  let bottom = y + h - 1;

  while (left <= right && top <= bottom) {
    if (clockwise) {
      for (let cx = left; cx <= right; cx += 1) path.push({ x: cx, y: top });
      top += 1;
      for (let cy = top; cy <= bottom; cy += 1) path.push({ x: right, y: cy });
      right -= 1;
      if (top <= bottom) {
        for (let cx = right; cx >= left; cx -= 1) path.push({ x: cx, y: bottom });
        bottom -= 1;
      }
      if (left <= right) {
        for (let cy = bottom; cy >= top; cy -= 1) path.push({ x: left, y: cy });
        left += 1;
      }
    } else {
      for (let cy = top; cy <= bottom; cy += 1) path.push({ x: left, y: cy });
      left += 1;
      for (let cx = left; cx <= right; cx += 1) path.push({ x: cx, y: bottom });
      bottom -= 1;
      if (left <= right) {
        for (let cy = bottom; cy >= top; cy -= 1) path.push({ x: right, y: cy });
        right -= 1;
      }
      if (top <= bottom) {
        for (let cx = right; cx >= left; cx -= 1) path.push({ x: cx, y: top });
        top += 1;
      }
    }
  }

  return path;
}

function splitRegion(x, y, w, h, out) {
  const MIN_SIZE = 3;
  const canSplitVertical = w > MIN_SIZE * 2;
  const canSplitHorizontal = h > MIN_SIZE * 2;

  if (!canSplitVertical && !canSplitHorizontal) {
    out.push({ x, y, w, h });
    return;
  }

  const splitVertical = canSplitVertical && (!canSplitHorizontal || w >= h);
  if (splitVertical) {
    const cut = randInt(x + MIN_SIZE, x + w - MIN_SIZE);
    splitRegion(x, y, cut - x, h, out);
    splitRegion(cut, y, x + w - cut, h, out);
  } else {
    const cut = randInt(y + MIN_SIZE, y + h - MIN_SIZE);
    splitRegion(x, y, w, cut - y, out);
    splitRegion(x, cut, w, y + h - cut, out);
  }
}

function generateSubdividedSpirals(cells, cols, getCell) {
  const rows = Math.floor(cells.length / cols);
  const regions = [];
  splitRegion(0, 0, cols, rows, regions);

  for (const region of regions) {
    const clockwise = Math.random() < 0.5;
    const spiral = spiralPathForRegion(region.x, region.y, region.w, region.h, clockwise);
    carvePathByCoordinates(spiral, getCell, cols);
  }

  const regionByCell = new Array(cells.length).fill(-1);
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        regionByCell[cellIndex(x, y, cols)] = i;
      }
    }
  }

  const adjacency = new Map();
  const ensureEdgeBucket = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    const mapA = adjacency.get(a);
    if (!mapA.has(b)) mapA.set(b, []);
    return mapA.get(b);
  };
  const addRegionBoundary = (regionA, regionB, cellA, cellB) => {
    if (regionA === regionB || regionA < 0 || regionB < 0) return;
    ensureEdgeBucket(regionA, regionB).push({ cellA, cellB });
    ensureEdgeBucket(regionB, regionA).push({ cellA: cellB, cellB: cellA });
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = cellIndex(x, y, cols);
      const region = regionByCell[idx];

      if (x + 1 < cols) {
        const rightIdx = cellIndex(x + 1, y, cols);
        addRegionBoundary(region, regionByCell[rightIdx], { x, y }, { x: x + 1, y });
      }
      if (y + 1 < rows) {
        const downIdx = cellIndex(x, y + 1, cols);
        addRegionBoundary(region, regionByCell[downIdx], { x, y }, { x, y: y + 1 });
      }
    }
  }

  if (regions.length > 0) {
    const startRegion = randInt(0, regions.length);
    const visitedRegions = new Set([startRegion]);
    const stack = [startRegion];

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighborsMap = adjacency.get(current) || new Map();
      const unvisitedNeighbors = [];

      for (const neighbor of neighborsMap.keys()) {
        if (!visitedRegions.has(neighbor)) unvisitedNeighbors.push(neighbor);
      }

      if (unvisitedNeighbors.length === 0) {
        stack.pop();
        continue;
      }

      const nextRegion = pickRandom(unvisitedNeighbors);
      const boundaryOptions = neighborsMap.get(nextRegion) || [];
      const choice = pickRandom(boundaryOptions);

      const a = getCell(choice.cellA.x, choice.cellA.y);
      const b = getCell(choice.cellB.x, choice.cellB.y);
      if (a && b) carveBetween(a, b, cols);

      visitedRegions.add(nextRegion);
      stack.push(nextRegion);
    }
  }

  for (const cell of cells) {
    cell.visited = true;
  }
}

function generateGrowingTree(cells, cols, getCell) {
  const start = pickRandom(cells);
  start.visited = true;
  const active = [start];

  while (active.length > 0) {
    // 70% newest cell, 30% random active cell for mixed texture.
    const useNewest = Math.random() < 0.7;
    const idx = useNewest ? active.length - 1 : randInt(0, active.length);
    const current = active[idx];

    const neighbors = getNeighbors(current, getCell).filter((n) => !n.visited);
    if (neighbors.length === 0) {
      active.splice(idx, 1);
      continue;
    }

    const next = pickRandom(neighbors);
    carveBetween(current, next, cols);
    next.visited = true;
    active.push(next);
  }
}

export function normalizeMazeAlgorithm(input) {
  const key = String(input || '').trim().toLowerCase();
  if (ALGORITHMS[key]) return ALGORITHMS[key].id;
  return DEFAULT_MAZE_ALGORITHM;
}

export function getMazeAlgorithmLabel(algorithm) {
  const normalized = normalizeMazeAlgorithm(algorithm);
  return ALGORITHMS[normalized].label;
}

export function generateMaze({ algorithm, cells, walls, cols, getCell }) {
  const normalized = normalizeMazeAlgorithm(algorithm);
  resetMazeState(cells, walls);

  if (normalized === ALGORITHMS.dfs.id) {
    generateDfsBacktracker(cells, cols, getCell);
  } else if (normalized === ALGORITHMS.backbite.id) {
    generateBackbite(cells, cols, getCell);
  } else if (normalized === ALGORITHMS.subdivspiral.id) {
    generateSubdividedSpirals(cells, cols, getCell);
  } else if (normalized === ALGORITHMS.growingtree.id) {
    generateGrowingTree(cells, cols, getCell);
  } else {
    generatePrim(cells);
  }

  return normalized;
}
