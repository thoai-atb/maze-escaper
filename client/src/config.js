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
  }
});

export const LEVEL_TILE_THEMES = Object.freeze({
  1: {
    unvisited: { hue: 25, saturation: 96, lightnessScale: 0.36 },
    visited: { hue: 25, saturation: 96, lightnessScale: 0.5 }
  },
  2: {
    unvisited: { hue: 50, saturation: 78, lightnessScale: 0.36 },
    visited: { hue: 50, saturation: 78, lightnessScale: 0.5 }
  },
  3: {
    unvisited: { hue: 150, saturation: 84, lightnessScale: 0.36 },
    visited: { hue: 150, saturation: 84, lightnessScale: 0.5 }
  },
  4: {
    unvisited: { hue: 270, saturation: 93, lightnessScale: 0.45 },
    visited: { hue: 270, saturation: 93, lightnessScale: 0.6 }
  },
  5: {
    unvisited: { hue: 334, saturation: 82, lightnessScale: 0.36 },
    visited: { hue: 334, saturation: 82, lightnessScale: 0.5 }
  }
});

export function getTileThemeByLevel(level) {
  return LEVEL_TILE_THEMES[level] || LEVEL_TILE_THEMES[1];
}

export const MOVEMENT_INTERPOLATION_CONFIG = Object.freeze({
  // Higher = faster catch-up to target tile, lower = smoother/slower motion.
  playerLerpFactor: 0.1,
  ghostLerpFactor: 0.1
});
