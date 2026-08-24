import { normalizePresentationVariant } from "../presentation/experience.js";

export const SOUND_CUES = Object.freeze([
  "tap",
  "trace",
  "select",
  "detonate",
  "chain",
  "milestone",
  "spawn",
  "expire",
  "score",
  "cancel",
]);

/** Primary cue layer. Kept as an object for backwards-compatible inspection. */
const TONES = Object.freeze({
  tap: Object.freeze({ frequency: 300, duration: 0.035, type: "sine", gain: 0.018 }),
  trace: Object.freeze({ frequency: 390, duration: 0.035, type: "sine", gain: 0.012 }),
  select: Object.freeze({ frequency: 520, duration: 0.07, type: "sine", gain: 0.035 }),
  detonate: Object.freeze({ frequency: 180, duration: 0.16, type: "triangle", gain: 0.055 }),
  chain: Object.freeze({ frequency: 760, duration: 0.12, type: "sine", gain: 0.045 }),
  milestone: Object.freeze({ frequency: 920, duration: 0.2, type: "sine", gain: 0.05 }),
  spawn: Object.freeze({ frequency: 610, duration: 0.11, type: "sine", gain: 0.022 }),
  expire: Object.freeze({ frequency: 230, duration: 0.09, type: "triangle", gain: 0.016 }),
  score: Object.freeze({ frequency: 680, duration: 0.1, type: "sine", gain: 0.032 }),
  cancel: Object.freeze({ frequency: 210, duration: 0.075, type: "square", gain: 0.014 }),
});

const DESKTOP_LAYERS = Object.freeze({
  tap: Object.freeze([
    Object.freeze({ frequency: 600, duration: 0.025, type: "sine", gain: 0.007, delay: 0.006 }),
  ]),
  trace: Object.freeze([
    Object.freeze({ frequency: 780, duration: 0.025, type: "sine", gain: 0.005, delay: 0.008 }),
  ]),
  select: Object.freeze([
    Object.freeze({ frequency: 1_040, duration: 0.055, type: "sine", gain: 0.012, delay: 0.008 }),
  ]),
  detonate: Object.freeze([
    Object.freeze({ frequency: 90, duration: 0.24, type: "sine", gain: 0.038 }),
    Object.freeze({ frequency: 360, duration: 0.11, type: "sawtooth", gain: 0.014, delay: 0.015 }),
  ]),
  chain: Object.freeze([
    Object.freeze({ frequency: 1_140, duration: 0.15, type: "triangle", gain: 0.02, delay: 0.018 }),
  ]),
  milestone: Object.freeze([
    Object.freeze({ frequency: 1_380, duration: 0.24, type: "triangle", gain: 0.025, delay: 0.035 }),
    Object.freeze({ frequency: 460, duration: 0.28, type: "sine", gain: 0.018 }),
  ]),
  spawn: Object.freeze([
    Object.freeze({ frequency: 915, duration: 0.14, type: "triangle", gain: 0.012, delay: 0.02 }),
  ]),
  expire: Object.freeze([]),
  score: Object.freeze([
    Object.freeze({ frequency: 1_020, duration: 0.13, type: "triangle", gain: 0.014, delay: 0.022 }),
  ]),
  cancel: Object.freeze([]),
});

const CUE_INTERVAL_MS = Object.freeze({
  tap: 35,
  trace: 70,
  select: 18,
  detonate: 40,
  chain: 35,
  milestone: 100,
  spawn: 120,
  expire: 120,
  score: 55,
  cancel: 80,
});

const MAX_VOICES = Object.freeze({ touch: 8, desktop: 16 });
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const defaultNow = () => typeof performance !== "undefined" && Number.isFinite(performance.now())
  ? performance.now()
  : Date.now();

const pitchMultiplierFor = (kind, options = {}) => {
  if (kind === "select") return 1 + clamp(finite(options.count), 0, 8) * 0.045;
  if (kind === "chain") return 1 + clamp(finite(options.depth), 0, 12) * 0.055;
  if (kind === "milestone") return 1 + clamp(finite(options.milestone), 0, 30) / 150;
  if (kind === "score") return 1 + Math.log10(Math.max(1, finite(options.amount, 1))) * 0.045;
  if (kind === "spawn") return 1 + clamp(finite(options.count), 0, 24) * 0.006;
  return 1;
};

const disconnect = (node) => {
  try { node?.disconnect?.(); } catch { /* Audio cleanup is best effort. */ }
};

/**
 * Optional presentation audio. It is lazy, muted by default, bounded, and has
 * no path back into the fixed-tick game state.
 */
export class SoundController {
  constructor({
    enabled = false,
    contextFactory = null,
    variant = "touch",
    maxVoices = null,
    now = defaultNow,
  } = {}) {
    this.enabled = enabled === true;
    this.variant = normalizePresentationVariant(variant);
    this.explicitMaxVoices = maxVoices !== null && maxVoices !== undefined &&
      Number.isFinite(Number(maxVoices));
    this.maxVoices = this.explicitMaxVoices
      ? Math.max(1, Math.trunc(Number(maxVoices)))
      : MAX_VOICES[this.variant];
    this.now = typeof now === "function" ? now : defaultNow;
    this.contextFactory = contextFactory ?? (() => {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      return AudioContextClass ? new AudioContextClass() : null;
    });
    this.context = null;
    this.outputContext = null;
    this.outputNode = null;
    this.masterGainNode = null;
    this.compressorNode = null;
    this.activeVoices = new Set();
    this.lastPlayedAt = new Map();
  }

  setVariant(variant) {
    const next = normalizePresentationVariant(variant, this.variant);
    const changed = next !== this.variant;
    this.variant = next;
    if (!this.explicitMaxVoices) this.maxVoices = MAX_VOICES[next];
    const master = this.masterGainNode?.gain;
    const currentTime = finite(this.context?.currentTime);
    try {
      if (master?.setValueAtTime) master.setValueAtTime(next === "desktop" ? 0.82 : 0.72, currentTime);
      else if (master) master.value = next === "desktop" ? 0.82 : 0.72;
    } catch {
      // Variant changes must never interrupt the game.
    }
    return changed;
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) {
      this.stopAllVoices();
      this.lastPlayedAt.clear();
      if (this.context?.state === "running") {
        try {
          const pending = this.context.suspend?.();
          Promise.resolve(pending).catch(() => false);
        } catch {
          // Audio is an enhancement; ignore browser-specific lifecycle errors.
        }
      }
    } else if (this.context?.state === "suspended") {
      void this.resumeContext(this.context);
    }
    return this.enabled;
  }

  ensureContext() {
    if (this.context?.state === "closed") this.context = null;
    if (this.context) return this.context;
    try {
      this.context = this.contextFactory?.() ?? null;
    } catch {
      this.context = null;
    }
    return this.context;
  }

  async resumeContext(context = this.context) {
    if (!context || context.state === "closed") return false;
    if (context.state !== "suspended") return true;
    if (typeof context.resume !== "function") return false;
    try {
      await context.resume();
      return context.state !== "suspended" && context.state !== "closed";
    } catch {
      return false;
    }
  }

  /** Call from a click/pointer gesture to satisfy iOS/WebKit audio policies. */
  async unlock() {
    if (!this.enabled) return false;
    const context = this.ensureContext();
    if (!context) return false;
    return this.resumeContext(context);
  }

  ensureOutput(context) {
    if (this.outputContext === context && this.outputNode) return this.outputNode;
    disconnect(this.masterGainNode);
    disconnect(this.compressorNode);
    this.outputContext = context;
    this.masterGainNode = null;
    this.compressorNode = null;
    let target = context.destination;
    try {
      if (typeof context.createDynamicsCompressor === "function") {
        const compressor = context.createDynamicsCompressor();
        compressor.threshold && (compressor.threshold.value = -18);
        compressor.knee && (compressor.knee.value = 12);
        compressor.ratio && (compressor.ratio.value = 6);
        compressor.attack && (compressor.attack.value = 0.003);
        compressor.release && (compressor.release.value = 0.18);
        compressor.connect(target);
        this.compressorNode = compressor;
        target = compressor;
      }
      if (typeof context.createGain === "function") {
        const master = context.createGain();
        const gain = this.variant === "desktop" ? 0.82 : 0.72;
        if (master.gain?.setValueAtTime) master.gain.setValueAtTime(gain, finite(context.currentTime));
        else if (master.gain) master.gain.value = gain;
        master.connect(target);
        this.masterGainNode = master;
        target = master;
      }
    } catch {
      disconnect(this.masterGainNode);
      disconnect(this.compressorNode);
      this.masterGainNode = null;
      this.compressorNode = null;
      target = context.destination;
    }
    this.outputNode = target;
    return target;
  }

  cueLayers(kind) {
    const primary = TONES[kind] ?? TONES.select;
    return this.variant === "desktop"
      ? [primary, ...(DESKTOP_LAYERS[kind] ?? [])]
      : [primary];
  }

  startVoice(context, output, layer, pitchMultiplier, gainScale = 1) {
    if (this.activeVoices.size >= this.maxVoices) return false;
    let oscillator = null;
    let gainNode = null;
    let voice = null;
    try {
      oscillator = context.createOscillator();
      gainNode = context.createGain();
      if (!oscillator?.connect || !oscillator?.start || !oscillator?.stop || !gainNode?.connect) return false;
      const start = finite(context.currentTime) + Math.max(0, finite(layer.delay));
      const duration = Math.max(0.015, finite(layer.duration, 0.05));
      const frequency = Math.max(30, finite(layer.frequency, 440) * pitchMultiplier);
      const gain = Math.max(0.0002, finite(layer.gain, 0.02) * gainScale);
      oscillator.type = layer.type ?? "sine";
      if (oscillator.frequency?.setValueAtTime) oscillator.frequency.setValueAtTime(frequency, start);
      else if (oscillator.frequency) oscillator.frequency.value = frequency;
      if (gainNode.gain?.setValueAtTime) gainNode.gain.setValueAtTime(gain, start);
      else if (gainNode.gain) gainNode.gain.value = gain;
      gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, start + duration);
      oscillator.connect(gainNode);
      gainNode.connect(output);
      voice = { oscillator, gainNode };
      const cleanup = () => {
        if (!voice) return;
        this.activeVoices.delete(voice);
        disconnect(oscillator);
        disconnect(gainNode);
        voice = null;
      };
      oscillator.onended = cleanup;
      this.activeVoices.add(voice);
      oscillator.start(start);
      oscillator.stop(start + duration);
      return true;
    } catch {
      if (voice) this.activeVoices.delete(voice);
      disconnect(oscillator);
      disconnect(gainNode);
      return false;
    }
  }

  play(kind = "select", options = {}) {
    if (!this.enabled) return false;
    const cue = SOUND_CUES.includes(kind) ? kind : "select";
    const timestamp = finite(this.now(), 0);
    const last = this.lastPlayedAt.get(cue) ?? Number.NEGATIVE_INFINITY;
    if (timestamp - last < CUE_INTERVAL_MS[cue]) return false;
    const context = this.ensureContext();
    if (!context?.createOscillator || !context?.createGain || context.state === "closed") return false;
    if (context.state === "suspended") void this.resumeContext(context);
    const output = this.ensureOutput(context);
    if (!output) return false;
    const pitchMultiplier = pitchMultiplierFor(cue, options);
    const gainScale = clamp(finite(options.gainScale, 1), 0.1, 2);
    let played = false;
    for (const layer of this.cueLayers(cue)) {
      if (this.activeVoices.size >= this.maxVoices) break;
      played = this.startVoice(context, output, layer, pitchMultiplier, gainScale) || played;
    }
    if (played) this.lastPlayedAt.set(cue, timestamp);
    return played;
  }

  tap(options) { return this.play("tap", options); }
  trace(options) { return this.play("trace", options); }
  selection(options) { return this.play("select", options); }
  detonation(options) { return this.play("detonate", options); }
  chain(options) { return this.play("chain", options); }
  milestone(options) { return this.play("milestone", options); }
  spawn(options) { return this.play("spawn", options); }
  expire(options) { return this.play("expire", options); }
  score(options) { return this.play("score", options); }
  cancel(options) { return this.play("cancel", options); }

  stopAllVoices() {
    for (const voice of [...this.activeVoices]) {
      this.activeVoices.delete(voice);
      try {
        voice.oscillator.onended = null;
        voice.oscillator.stop?.();
      } catch {
        // It may already have ended.
      }
      disconnect(voice.oscillator);
      disconnect(voice.gainNode);
    }
  }

  snapshot() {
    return {
      enabled: this.enabled,
      variant: this.variant,
      maxVoices: this.maxVoices,
      activeVoices: this.activeVoices.size,
      contextState: this.context?.state ?? null,
    };
  }

  destroy() {
    this.stopAllVoices();
    disconnect(this.masterGainNode);
    disconnect(this.compressorNode);
    this.masterGainNode = null;
    this.compressorNode = null;
    this.outputNode = null;
    this.outputContext = null;
    try {
      const pending = this.context?.close?.();
      Promise.resolve(pending).catch(() => false);
    } catch {
      // Best effort only.
    }
    this.context = null;
  }
}

export { TONES };

export default SoundController;
