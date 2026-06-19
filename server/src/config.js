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
    sameTileSpread: 0.1, // Increase -> players on same tile are displayed farther apart. Decrease -> closer together.
    relocateDelayMs: 5000 // Delay before downed body teleports after trap fall (approx portal charge time).
  },
  ghost: {
    moveMs: 700, // Increase -> normal ghosts move less often (easier). Decrease -> move more often (harder).
    crazySpeedMultiplier: 3, // Crazy ghosts step 3x as often as normal while following paths.
    sneakySpeedMultiplier: 2, // Sneaky ghosts move 2x as often after they are alerted.
    spawnChance: 0.03, // Increase -> more ghosts on average. Decrease -> fewer ghosts.
    crazyChance: 0.15, // Increase -> more spawned ghosts are crazy. Decrease -> fewer crazy ghosts.
    sneakyChance: 0.15 // Increase -> more spawned ghosts are sneaky. Decrease -> fewer sneaky ghosts.
  },
  world: {
    portalSpawnChance: 0.005, // Increase -> more portals generated. Decrease -> fewer portals.
    portalReloadMs: 5000, // Increase -> portals stay inactive longer after teleport. Decrease -> reactivate faster.
    portalPulseSpeedPerMs: 0.0007, // Increase -> faster portal pulse animation. Decrease -> slower pulse animation.
    portalPulseMin: 0.9, // Increase -> raises smallest pulse size. Decrease -> allows smaller pulse size.
    portalPulseMax: 1.1, // Increase -> raises largest pulse size. Decrease -> caps largest pulse lower.
    gadgetCellChance: 0.015, // Total chance any cell is a gadget tile (radar or blueprint).
    gadgetRadarRatio: 0.5,  // Of all gadget tiles, this fraction will be radar; the rest will be blueprint. 0.5 = equal split.
    specialTileDurability: 9, // Max durability per gadget tile.
    specialTileWearMs: 5000 // Occupied time required to consume one durability point.
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
  debug: {
    events: {
      enabled: true, // Enable server-side logging for emitted game:events payloads.
      logUiPatch: false, // Also log the UI patch that accompanies emitted events.
      includeRoomCode: true, // Include the room code in each debug log line.
      onlyTypes: [
        // Uncomment specific event names to filter logs to only those events.
        // 'player_move',
        'player_fall',
        'body_fall',
        // 'player_die',
        'player_ghost_die',
        // 'player_state',
        // 'ghost_move',
        'ghost_fall',
        // 'ghost_state',
        'ghost_remove',
        'trap_open',
        'trap_close',
        'portal_activated',
        'portal_removed',
        'portal_added',
        'portal_charged',
        'gadget_tile_update',
        'radar_toggle',
        'map_toggle',
        'cheat_toggle',
        'round_finish',
        'exit_lock',
        'key_dropped',
        'key_picked_up'
      ] // Leave all commented out to log all event types.
    }
  },
  vision: {
    maxSightDistance: 8 // Increase -> farther visibility/brightness reach. Decrease -> shorter visibility/darker play.
  },
  finish: {
    fadePerSecond: 100 // Increase -> faster end-round fade to full visibility. Decrease -> slower fade.
  },
  mysteryBox: {
    respawnMs: 5000, // Delay before a consumed mystery box respawns on the board.
    outcomes: [
      { id: 'spawn_portal', weight: 10 },
      { id: 'spawn_crazy', weight: 5 },
      { id: 'add_life', weight: 30 },
      { id: 'add_shield', weight: 100 },
      { id: 'spawn_map_tile', weight: 30 },
      { id: 'spawn_radar_tile', weight: 30 },
      { id: 'give_key', weight: 10 },
      { id: 'swap_player', weight: 20 }
      // Set weight higher to make an outcome more likely, or 0 to disable it.
    ]
  },
  mazeAlgorithm: {
    weightedBias: [
      { id: 'prim', weight: 60 },
      { id: 'dfs', weight: 10 },
      { id: 'growingtree', weight: 20 },
      { id: 'subdivspiral', weight: 10 },
      { id: 'backbite', weight: 1 }
      // Higher weight = more likely. Comment out an entry to remove it from the random pool.
    ]
  },
  level: {
    min: 1, // First level number.
    max: 8, // Last level number. Increase -> more levels before game ends.
    rowSteps: [8, 10, 12, 14, 16, 18, 20, 22] // Maze row count per level. Add entries when adding levels; cols = rows * 2.
  }
};
