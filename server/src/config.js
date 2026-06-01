export const SERVER_CONFIG = {
  net: {
    tickIntervalMs: 5, // Increase -> fewer updates, lower CPU/network, less smooth. Decrease -> more updates, smoother, higher CPU/network.
    maxDeltaMs: 24, // Increase -> allows bigger sim jumps on lag spikes. Decrease -> tighter/stabler motion but can lag behind elapsed time.
    roomGcIntervalMs: 1000 * 60 * 10, // Increase -> GC runs less often. Decrease -> GC runs more often and cleans stale rooms sooner.
    roomTtlMs: 1000 * 60 * 60 * 8 // Increase -> rooms live longer before auto-delete. Decrease -> rooms expire sooner.
  },
  motion: {
    lerpBase: 0.9975 // Increase -> snappier catch-up (less glide). Decrease -> smoother/floatier easing (more glide).
  },
  player: {
    moveCooldownMs: 90, // Increase -> slower/chunkier player stepping. Decrease -> faster/more continuous stepping.
    reviveMs: 2500, // Increase -> longer revive time. Decrease -> faster revive.
    trapCooldownMs: 250, // Increase -> traps placed less often. Decrease -> traps placed more often.
    sameTileSpread: 0.1 // Increase -> players on same tile are displayed farther apart. Decrease -> closer together.
  },
  ghost: {
    moveMs: 700, // Increase -> normal ghosts move less often (easier). Decrease -> move more often (harder).
    crazyMoveMs: 90, // Increase -> crazy ghosts less frantic. Decrease -> more frantic.
    spawnChance: 0.03, // Increase -> more ghosts on average. Decrease -> fewer ghosts.
    crazyChance: 0.15 // Increase -> more spawned ghosts are crazy. Decrease -> fewer crazy ghosts.
  },
  world: {
    portalSpawnChance: 0.005, // Increase -> more portals generated. Decrease -> fewer portals.
    portalReloadMs: 5000, // Increase -> portals stay inactive longer after teleport. Decrease -> reactivate faster.
    portalPulseSpeedPerMs: 0.0007, // Increase -> faster portal pulse animation. Decrease -> slower pulse animation.
    portalPulseMin: 0.9, // Increase -> raises smallest pulse size. Decrease -> allows smaller pulse size.
    portalPulseMax: 1.1, // Increase -> raises largest pulse size. Decrease -> caps largest pulse lower.
    radarCellChance: 0.005, // Increase -> more radar cells. Decrease -> fewer radar cells.
    bluePrintCellChance: 0.01 // Increase -> more blueprint cells. Decrease -> fewer blueprint cells.
  },
  trap: {
    activeMs: 3000, // Increase -> trap stays dangerous longer. Decrease -> dangerous window is shorter.
    openCloseRatePerMs: 0.0012 // Increase -> trap opens/closes faster. Decrease -> opens/closes slower.
  },
  audio: {
    randomRateBySound: {
      SCREAM: [0.6, 1.2], // Range for ghost-kill scream playback rate.
      FALL_SCREAM: [0.6, 1.2] // Range for trap-fall scream playback rate.
    }
  },
  vision: {
    maxSightDistance: 8 // Increase -> farther visibility/brightness reach. Decrease -> shorter visibility/darker play.
  },
  finish: {
    fadePerSecond: 100 // Increase -> faster end-round fade to full visibility. Decrease -> slower fade.
  },
  level: {
    min: 1, // First level number.
    max: 5, // Last level number. Increase -> more levels before game ends.
    rowSteps: [8, 10, 12, 14, 16] // Maze row count per level. Add entries when adding levels; cols = rows * 2.
  }
};
