export const TILE_COLOR_CONFIG = Object.freeze({
  brightness: {
    min: 8,
    max: 95
  },
  radar: {
    active: {
      hue: 138,
      saturation: 78,
      lightnessScale: 0.5
    },
    inactive: {
      hue: 188,
      saturation: 76,
      lightnessScale: 0.42
    }
  },
  map: {
    active: {
      hue: 140,
      saturation: 76,
      lightnessScale: 0.52
    },
    inactive: {
      hue: 190,
      saturation: 72,
      lightnessScale: 0.44
    }
  },
  gadgetExpired: {
    hue: 0,
    saturation: 0,
    lightnessScale: 0.46
  }
});

export const LEVEL_THEMES = Object.freeze({
  1: {
    tile: {
      unvisited: { hue: 30, saturation: 96, lightnessScale: 0.42 },
      visited: { hue: 30, saturation: 96, lightnessScale: 0.5 }
    },
    wall: { hue: 10, saturation: 68 }
  },
  2: {
    tile: {
      unvisited: { hue: 50, saturation: 78, lightnessScale: 0.4 },
      visited: { hue: 50, saturation: 78, lightnessScale: 0.5 }
    },
    wall: { hue: 80, saturation: 64 }
  },
  3: {
    tile: {
      unvisited: { hue: 150, saturation: 84, lightnessScale: 0.4 },
      visited: { hue: 150, saturation: 84, lightnessScale: 0.5 }
    },
    wall: { hue: 170, saturation: 54 }
  },
  4: {
    tile: {
      unvisited: { hue: 270, saturation: 93, lightnessScale: 0.4 },
      visited: { hue: 270, saturation: 93, lightnessScale: 0.5 }
    },
    wall: { hue: 286, saturation: 62 }
  },
  5: {
    tile: {
      unvisited: { hue: 334, saturation: 82, lightnessScale: 0.4 },
      visited: { hue: 334, saturation: 82, lightnessScale: 0.5 }
    },
    wall: { hue: 0, saturation: 58 }
  },
  6: {
    tile: {
      unvisited: { hue: 240, saturation: 82, lightnessScale: 0.5 },
      visited: { hue: 240, saturation: 82, lightnessScale: 0.6 }
    },
    wall: { hue: 116, saturation: 60 }
  },
  7: {
    tile: {
      unvisited: { hue: 13, saturation: 30, lightnessScale: 0.2 },
      visited: { hue: 13, saturation: 30, lightnessScale: 0.3 }
    },
    wall: { hue: 20, saturation: 24 }
  },
  8: {
    tile: {
      unvisited: { hue: 0, saturation: 0, lightnessScale: 0.2 },
      visited: { hue: 0, saturation: 0, lightnessScale: 0.3 }
    },
    wall: { hue: 0, saturation: 0 }
  }
});

export function getTileThemeByLevel(level) {
  return LEVEL_THEMES[level]?.tile || LEVEL_THEMES[1].tile;
}

export function getWallThemeByLevel(level) {
  return LEVEL_THEMES[level]?.wall || LEVEL_THEMES[1].wall;
}

export const WALL_RENDER_CONFIG = Object.freeze({
  // Pixel thickness added to the black border pass around walls/columns.
  borderThicknessPx: 3
});

export const MOVEMENT_INTERPOLATION_CONFIG = Object.freeze({
  // Higher = faster catch-up to target tile, lower = smoother/slower motion.
  playerLerpFactor: 0.1,
  ghostLerpFactor: 0.1
});
