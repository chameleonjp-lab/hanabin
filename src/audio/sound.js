const TONES = Object.freeze({
  select: { frequency: 520, duration: 0.07, type: "sine", gain: 0.035 },
  detonate: { frequency: 180, duration: 0.16, type: "triangle", gain: 0.055 },
  chain: { frequency: 760, duration: 0.12, type: "sine", gain: 0.045 },
});

/** Optional, low-volume UI sound. Disabled by default and never part of game state. */
export class SoundController {
  constructor({
    enabled = false,
    contextFactory = null,
  } = {}) {
    this.enabled = enabled === true;
    this.contextFactory = contextFactory ?? (() => {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      return AudioContextClass ? new AudioContextClass() : null;
    });
    this.context = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled && this.context?.state === "running") {
      try {
        this.context.suspend();
      } catch {
        // Audio is an enhancement; ignore browser-specific lifecycle errors.
      }
    }
    return this.enabled;
  }

  ensureContext() {
    if (this.context) return this.context;
    try {
      this.context = this.contextFactory?.() ?? null;
    } catch {
      this.context = null;
    }
    return this.context;
  }

  play(kind = "select") {
    if (!this.enabled) return false;
    const tone = TONES[kind] ?? TONES.select;
    const context = this.ensureContext();
    if (!context?.createOscillator || !context?.createGain) return false;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = Number(context.currentTime) || 0;
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(tone.gain, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.duration);
      return true;
    } catch {
      return false;
    }
  }

  selection() { return this.play("select"); }
  detonation() { return this.play("detonate"); }
  chain() { return this.play("chain"); }

  destroy() {
    try {
      this.context?.close?.();
    } catch {
      // Best effort only.
    }
    this.context = null;
  }
}

export { TONES };

export default SoundController;
