export const TILE_COLOR_CONFIG = Object.freeze({
  brightness: {
    min: 8,
    max: 95
  },
  unvisited: {
    hue: 33,
    saturation: 100,
    lightnessScale: 0.3
  },
  normal: {
    hue: 33,
    saturation: 100,
    lightnessScale: 0.4
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
