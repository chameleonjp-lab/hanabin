import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
  mergeRules,
} from "../config/rules.js";
import { PointerController } from "../input/pointer-controller.js";
import { displayEntityRadius } from "../render/competitive-layer.js";

// The practice is intentionally short enough to finish before a first-time
// player loses interest, while still giving one complete example of a chain.
// The first stage uses the original three-target lesson.  The second stage
// adds movement and one non-selectable nearby target that the explosion can
// actually capture.
export const PRACTICE_SECONDS = 18;
export const PRACTICE_STAGE_COUNT = 2;
export const PRACTICE_STAGE_TRANSITION_MS = 650;
export const PRACTICE_TARGET_COUNT = 3;
export const PRACTICE_SUCCESS_DISPLAY_MS = 700;
export const PRACTICE_TRACE_DISTANCE = 240;

// The practice board is deliberately fixed. It teaches the real gesture
// without changing the deterministic game session, score, or replay format.
export const PRACTICE_TARGETS = Object.freeze([
  Object.freeze({ id: "practice-red-1", x: 0.29, y: 0.54, color: "#ff718f", symbol: "●" }),
  Object.freeze({ id: "practice-red-2", x: 0.50, y: 0.39, color: "#ff718f", symbol: "●" }),
  Object.freeze({ id: "practice-red-3", x: 0.71, y: 0.54, color: "#ff718f", symbol: "●" }),
]);

const PRACTICE_DECOYS = Object.freeze([
  Object.freeze({ x: 0.34, y: 0.27, color: "#6ea8ff", symbol: "◆" }),
  Object.freeze({ x: 0.66, y: 0.27, color: "#6ea8ff", symbol: "◆" }),
]);

export const PRACTICE_STAGE_TWO_TARGETS = Object.freeze([
  Object.freeze({
    id: "practice-moving-green-1",
    x: 0.28,
    y: 0.52,
    color: "#72e5ba",
    symbol: "▲",
    motionX: 0.014,
    motionY: 0.010,
    phase: 0,
  }),
  Object.freeze({
    id: "practice-moving-green-2",
    x: 0.50,
    y: 0.40,
    color: "#72e5ba",
    symbol: "▲",
    motionX: 0.012,
    motionY: 0.014,
    phase: 1.7,
  }),
  Object.freeze({
    id: "practice-moving-green-3",
    x: 0.70,
    y: 0.52,
    color: "#72e5ba",
    symbol: "▲",
    motionX: 0.013,
    motionY: 0.011,
    phase: 3.2,
  }),
]);

export const PRACTICE_CHAIN_TARGET = Object.freeze({
  id: "practice-chain-yellow-1",
  x: 0.79,
  y: 0.52,
  color: "#ffd166",
  symbol: "✦",
  selectable: false,
});

const LIFECYCLE_REASONS = new Set([
  "visibilitychange",
  "pagehide",
  "orientationchange",
  "lostpointercapture",
]);

const finite = (value, fallback = PRACTICE_SECONDS) => Number.isFinite(Number(value))
  ? Number(value)
  : fallback;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const practiceStageDurationsFor = (durationSeconds = PRACTICE_SECONDS) => {
  const total = Math.max(10, Math.min(20, Math.trunc(finite(durationSeconds))));
  const first = Math.max(4, Math.min(total - 4, Math.round(total * 0.45)));
  return Object.freeze([first, total - first]);
};

const movingPracticeTargetAt = (target, tick = 0) => {
  const safeTick = Math.max(0, Math.trunc(Number(tick) || 0));
  return {
    ...target,
    x: clamp(
      target.x + Math.sin((safeTick + target.phase) * 0.05) * target.motionX,
      0.12,
      0.88,
    ),
    y: clamp(
      target.y + Math.cos((safeTick + target.phase) * 0.043) * target.motionY,
      0.18,
      0.82,
    ),
  };
};

/** Return the deterministic practice layout for a stage and input tick. */
export const practiceTargetsAt = (stage = 1, tick = 0) => {
  if (stage !== 2) return PRACTICE_TARGETS.map((target) => ({ ...target, selectable: true }));
  return [
    ...PRACTICE_STAGE_TWO_TARGETS.map((target) => movingPracticeTargetAt(target, tick)),
    { ...PRACTICE_CHAIN_TARGET },
  ];
};

export const normalizePracticePoint = (clientX, clientY, rect) => {
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
      rect.width <= 0 || rect.height <= 0 ||
      !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  return {
    x: clamp((Number(clientX) - rect.left) / rect.width, 0, 1),
    y: clamp((Number(clientY) - rect.top) / rect.height, 0, 1),
  };
};

const distanceSquared = (left, right) =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2;

const validPracticePoint = (point, rules) => point &&
  Number.isInteger(point.x) && Number.isInteger(point.y) &&
  point.x >= 0 && point.x <= rules.boardWidth &&
  point.y >= 0 && point.y <= rules.boardHeight;

export const practiceTargetBoardPoint = (target, {
  boardWidth = BOARD_WIDTH,
  boardHeight = BOARD_HEIGHT,
} = {}) => ({
  ...target,
  x: Math.round(target.x * boardWidth),
  y: Math.round(target.y * boardHeight),
});

const findPracticeCandidateAtPoint = (point, selectedIds, rules, targets) => {
  if (!validPracticePoint(point, rules)) return null;
  const selected = new Set(selectedIds.map(String));
  const boardTargets = targets.map((target) => practiceTargetBoardPoint(target, rules));
  const first = boardTargets.find((target) => selected.has(String(target.id))) ?? null;
  const lastId = selectedIds.at(-1);
  const last = boardTargets.find((target) => String(target.id) === String(lastId)) ?? null;
  const hitRadiusSquared = rules.selectionHitRadius ** 2;
  const linkRadiusSquared = rules.selectionLinkDistance ** 2;
  return boardTargets
    .filter((target) => target.selectable !== false)
    .filter((target) => !selected.has(String(target.id)))
    .filter((target) => !first || !rules.selectionSameColor || target.color === first.color)
    .map((target) => ({
      target,
      distance: distanceSquared(point, target),
      linkDistance: last ? distanceSquared(last, target) : 0,
    }))
    .filter((candidate) => candidate.distance <= hitRadiusSquared)
    .filter((candidate) => !last || candidate.linkDistance <= linkRadiusSquared)
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      const leftId = String(left.target.id);
      const rightId = String(right.target.id);
      return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
    })
    .at(0)?.target ?? null;
};

const practicePathSamples = (point, rules) => {
  const rawPath = Array.isArray(point?.path)
    ? point.path.filter((candidate) => validPracticePoint(candidate, rules))
    : [];
  const points = rawPath.length ? rawPath.map((candidate) => ({ ...candidate })) : [point];
  if (!validPracticePoint(points.at(-1), rules)) return [];
  if (points.at(-1).x !== point.x || points.at(-1).y !== point.y) {
    points.push({ x: point.x, y: point.y });
  }
  const spacing = Math.max(1, Math.round(rules.selectionHitRadius * 0.5));
  const samples = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index - 1] ?? points[index];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      samples.push({
        x: Math.round(start.x + (end.x - start.x) * ratio),
        y: Math.round(start.y + (end.y - start.y) * ratio),
      });
    }
  }
  return samples;
};

/** Return the same nearest, same-colour, circular candidate used by play. */
export const findPracticeCandidate = (
  point,
  selectedIds = [],
  rulesArg = DEFAULT_RULES,
  { stage = 1, tick = 0, targets = null } = {},
) => {
  const rules = mergeRules(rulesArg);
  const layout = targets ?? practiceTargetsAt(stage, tick);
  for (const sample of practicePathSamples(point, rules)) {
    const candidate = findPracticeCandidateAtPoint(sample, selectedIds, rules, layout);
    if (candidate) return candidate;
  }
  return null;
};

/**
 * A small fixed interaction board used only before the real game starts.
 * It uses the real 16,000 x 9,000 coordinate system, PointerController, hit
 * geometry, first-pointer ownership, and 60 Hz / three-tick acquisition rule.
 */
export class TutorialController {
  constructor(element, {
    durationSeconds = PRACTICE_SECONDS,
    onComplete = null,
    onSkip = null,
    rules = DEFAULT_RULES,
    sound = null,
    isInteractionAllowed = null,
    orientation = "landscape",
  } = {}) {
    if (!element) throw new TypeError("TutorialController requires a practice screen");
    this.element = element;
    this.boardElement = element.querySelector("#practice-board");
    this.canvas = element.querySelector("#practice-canvas");
    this.context = this.canvas?.getContext?.("2d");
    if (!this.canvas || !this.context) throw new TypeError("TutorialController requires a practice canvas");
    this.rules = mergeRules(rules);
    this.durationSeconds = Math.max(10, Math.min(20, Math.trunc(finite(durationSeconds))));
    this.stageDurations = practiceStageDurationsFor(this.durationSeconds);
    this.onComplete = typeof onComplete === "function" ? onComplete : null;
    this.onSkip = typeof onSkip === "function" ? onSkip : null;
    this.sound = sound;
    this.orientation = orientation === "portrait" ? "portrait" : "landscape";
    this.isInteractionAllowed = typeof isInteractionAllowed === "function"
      ? isInteractionAllowed
      : () => true;
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.timerId = null;
    this.successTimeoutId = null;
    this.state = "ready";
    this.stage = 1;
    this.stageStartedAtMs = null;
    this.selectedIds = [];
    this.selectedRecords = [];
    this.successTargets = [];
    this.chainCaptured = false;
    this.gesturePressed = false;
    this.hoverCandidateId = null;
    this.hoverTicks = 0;
    this.selectionSinceTick = null;
    this.tracePoint = null;
    this.traceDistanceCarry = 0;
    this.inputTick = 0;
    this.lastInterruptReason = "";
    this.lastFailureReason = "";
    this.valueElement = element.querySelector("#practice-value");
    this.messageElement = element.querySelector("#practice-message");
    this.progressElement = element.querySelector("#practice-progress");
    this.feedbackElement = element.querySelector("#practice-feedback");
    this.stageElement = element.querySelector("#practice-stage");
    this.startButton = element.querySelector("#practice-start");
    this.skipButton = element.querySelector("#practice-skip");
    this.continueButton = element.querySelector("#practice-continue");
    this.handlers = {
      start: () => {
        void this.sound?.unlock?.();
        this.begin();
      },
      skip: () => this.skip(),
      continue: () => this.continue(),
    };
    this.startButton?.addEventListener("click", this.handlers.start);
    this.skipButton?.addEventListener("click", this.handlers.skip);
    this.continueButton?.addEventListener("click", this.handlers.continue);
    this.pointer = new PointerController(this.canvas, {
      boardWidth: this.rules.boardWidth,
      boardHeight: this.rules.boardHeight,
      orientation: this.orientation,
      isInputAllowed: () => this.state === "running" && this.isInteractionAllowed(),
      onChange: (change) => this.handlePointerChange(change),
      onInterrupt: (reason) => this.handlePointerInterrupt(reason),
      onLifecycle: (reason) => this.handlePointerLifecycle(reason),
    });
    this.canvas.dataset.practiceTargets = PRACTICE_TARGETS
      .map((target) => `${target.x},${target.y}`).join("|");
    this.canvas.dataset.practiceBoardWidth = String(this.rules.boardWidth);
    this.canvas.dataset.practiceBoardHeight = String(this.rules.boardHeight);
    this.canvas.dataset.practiceHitRadius = String(this.rules.selectionHitRadius);
    this.canvas.dataset.practiceMinHoldTicks = String(this.rules.minHoldTicks);
    this.canvas.dataset.orientation = this.orientation;
    this.width = Math.max(1, Number(this.canvas.width) || 960);
    this.height = Math.max(1, Number(this.canvas.height) || 540);
    this.devicePixelRatio = 1;
    this.resizeObserver = null;
    this.resizeCanvas();
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeCanvas();
        this.render();
      });
      this.resizeObserver.observe(this.canvas);
    }
    this.render();
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect?.();
    const rectWidth = Math.round(Number(rect?.width) || 0);
    const rectHeight = Math.round(Number(rect?.height) || 0);
    const width = Math.max(1, rectWidth || this.width || 960);
    const height = Math.max(1, rectHeight || this.height || Math.round(width * 9 / 16));
    const devicePixelRatio = typeof window === "undefined"
      ? 1
      : Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
    const backingWidth = Math.max(1, Math.round(width * devicePixelRatio));
    const backingHeight = Math.max(1, Math.round(height * devicePixelRatio));
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    this.width = width;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    this.canvas.dataset.practiceCssWidth = String(width);
    this.canvas.dataset.practiceCssHeight = String(height);
    this.canvas.dataset.practiceDevicePixelRatio = String(devicePixelRatio);
    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return { width, height, devicePixelRatio };
  }

  setOrientation(orientation = "landscape") {
    const next = orientation === "portrait" ? "portrait" : "landscape";
    const changed = this.orientation !== next;
    this.orientation = next;
    this.pointer.setOrientation(next);
    this.canvas.dataset.orientation = next;
    return changed;
  }

  resetGesture({ clearSelection = true } = {}) {
    this.gesturePressed = false;
    this.hoverCandidateId = null;
    this.hoverTicks = 0;
    this.selectionSinceTick = null;
    this.tracePoint = null;
    this.traceDistanceCarry = 0;
    if (clearSelection) {
      this.selectedIds = [];
      this.selectedRecords = [];
    }
  }

  show() {
    this.stopTimer();
    this.stopSuccessTimer();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.stageStartedAtMs = null;
    this.state = "ready";
    this.stage = 1;
    this.pointer.clear();
    this.resetGesture();
    this.successTargets = [];
    this.chainCaptured = false;
    this.inputTick = 0;
    this.lastInterruptReason = "";
    this.lastFailureReason = "";
    this.render();
    return this.snapshot();
  }

  begin() {
    if (this.state === "running") return this.snapshot();
    if (!["ready", "expired", "success"].includes(this.state)) return this.snapshot();
    if (!this.isInteractionAllowed()) {
      this.lastFailureReason = "portrait-unsupported";
      this.render();
      return this.snapshot();
    }
    this.stopSuccessTimer();
    this.pointer.clear();
    this.resetGesture();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = Date.now();
    this.stageStartedAtMs = this.startedAtMs;
    this.stage = 1;
    this.successTargets = [];
    this.chainCaptured = false;
    this.inputTick = 0;
    this.lastInterruptReason = "";
    this.lastFailureReason = "";
    this.state = "running";
    this.render();
    this.timerId = setInterval(() => this.tick(), 1000 / this.rules.tickRate);
    return this.snapshot();
  }

  tick(now = Date.now()) {
    if (this.state !== "running" || this.startedAtMs === null) return this.snapshot();
    const currentNowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    this.advanceInputTicks(1, { render: false });
    const stageElapsedSeconds = Math.max(
      0,
      (currentNowMs - (this.stageStartedAtMs ?? this.startedAtMs)) / 1000,
    );
    const stageRemainingSeconds = Math.max(
      0,
      this.stageDurations[this.stage - 1] - stageElapsedSeconds,
    );
    this.remainingSeconds = this.stage === 1
      ? stageRemainingSeconds + this.stageDurations[1]
      : stageRemainingSeconds;
    if (stageRemainingSeconds <= 0) {
      this.stopTimer();
      this.pointer.clear();
      this.resetGesture();
      this.state = "expired";
      this.lastFailureReason = "time-expired";
    }
    this.render();
    return this.snapshot();
  }

  /** Deterministic test seam: sample exactly N 60 Hz pointer frames. */
  advanceInputTicks(count = 1, { render = true } = {}) {
    const safeCount = Math.max(0, Math.min(600, Math.trunc(Number(count) || 0)));
    for (let index = 0; index < safeCount && this.state === "running"; index += 1) {
      const frame = this.pointer.sampleFrame(this.inputTick, this.inputTick);
      this.inputTick += 1;
      this.consumeInputFrame(frame);
    }
    if (render) this.render();
    return this.snapshot();
  }

  practiceTargets(tick = this.inputTick) {
    return practiceTargetsAt(this.stage, tick);
  }

  isPracticeChainCaptured(targets = this.practiceTargets(this.inputTick)) {
    const chainTarget = targets.find((target) => target.id === PRACTICE_CHAIN_TARGET.id);
    if (!chainTarget) return false;
    const chainPoint = practiceTargetBoardPoint(chainTarget, this.rules);
    const selected = new Set(this.selectedIds.map(String));
    const radiusSquared = directExplosionRadiusForSelection(this.selectedIds.length, this.rules) ** 2;
    return targets
      .filter((target) => selected.has(String(target.id)))
      .map((target) => practiceTargetBoardPoint(target, this.rules))
      .some((target) => distanceSquared(target, chainPoint) <= radiusSquared);
  }

  completeStageOne() {
    if (this.stage !== 1 || this.state !== "running") return this.snapshot();
    this.stopSuccessTimer();
    this.resetGesture({ clearSelection: false });
    this.successTargets = this.practiceTargets(this.inputTick);
    this.state = "stage-transition";
    this.lastFailureReason = "";
    this.render();
    this.successTimeoutId = setTimeout(() => this.beginStageTwo(), PRACTICE_STAGE_TRANSITION_MS);
    return this.snapshot();
  }

  beginStageTwo() {
    if (this.state !== "stage-transition") return this.snapshot();
    this.stopSuccessTimer();
    this.stage = 2;
    this.stageStartedAtMs = Date.now();
    this.remainingSeconds = this.stageDurations[1];
    this.resetGesture();
    this.state = "running";
    this.lastFailureReason = "";
    this.render();
    return this.snapshot();
  }

  completeSelection() {
    if (this.stage === 1) return this.completeStageOne();
    if (this.isPracticeChainCaptured()) {
      this.chainCaptured = true;
      this.successTargets = this.practiceTargets(this.inputTick);
      return this.succeed();
    }
    this.resetGesture();
    this.lastFailureReason = "chain-out-of-range";
    this.sound?.cancel?.({ reason: this.lastFailureReason });
    this.render();
    return this.snapshot();
  }

  consumeInputFrame(frame) {
    if (this.state === "stage-transition") return;
    if (frame.cancelled === true || frame.interrupted === true) {
      this.resetGesture();
      this.lastFailureReason = frame.cancelled ? "pointer-cancelled" : "pointer-interrupted";
      return;
    }
    if (frame.pressed !== true) {
      const wasPressed = this.gesturePressed;
      this.gesturePressed = false;
      this.hoverCandidateId = null;
      this.hoverTicks = 0;
      if (wasPressed && this.selectedIds.length >= this.rules.minSelection) {
        this.completeSelection();
      } else if (wasPressed || this.selectedIds.length) {
        this.selectedIds = [];
        this.lastFailureReason = "release-below-minimum";
        this.sound?.cancel?.({ reason: this.lastFailureReason });
      }
      return;
    }
    this.gesturePressed = true;
    if (this.selectionSinceTick !== null &&
        frame.tick - this.selectionSinceTick >= this.rules.selectionTimeoutTicks) {
      if (this.selectedIds.length >= this.rules.minSelection) {
        this.completeSelection();
      } else {
        this.resetGesture();
        this.lastFailureReason = "selection-timeout";
        this.sound?.cancel?.({ reason: this.lastFailureReason });
      }
      return;
    }
    const candidate = findPracticeCandidate(frame, this.selectedIds, this.rules, {
      stage: this.stage,
      tick: frame.tick,
    });
    if (!candidate) {
      this.hoverCandidateId = null;
      this.hoverTicks = 0;
      return;
    }
    if (String(this.hoverCandidateId) === String(candidate.id)) this.hoverTicks += 1;
    else {
      this.hoverCandidateId = candidate.id;
      this.hoverTicks = 1;
    }
    if (this.hoverTicks < this.rules.minHoldTicks) return;
    if (this.selectedIds.length < this.rules.maxSelection) {
      this.selectedIds.push(candidate.id);
      const selectedTarget = this.practiceTargets(frame.tick)
        .find((target) => String(target.id) === String(candidate.id));
      this.selectedRecords.push(selectedTarget
        ? { ...selectedTarget }
        : {
          ...candidate,
          x: candidate.x / this.rules.boardWidth,
          y: candidate.y / this.rules.boardHeight,
        });
      if (this.selectedIds.length === 1) this.selectionSinceTick = frame.tick;
      this.sound?.selection?.({ count: this.selectedIds.length });
    }
    this.hoverCandidateId = null;
    this.hoverTicks = 0;
    this.lastFailureReason = "";
  }

  handlePointerChange(change) {
    if (["pointerdown", "pointerdown-queued-after-boundary"].includes(change.type)) {
      void this.sound?.unlock?.();
      this.sound?.tap?.(change);
      this.tracePoint = Number.isFinite(change.aimX) && Number.isFinite(change.aimY)
        ? { x: change.aimX, y: change.aimY }
        : null;
      this.traceDistanceCarry = 0;
    } else if (["pointermove", "deferred-pointermove"].includes(change.type)) {
      const nextPoint = Number.isFinite(change.aimX) && Number.isFinite(change.aimY)
        ? { x: change.aimX, y: change.aimY }
        : null;
      if (change.pressed === true && this.tracePoint && nextPoint) {
        this.traceDistanceCarry += Math.hypot(
          nextPoint.x - this.tracePoint.x,
          nextPoint.y - this.tracePoint.y,
        );
        if (this.traceDistanceCarry >= PRACTICE_TRACE_DISTANCE) {
          this.sound?.trace?.({
            ...change,
            distance: Math.round(this.traceDistanceCarry),
          });
          this.traceDistanceCarry %= PRACTICE_TRACE_DISTANCE;
        }
      }
      this.tracePoint = nextPoint;
    } else if (["pointerup", "pointercancel", "deferred-pointerup", "deferred-pointercancel", "interrupt"]
      .includes(change.type)) {
      this.tracePoint = null;
      this.traceDistanceCarry = 0;
    }
    if (change.type === "secondary-pointer-ignored") {
      this.lastFailureReason = "secondary-pointer-ignored";
    } else if (change.type === "pointerdown") {
      this.lastFailureReason = "";
    }
    // The production 60 Hz practice timer paints the newest pointer sample.
    // Keep immediate rendering only for deterministic/manual test seams where
    // no timer is running, avoiding a parallel pointermove paint loop.
    if (this.timerId === null) this.render();
  }

  handlePointerInterrupt(reason) {
    // Lifecycle callbacks run immediately afterwards and own the state change.
    if (reason === "clear" || LIFECYCLE_REASONS.has(reason)) return;
    if (this.state !== "running") return;
    this.resetGesture();
    this.lastInterruptReason = reason;
    this.lastFailureReason = reason;
    this.sound?.cancel?.({ reason });
    this.render();
  }

  handlePointerLifecycle(reason) {
    if (this.state !== "running") return;
    this.resetGesture();
    this.remainingSeconds = Math.max(0, this.remainingSeconds);
    this.lastInterruptReason = reason;
    this.lastFailureReason = reason;
    this.sound?.cancel?.({ reason });
    if (reason === "orientationchange") {
      // Rotation changes the screen-to-board transform, not the practice
      // session. Keep the timer running while discarding the in-flight path.
      this.render();
      return;
    }
    this.stopTimer();
    this.state = "expired";
    this.render();
  }

  succeed() {
    if (this.state === "success" || this.state === "skipped") return this.snapshot();
    this.stopTimer();
    this.stopSuccessTimer();
    this.pointer.clear();
    this.resetGesture({ clearSelection: false });
    this.remainingSeconds = Math.max(0, this.remainingSeconds);
    this.state = "success";
    this.sound?.detonation?.({ count: this.selectedIds.length });
    this.render();
    return this.snapshot();
  }

  continue() {
    if (this.state !== "success") return this.snapshot();
    if (!this.isInteractionAllowed()) {
      this.lastFailureReason = "portrait-unsupported";
      this.render();
      return this.snapshot();
    }
    this.stopSuccessTimer();
    this.pointer.clear();
    const selectedCount = this.selectedIds.length;
    this.state = "completed";
    this.render();
    this.onComplete?.({ skipped: false, selectedCount });
    return this.snapshot();
  }

  skip() {
    if (this.state === "skipped" || this.state === "success") return this.snapshot();
    if (!this.isInteractionAllowed()) {
      this.lastFailureReason = "portrait-unsupported";
      this.render();
      return this.snapshot();
    }
    this.stopTimer();
    this.stopSuccessTimer();
    this.pointer.clear();
    this.resetGesture();
    this.state = "skipped";
    this.render();
    this.onSkip?.({ skipped: true });
    return this.snapshot();
  }

  stopTimer() {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
  }

  stopSuccessTimer() {
    if (this.successTimeoutId !== null) clearTimeout(this.successTimeoutId);
    this.successTimeoutId = null;
  }

  render() {
    const { context: ctx, canvas } = this;
    const width = this.width;
    const height = this.height;
    const logicalWidth = this.orientation === "portrait" ? height : width;
    const logicalHeight = this.orientation === "portrait" ? width : height;
    const boardStage = this.stage;
    const targets = this.state === "success" && this.successTargets.length
      ? this.successTargets
      : this.state === "stage-transition" && this.successTargets.length
        ? this.successTargets
        : this.practiceTargets(this.inputTick);
    const selectableTargets = targets.filter((target) => target.selectable !== false);
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    if (this.orientation === "portrait") {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
    }
    const toCanvas = (target) => ({ x: target.x * logicalWidth, y: target.y * logicalHeight });
    const boardToCanvas = (point) => ({
      x: point.x / this.rules.boardWidth * logicalWidth,
      y: point.y / this.rules.boardHeight * logicalHeight,
    });
    const selected = new Set(this.selectedIds);
    const gradient = ctx.createLinearGradient(0, 0, logicalWidth, logicalHeight);
    gradient.addColorStop(0, "#07132c");
    gradient.addColorStop(0.5, "#080b1c");
    gradient.addColorStop(1, "#120b28");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#8ca6e8";
    ctx.lineWidth = 1;
    for (let x = logicalWidth / 4; x < logicalWidth; x += logicalWidth / 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, logicalHeight);
      ctx.stroke();
    }
    for (let y = logicalHeight / 3; y < logicalHeight; y += logicalHeight / 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(logicalWidth, y);
      ctx.stroke();
    }
    ctx.restore();

    if (this.selectedIds.length > 1) {
      ctx.save();
      const traceColor = boardStage === 2
        ? "rgba(114, 229, 186, 0.95)"
        : "rgba(255, 113, 143, 0.95)";
      const traceShadow = boardStage === 2
        ? "rgba(114, 229, 186, 0.8)"
        : "rgba(255, 113, 143, 0.8)";
      ctx.strokeStyle = traceColor;
      ctx.shadowColor = traceShadow;
      ctx.shadowBlur = 18;
      ctx.lineWidth = Math.max(5, logicalWidth / 150);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      this.selectedRecords.forEach((target, index) => {
        const point = toCanvas(target);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    if (boardStage === 1) {
      for (const target of PRACTICE_DECOYS) {
        const point = toCanvas(target);
        const scale = Math.min(logicalWidth / this.rules.boardWidth, logicalHeight / this.rules.boardHeight);
        const radius = displayEntityRadius(scale, this.rules);
        ctx.save();
        ctx.globalAlpha = 0.46;
        ctx.fillStyle = target.color;
        ctx.shadowColor = target.color;
        ctx.shadowBlur = radius;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(4, 9, 23, 0.78)";
        ctx.font = `${Math.max(14, radius * 1.1)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(target.symbol, point.x, point.y + 1);
        ctx.restore();
      }
    }

    for (const target of selectableTargets) {
      const point = toCanvas(target);
      const isSelected = selected.has(target.id);
      const isHovered = target.id === this.hoverCandidateId;
      const scale = Math.min(logicalWidth / this.rules.boardWidth, logicalHeight / this.rules.boardHeight);
      const radius = displayEntityRadius(scale, this.rules);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = target.color;
      ctx.shadowColor = target.color;
      ctx.shadowBlur = isSelected || isHovered ? radius * 2.2 : radius;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(4, 9, 23, 0.78)";
      ctx.font = `${Math.max(14, radius * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(target.symbol, point.x, point.y + 1);
      if (isSelected || this.state === "success") {
        ctx.strokeStyle = this.state === "success" ? "#75f0bb" : "#f8fcff";
        ctx.lineWidth = Math.max(2, radius * 0.12);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isHovered) {
        const progress = clamp(this.hoverTicks / Math.max(1, this.rules.minHoldTicks), 0, 1);
        ctx.lineWidth = Math.max(2, radius * 0.12);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 1.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
        ctx.beginPath();
        ctx.arc(
          point.x,
          point.y,
          radius * 1.35,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * progress,
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    const chainTarget = targets.find((target) => target.id === PRACTICE_CHAIN_TARGET.id);
    if (chainTarget) {
      const point = toCanvas(chainTarget);
      const scale = Math.min(logicalWidth / this.rules.boardWidth, logicalHeight / this.rules.boardHeight);
      const radius = displayEntityRadius(scale, this.rules);
      ctx.save();
      ctx.globalAlpha = this.chainCaptured ? 1 : 0.82;
      ctx.fillStyle = chainTarget.color;
      ctx.shadowColor = chainTarget.color;
      ctx.shadowBlur = this.chainCaptured ? radius * 2.4 : radius * 1.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(4, 9, 23, 0.8)";
      ctx.font = `${Math.max(14, radius * 1.05)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(chainTarget.symbol, point.x, point.y + 1);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = this.chainCaptured ? "#75f0bb" : "rgba(255, 209, 102, 0.92)";
      ctx.lineWidth = Math.max(2, radius * 0.12);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 1.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = this.chainCaptured ? "#75f0bb" : "#ffd166";
      ctx.font = `800 ${Math.max(10, radius * 0.7)}px sans-serif`;
      ctx.fillText(this.chainCaptured ? "巻き込み成功" : "巻き込み", point.x, point.y + radius * 2.35);
      ctx.restore();
    }

    if (this.chainCaptured && this.selectedRecords.length && chainTarget) {
      const chainPoint = toCanvas(chainTarget);
      const nearest = this.selectedRecords
        .map((target) => ({ target, distance: distanceSquared(target, chainTarget) }))
        .sort((left, right) => left.distance - right.distance)[0]?.target;
      if (nearest) {
        const selectedPoint = toCanvas(nearest);
        ctx.save();
        ctx.strokeStyle = "rgba(117, 240, 187, 0.86)";
        ctx.shadowColor = "rgba(117, 240, 187, 0.9)";
        ctx.shadowBlur = 10;
        ctx.lineWidth = Math.max(2, logicalWidth / 260);
        ctx.beginPath();
        ctx.moveTo(selectedPoint.x, selectedPoint.y);
        ctx.lineTo(chainPoint.x, chainPoint.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    const pointer = this.pointer.position;
    if (pointer.pressed || pointer.pointerId !== null) {
      const finger = boardToCanvas({ x: pointer.fingerX, y: pointer.fingerY });
      const aim = boardToCanvas({ x: pointer.aimX, y: pointer.aimY });
      ctx.save();
      if (finger.x !== aim.x || finger.y !== aim.y) {
        ctx.strokeStyle = "rgba(222, 243, 255, 0.65)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(finger.x, finger.y);
        ctx.lineTo(aim.x, aim.y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, Math.max(8, logicalWidth / 46), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const boardState = this.state;
    const interactionAllowed = this.isInteractionAllowed();
    if (this.boardElement) this.boardElement.dataset.practiceState = boardState;
    canvas.dataset.practiceState = boardState;
    canvas.dataset.practiceStage = String(this.stage);
    canvas.dataset.practiceStageCount = String(PRACTICE_STAGE_COUNT);
    canvas.dataset.practiceChainCaptured = this.chainCaptured ? "true" : "false";
    canvas.dataset.practiceTargets = selectableTargets
      .map((target) => `${target.x},${target.y}`)
      .join("|");
    canvas.dataset.practiceSelectedCount = String(this.selectedIds.length);
    canvas.dataset.practiceRemaining = String(Math.ceil(this.remainingSeconds));
    canvas.dataset.practiceInputTick = String(this.inputTick);
    canvas.dataset.practiceHoverCandidate = this.hoverCandidateId ?? "";
    canvas.dataset.practiceHoverTicks = String(this.hoverTicks);
    canvas.dataset.practiceTargetRadius = String(displayEntityRadius(
      Math.min(logicalWidth / this.rules.boardWidth, logicalHeight / this.rules.boardHeight),
      this.rules,
    ));
    canvas.dataset.practiceLastInterrupt = this.lastInterruptReason;
    canvas.dataset.practiceLastFailure = this.lastFailureReason;
    if (this.stageElement) {
      this.stageElement.textContent = boardState === "stage-transition"
        ? "STEP 1 / 2 · 基本操作 成功"
        : this.state === "success"
          ? "STEP 2 / 2 · 巻き込み成功"
          : this.stage === 2
            ? "STEP 2 / 2 · 動く花火を巻き込む"
            : "STEP 1 / 2 · まずは3つつなぐ";
    }
    if (this.valueElement) {
      this.valueElement.textContent = boardState === "ready"
        ? `${this.durationSeconds}秒`
        : boardState === "running"
          ? String(Math.max(1, Math.ceil(this.remainingSeconds)))
          : boardState === "stage-transition"
            ? "1 / 2"
          : boardState === "expired"
            ? "再挑戦"
            : boardState === "success"
              ? "成功"
              : "準備OK";
    }
    if (this.messageElement) {
      this.messageElement.textContent = !interactionAllowed
        ? "現在の画面では練習できません。画面を確認してください。"
        : boardState === "ready"
        ? "まずは静止した同じ色を3つつなぎます。成功すると、動く花火の巻き込みへ進みます。"
        : boardState === "running"
          ? this.stage === 2
            ? "STEP 2：動く同じ色を3つつなぎ、近くの花火へ爆発を届かせてから離します。"
            : "STEP 1：1本の指で押したまま、外輪が一周して選択数が増えるまで待ち、同じ色を3つつないで離します。"
          : boardState === "stage-transition"
            ? "STEP 1 成功。次は動く花火を3つつなぎ、近くの花火も巻き込みます。"
          : boardState === "expired"
            ? this.stage === 2
              ? "練習を中断しました。動く3つをつないで、近くの花火へ届かせてみましょう。"
              : "練習を中断しました。もう一度、3つをつないでみましょう。"
            : boardState === "success"
              ? "成功！爆発が近くの花火へ届きました。本番へ進めます。"
              : "練習を飛ばして、本番へ進みます。";
    }
    if (this.progressElement) this.progressElement.textContent = `${this.selectedIds.length} / ${PRACTICE_TARGET_COUNT}`;
    if (this.feedbackElement) {
      this.feedbackElement.textContent = !interactionAllowed
        ? "画面を確認すると練習を再開できます"
        : boardState === "success"
        ? "巻き込み成功：近くの花火にも爆発が届きました"
        : boardState === "expired"
          ? "もう一度挑戦できます"
          : this.lastFailureReason === "secondary-pointer-ignored"
            ? "2本目の指は無効です。最初の1本だけで操作してください"
            : this.lastFailureReason === "chain-out-of-range"
              ? "爆発が届きませんでした。黄色い花火へ近づいてから離してください"
            : this.selectedIds.length === 0
              ? "外輪が一周して選択数が増えるまで、各花火で短く止めてください"
              : this.selectedIds.length >= this.rules.minSelection
                ? this.stage === 2
                  ? `${this.selectedIds.length}個選択中。近くの花火へ届く位置で離します`
                  : `${this.selectedIds.length}個選択中。離すか2.5秒で自動起爆します`
                : `${this.selectedIds.length}個選択中。3個未満のまま2.5秒になると取消です`;
    }
    if (this.startButton) {
      const canBegin = ["ready", "expired", "success"].includes(boardState);
      this.startButton.hidden = !canBegin;
      this.startButton.disabled = !canBegin || !interactionAllowed;
      this.startButton.textContent = ["expired", "success"].includes(boardState)
        ? "もう一度練習する"
        : "練習を始める";
    }
    if (this.continueButton) {
      this.continueButton.hidden = boardState !== "success";
      this.continueButton.disabled = boardState !== "success" || !interactionAllowed;
    }
    if (this.skipButton) {
      this.skipButton.hidden = !["ready", "running", "stage-transition", "expired"].includes(boardState);
      this.skipButton.disabled = !interactionAllowed;
    }
  }

  snapshot() {
    return {
      state: this.state,
      remainingSeconds: this.remainingSeconds,
      durationSeconds: this.durationSeconds,
      selectedCount: this.selectedIds.length,
      selectedIds: [...this.selectedIds],
      targetCount: PRACTICE_TARGET_COUNT,
      stage: this.stage,
      stageCount: PRACTICE_STAGE_COUNT,
      stageDurations: [...this.stageDurations],
      chainCaptured: this.chainCaptured,
      hoverCandidateId: this.hoverCandidateId,
      hoverTicks: this.hoverTicks,
      inputTick: this.inputTick,
      selectionSinceTick: this.selectionSinceTick,
      selectionAgeTicks: this.selectionSinceTick === null
        ? 0
        : Math.max(0, this.inputTick - 1 - this.selectionSinceTick),
      lastInterruptReason: this.lastInterruptReason,
      lastFailureReason: this.lastFailureReason,
      interactionAllowed: this.isInteractionAllowed(),
      running: this.timerId !== null,
      pointer: { ...this.pointer.position },
    };
  }

  destroy() {
    this.stopTimer();
    this.stopSuccessTimer();
    this.pointer.destroy();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sound = null;
    this.onComplete = null;
    this.onSkip = null;
    this.startButton?.removeEventListener("click", this.handlers.start);
    this.skipButton?.removeEventListener("click", this.handlers.skip);
    this.continueButton?.removeEventListener("click", this.handlers.continue);
  }
}

export default TutorialController;
