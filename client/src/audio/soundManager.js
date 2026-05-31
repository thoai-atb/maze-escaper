const SOUND_FILES = {
  STEP: '/audio/step.wav',
  SCREAM: '/audio/ghost_scream.wav',
  DOOR: '/audio/trapdoor_open.wav',
  DOOR_UNLOCK: '/audio/door_unlock.wav',
  MAP: '/audio/map.wav',
  RADAR: '/audio/radar.wav',
  REVIVAL: '/audio/revival.wav',
  FALL_SCREAM: '/audio/fall_scream.wav',
  EXIT: '/audio/exit.wav',
  PORTAL: '/audio/portal.wav',
  DOOR_CLOSE: '/audio/trapdoor_close.wav',
  KEY: '/audio/key.wav'
};

class SoundManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.5;
    this.loaded = false;
    this.bank = {};
  }

  load() {
    if (this.loaded) return;
    for (const [key, path] of Object.entries(SOUND_FILES)) {
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.volume = this.volume;
      this.bank[key] = audio;
    }
    this.loaded = true;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    for (const audio of Object.values(this.bank)) {
      audio.volume = this.volume;
    }
  }

  play(key) {
    if (!this.enabled) return;
    if (!this.loaded) this.load();
    const template = this.bank[key];
    if (!template) return;

    const clone = template.cloneNode();
    clone.volume = this.volume;
    clone.play().catch(() => {});
  }
}

export const soundManager = new SoundManager();
export const SOUND = Object.freeze(Object.keys(SOUND_FILES).reduce((acc, key) => {
  acc[key] = key;
  return acc;
}, {}));
