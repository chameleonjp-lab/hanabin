import {
  DEFAULT_RULES,
  mergeRules,
} from "../config/rules.js";
import {
  advanceGame,
  applyInputFrame,
  createGame,
  finishGame,
  snapshotGame,
  startGame,
  validateGame,
} from "../core/engine.js";
import {
  createReplayLog,
  makeInputFrame,
  replayGame,
} from "../core/index.js";

export const SESSION_PHASES = Object.freeze([
  "home",
  "countdown",
  "playing",
  "finalizing",
  "result",
  "fault",
]);

const finiteSeed = (seed) => {
  const value = Number(seed);
  if (!Number.isFinite(value)) return 1;
  return Math.trunc(value) >>> 0 || 1;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Owns the browser-facing lifecycle while keeping every game decision in the
 * M2 engine.  Countdown and finalizing are presentation phases; only the
 * `playing` phase samples one input frame per fixed game tick.
 */
export class GameSession {
  constructor({
    seed = 1,
    rules = DEFAULT_RULES,
    pointer = null,
    onPhaseChange = null,
    onUpdate = null,
  } = {}) {
    this.rules = mergeRules(rules);
    this.seed = finiteSeed(seed);
    this.pointer = pointer;
    this.onPhaseChange = typeof onPhaseChange === "function" ? onPhaseChange : null;
    this.onUpdate = typeof onUpdate === "function" ? onUpdate : null;
    this.phase = "home";
    this.state = null;
    this.countdownRemaining = 0;
    this.finalized = false;
    this.replay = null;
    this.replayCheck = null;
    this.lastFrame = null;
  }

  emitPhase(previous = null) {
    if (this.onPhaseChange) this.onPhaseChange(this.phase, previous, this);
  }

  emitUpdate() {
    if (this.onUpdate) this.onUpdate(this);
  }

  setPhase(nextPhase) {
    if (!SESSION_PHASES.includes(nextPhase)) {
      throw new RangeError(`unknown HANABIN session phase: ${nextPhase}`);
    }
    const previous = this.phase;
    this.phase = nextPhase;
    if (previous !== nextPhase) this.emitPhase(previous);
  }

  /** Prepare a fresh deterministic run and show the countdown. */
  prepare(seed = this.seed) {
    this.seed = finiteSeed(seed);
    this.state = createGame(this.seed, this.rules);
    this.countdownRemaining = 3;
    this.finalized = false;
    this.replay = null;
    this.replayCheck = null;
    this.lastFrame = null;
    this.setPhase("countdown");
    this.emitUpdate();
    return this;
  }

  beginPlay() {
    if (!this.state) this.prepare(this.seed);
    if (this.phase === "countdown" || this.phase === "home") {
      startGame(this.state);
      this.countdownRemaining = 0;
      this.setPhase("playing");
      this.emitUpdate();
    }
    return this.state;
  }

  updateCountdown(seconds) {
    if (this.phase !== "countdown") return this.countdownRemaining;
    const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.countdownRemaining = value;
    if (value <= 0) this.beginPlay();
    else this.emitUpdate();
    return this.countdownRemaining;
  }

  nextFrame() {
    if (!this.state || this.phase !== "playing") return this.state;
    const tick = this.state.actionCount;
    if (tick >= this.rules.maxTicks) {
      this.enterFinalizing();
      return this.state;
    }
    const frame = this.pointer?.sampleFrame(tick, tick) ?? makeInputFrame(
      tick,
      tick,
      "noop",
      { pressed: false, x: 0, y: 0 },
    );
    this.lastFrame = frame;
    applyInputFrame(this.state, frame, { rules: this.rules, record: true });
    if (this.state.simulationFault) {
      this.setPhase("fault");
      this.emitUpdate();
      return this.state;
    }
    this.emitUpdate();
    if (this.state.actionCount >= this.rules.maxTicks) this.enterFinalizing();
    return this.state;
  }

  /** Advance a known number of fixed ticks without waiting on a wall clock. */
  advanceTicks(count = 1) {
    if (this.phase === "countdown") this.beginPlay();
    const limit = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
    for (let index = 0; index < limit && this.phase === "playing"; index += 1) {
      this.nextFrame();
    }
    return this.state;
  }

  enterFinalizing() {
    if (this.phase !== "playing" || this.finalized) return this.state;
    this.setPhase("finalizing");
    return this.state;
  }

  /**
   * Resolve the terminal boundary.  M2 permits the final action's bounded
   * chain to finish after session input tick 3,600, but no new pointer input
   * is sampled here.
   */
  finalize() {
    if (!this.state) return null;
    if (this.finalized) return this.state;
    if (this.state.tick < this.rules.maxTicks) advanceGame(this.state, this.rules.maxTicks, this.rules);
    if (!this.state.simulationFault) finishGame(this.state, this.rules, false);
    this.finalized = true;
    if (this.state.simulationFault) {
      this.setPhase("fault");
      this.emitUpdate();
      return this.state;
    }
    this.buildReplayCheck();
    this.emitUpdate();
    return this.state;
  }

  showResult() {
    if (!this.state) return null;
    if (!this.finalized) this.finalize();
    if (this.phase === "finalizing") this.setPhase("result");
    this.emitUpdate();
    return this.state;
  }

  finishNow() {
    if (!this.state) this.prepare(this.seed);
    if (this.phase === "countdown" || this.phase === "home") this.beginPlay();
    while (this.phase === "playing") this.nextFrame();
    this.finalize();
    this.showResult();
    return this.state;
  }

  /** Apply the sampler's cancel/interrupt marker immediately when possible. */
  flushInterrupt() {
    if (!this.state || this.phase !== "playing") return false;
    if (this.state.actionCount >= this.rules.maxTicks) return false;
    const tick = this.state.actionCount;
    const frame = this.pointer?.sampleFrame(tick, tick);
    if (!frame || (frame.cancelled !== true && frame.interrupted !== true)) return false;
    this.lastFrame = frame;
    applyInputFrame(this.state, frame, { rules: this.rules, record: true });
    this.emitUpdate();
    return !this.state.simulationFault;
  }

  buildReplayCheck() {
    if (!this.state || this.state.inputFrames.length !== this.rules.maxTicks) {
      this.replay = null;
      this.replayCheck = {
        ok: false,
        reason: "INPUT_FRAME_COUNT",
        expected: this.rules.maxTicks,
        received: this.state?.inputFrames?.length ?? 0,
      };
      return this.replayCheck;
    }
    try {
      this.replay = createReplayLog({
        seed: this.seed,
        rules: this.rules,
        frames: this.state.inputFrames,
      });
    } catch (error) {
      this.replay = null;
      this.replayCheck = {
        ok: false,
        reason: "REPLAY_CREATE",
        error: error?.message ?? String(error),
      };
      return this.replayCheck;
    }
    const replayed = replayGame(this.replay, { rules: this.rules });
    const expected = snapshotGame(this.state);
    const actual = replayed.state;
    const stateMatch = JSON.stringify(expected) === JSON.stringify(actual);
    const scoreMatch = expected.finalScore === actual?.finalScore && expected.score === actual?.score;
    const ok = replayed.validationErrors.length === 0 &&
      !replayed.simulationFault && stateMatch && scoreMatch;
    this.replayCheck = {
      ok,
      stateMatch,
      scoreMatch,
      expectedScore: expected.finalScore ?? expected.score,
      replayScore: actual?.finalScore ?? actual?.score ?? null,
      validationErrors: clone(replayed.validationErrors),
      simulationFault: clone(replayed.simulationFault),
    };
    return this.replayCheck;
  }

  getCurrentInputLog() {
    return this.state ? clone(this.state.inputFrames) : [];
  }

  getRemainingSeconds() {
    if (!this.state) return this.rules.maxTicks / this.rules.tickRate;
    return Math.max(0, (this.rules.maxTicks - this.state.tick) / this.rules.tickRate);
  }

  snapshot() {
    return this.state ? snapshotGame(this.state) : null;
  }

  validate() {
    return this.state ? validateGame(this.state, this.rules) : ["STATE_NOT_STARTED"];
  }

  goHome() {
    this.state = null;
    this.countdownRemaining = 0;
    this.finalized = false;
    this.replay = null;
    this.replayCheck = null;
    this.setPhase("home");
    this.emitUpdate();
  }
}

export default GameSession;
