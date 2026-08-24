import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEFAULT_RULES,
  mergeRules,
} from "../config/rules.js";
import { PointerController } from "../input/pointer-controller.js";
import { displayEntityRadius } from "../render/competitive-layer.js";

export const PRACTICE_SECONDS = 12;
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

export const practiceTargetBoardPoint = (target, {
  boardWidth = BOARD_WIDTH,
  boardHeight = BOARD_HEIGHT,
} = {}) => ({
  ...target,
  x: Math.round(target.x * boardWidth),
  y: Math.round(target.y * boardHeight),
});

/** Return the same nearest, same-colour, circular candidate used by play. */
export const findPracticeCandidate = (
  point,
  selectedIds = [],
  rulesArg = DEFAULT_RULES,
) => {
  if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) return null;
  const rules = mergeRules(rulesArg);
  const selected = new Set(selectedIds.map(String));
  const targets = PRACTICE_TARGETS.map((target) => practiceTargetBoardPoint(target, rules));
  const first = targets.find((target) => selected.has(String(target.id))) ?? null;
  const lastId = selectedIds.at(-1);
  const last = targets.find((target) => String(target.id) === String(lastId)) ?? null;
  const hitRadiusSquared = rules.selectionHitRadius ** 2;
  const linkRadiusSquared = rules.selectionLinkDistance ** 2;
  return targets
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
  } = {}) {
    if (!element) throw new TypeError("TutorialController requires a practice screen");
    this.element = element;
    this.boardElement = element.querySelector("#practice-board");
    this.canvas = element.querySelector("#practice-canvas");
    this.context = this.canvas?.getContext?.("2d");
    if (!this.canvas || !this.context) throw new TypeError("TutorialController requires a practice canvas");
    this.rules = mergeRules(rules);
    this.durationSeconds = Math.max(10, Math.min(15, Math.trunc(finite(durationSeconds))));
    this.onComplete = typeof onComplete === "function" ? onComplete : null;
    this.onSkip = typeof onSkip === "function" ? onSkip : null;
    this.sound = sound;
    this.isInteractionAllowed = typeof isInteractionAllowed === "function"
      ? isInteractionAllowed
      : () => true;
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.timerId = null;
    this.successTimeoutId = null;
    this.state = "ready";
    this.selectedIds = [];
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

  resetGesture({ clearSelection = true } = {}) {
    this.gesturePressed = false;
    this.hoverCandidateId = null;
    this.hoverTicks = 0;
    this.selectionSinceTick = null;
    this.tracePoint = null;
    this.traceDistanceCarry = 0;
    if (clearSelection) this.selectedIds = [];
  }

  show() {
    this.stopTimer();
    this.stopSuccessTimer();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.state = "ready";
    this.pointer.clear();
    this.resetGesture();
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
    this.advanceInputTicks(1, { render: false });
    this.remainingSeconds = Math.max(0, this.durationSeconds - (now - this.startedAtMs) / 1000);
    if (this.remainingSeconds <= 0) {
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

  consumeInputFrame(frame) {
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
        this.succeed();
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
        this.succeed();
      } else {
        this.resetGesture();
        this.lastFailureReason = "selection-timeout";
        this.sound?.cancel?.({ reason: this.lastFailureReason });
      }
      return;
    }
    const candidate = findPracticeCandidate(frame, this.selectedIds, this.rules);
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
    this.stopTimer();
    this.resetGesture();
    this.remainingSeconds = Math.max(0, this.remainingSeconds);
    this.lastInterruptReason = reason;
    this.lastFailureReason = reason;
    this.state = "expired";
    this.sound?.cancel?.({ reason });
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
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    const toCanvas = (target) => ({ x: target.x * width, y: target.y * height });
    const boardToCanvas = (point) => ({
      x: point.x / this.rules.boardWidth * width,
      y: point.y / this.rules.boardHeight * height,
    });
    const selected = new Set(this.selectedIds);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07132c");
    gradient.addColorStop(0.5, "#080b1c");
    gradient.addColorStop(1, "#120b28");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#8ca6e8";
    ctx.lineWidth = 1;
    for (let x = width / 4; x < width; x += width / 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = height / 3; y < height; y += height / 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    if (this.selectedIds.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 113, 143, 0.95)";
      ctx.shadowColor = "rgba(255, 113, 143, 0.8)";
      ctx.shadowBlur = 18;
      ctx.lineWidth = Math.max(5, width / 150);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      this.selectedIds.forEach((id, index) => {
        const target = PRACTICE_TARGETS.find((candidate) => candidate.id === id);
        const point = toCanvas(target);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    for (const target of [...PRACTICE_DECOYS, ...PRACTICE_TARGETS]) {
      const point = toCanvas(target);
      const isTarget = "id" in target;
      const isSelected = isTarget && selected.has(target.id);
      const isHovered = isTarget && target.id === this.hoverCandidateId;
      const scale = Math.min(width / this.rules.boardWidth, height / this.rules.boardHeight);
      const radius = displayEntityRadius(scale, this.rules);
      ctx.save();
      ctx.globalAlpha = isTarget ? 1 : 0.46;
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
      if (isSelected || this.state === "success" && isTarget) {
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
      ctx.arc(aim.x, aim.y, Math.max(8, width / 46), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const boardState = this.state;
    const interactionAllowed = this.isInteractionAllowed();
    if (this.boardElement) this.boardElement.dataset.practiceState = boardState;
    canvas.dataset.practiceState = boardState;
    canvas.dataset.practiceSelectedCount = String(this.selectedIds.length);
    canvas.dataset.practiceRemaining = String(Math.ceil(this.remainingSeconds));
    canvas.dataset.practiceInputTick = String(this.inputTick);
    canvas.dataset.practiceHoverCandidate = this.hoverCandidateId ?? "";
    canvas.dataset.practiceHoverTicks = String(this.hoverTicks);
    canvas.dataset.practiceTargetRadius = String(displayEntityRadius(
      Math.min(width / this.rules.boardWidth, height / this.rules.boardHeight),
      this.rules,
    ));
    canvas.dataset.practiceLastInterrupt = this.lastInterruptReason;
    canvas.dataset.practiceLastFailure = this.lastFailureReason;
    if (this.valueElement) {
      this.valueElement.textContent = boardState === "ready"
        ? `${this.durationSeconds}秒`
        : boardState === "running"
          ? String(Math.max(1, Math.ceil(this.remainingSeconds)))
          : boardState === "expired"
            ? "再挑戦"
            : boardState === "success"
              ? "成功"
              : "準備OK";
    }
    if (this.messageElement) {
      this.messageElement.textContent = !interactionAllowed
        ? "縦画面では練習できません。iPhoneを横向きにしてください。"
        : boardState === "ready"
        ? "まず練習を始め、光っている同じ色を3つなぞります。"
        : boardState === "running"
          ? "1本の指で押したまま、外輪が一周して選択数が増えるまで待ち、赤い花火を3つつないで離します。3つ以上は2.5秒でも自動起爆します。"
          : boardState === "expired"
            ? "練習を中断しました。もう一度、3つをつないでみましょう。"
            : boardState === "success"
              ? "成功！何度でも練習するか、本番へ進めます。"
              : "練習を飛ばして、本番へ進みます。";
    }
    if (this.progressElement) this.progressElement.textContent = `${this.selectedIds.length} / ${PRACTICE_TARGET_COUNT}`;
    if (this.feedbackElement) {
      this.feedbackElement.textContent = !interactionAllowed
        ? "横向きにすると練習を再開できます"
        : boardState === "success"
        ? "巻き込み成功"
        : boardState === "expired"
          ? "もう一度挑戦できます"
          : this.lastFailureReason === "secondary-pointer-ignored"
            ? "2本目の指は無効です。最初の1本だけで操作してください"
            : this.selectedIds.length === 0
              ? "外輪が一周して選択数が増えるまで、各花火で短く止めてください"
              : this.selectedIds.length >= this.rules.minSelection
                ? `${this.selectedIds.length}個選択中。離すか2.5秒で自動起爆します`
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
      this.skipButton.hidden = !["ready", "running", "expired"].includes(boardState);
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
