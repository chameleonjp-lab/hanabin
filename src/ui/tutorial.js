export const PRACTICE_SECONDS = 12;
export const PRACTICE_TARGET_COUNT = 3;
export const PRACTICE_SUCCESS_DISPLAY_MS = 700;

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

/**
 * A small, fixed interaction board used only before the real game starts.
 * It verifies the same human action the product asks for: press, connect
 * three same-colour targets, then release to trigger a visible success.
 */
export class TutorialController {
  constructor(element, {
    durationSeconds = PRACTICE_SECONDS,
    onComplete = null,
    onSkip = null,
  } = {}) {
    if (!element) throw new TypeError("TutorialController requires a practice screen");
    this.element = element;
    this.boardElement = element.querySelector("#practice-board");
    this.canvas = element.querySelector("#practice-canvas");
    this.context = this.canvas?.getContext?.("2d");
    if (!this.canvas || !this.context) throw new TypeError("TutorialController requires a practice canvas");
    this.durationSeconds = Math.max(10, Math.min(15, Math.trunc(finite(durationSeconds))));
    this.onComplete = typeof onComplete === "function" ? onComplete : null;
    this.onSkip = typeof onSkip === "function" ? onSkip : null;
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.timerId = null;
    this.successTimeoutId = null;
    this.state = "ready";
    this.selectedIds = [];
    this.pointerId = null;
    this.pointerPressed = false;
    this.pointerPoint = null;
    this.valueElement = element.querySelector("#practice-value");
    this.messageElement = element.querySelector("#practice-message");
    this.progressElement = element.querySelector("#practice-progress");
    this.feedbackElement = element.querySelector("#practice-feedback");
    this.startButton = element.querySelector("#practice-start");
    this.skipButton = element.querySelector("#practice-skip");
    this.handlers = {
      pointerdown: (event) => this.handlePointerDown(event),
      pointermove: (event) => this.handlePointerMove(event),
      pointerup: (event) => this.handlePointerUp(event),
      pointercancel: (event) => this.handlePointerCancel(event),
      contextmenu: (event) => {
        if (event.cancelable) event.preventDefault();
      },
    };
    this.startButton?.addEventListener("click", () => this.begin());
    this.skipButton?.addEventListener("click", () => this.skip());
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      this.canvas.addEventListener(type, this.handlers[type], { passive: false });
    }
    this.canvas.addEventListener("contextmenu", this.handlers.contextmenu, { passive: false });
    this.canvas.style.touchAction = "none";
    this.canvas.dataset.practiceTargets = PRACTICE_TARGETS.map((target) => `${target.x},${target.y}`).join("|");
    this.render();
  }

  show() {
    this.stopTimer();
    this.stopSuccessTimer();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.state = "ready";
    this.clearPointer();
    this.selectedIds = [];
    this.render();
    return this.snapshot();
  }

  begin() {
    if (this.state === "running") return this.snapshot();
    if (!["ready", "expired"].includes(this.state)) return this.snapshot();
    this.stopSuccessTimer();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = Date.now();
    this.state = "running";
    this.clearPointer();
    this.selectedIds = [];
    this.render();
    this.timerId = setInterval(() => this.tick(), 250);
    return this.snapshot();
  }

  tick(now = Date.now()) {
    if (this.state !== "running" || this.startedAtMs === null) return this.snapshot();
    this.remainingSeconds = Math.max(0, this.durationSeconds - (now - this.startedAtMs) / 1000);
    if (this.remainingSeconds <= 0) {
      this.stopTimer();
      this.clearPointer();
      this.selectedIds = [];
      this.state = "expired";
    }
    this.render();
    return this.snapshot();
  }

  succeed() {
    if (this.state === "success" || this.state === "skipped") return this.snapshot();
    this.stopTimer();
    this.clearPointer();
    this.remainingSeconds = Math.max(0, this.remainingSeconds);
    this.state = "success";
    this.render();
    this.stopSuccessTimer();
    this.successTimeoutId = setTimeout(() => {
      this.successTimeoutId = null;
      this.onComplete?.({ skipped: false, selectedCount: this.selectedIds.length });
    }, PRACTICE_SUCCESS_DISPLAY_MS);
    return this.snapshot();
  }

  skip() {
    if (this.state === "skipped" || this.state === "success") return this.snapshot();
    this.stopTimer();
    this.stopSuccessTimer();
    this.clearPointer();
    this.selectedIds = [];
    this.state = "skipped";
    this.render();
    this.onSkip?.({ skipped: true });
    return this.snapshot();
  }

  pointFromEvent(event) {
    return normalizePracticePoint(
      event?.clientX,
      event?.clientY,
      this.canvas.getBoundingClientRect?.(),
    );
  }

  pointerIdFor(event) {
    return Number.isInteger(event?.pointerId) ? event.pointerId : 1;
  }

  handlePointerDown(event) {
    if (event.cancelable) event.preventDefault();
    if (this.state !== "running" || this.pointerId !== null) return;
    const point = this.pointFromEvent(event);
    if (!point) return;
    this.pointerId = this.pointerIdFor(event);
    this.pointerPressed = true;
    this.pointerPoint = point;
    try { this.canvas.setPointerCapture?.(this.pointerId); } catch { /* best effort */ }
    this.selectAtPoint(point);
    this.render();
  }

  handlePointerMove(event) {
    if (event.cancelable) event.preventDefault();
    if (!this.pointerPressed || this.pointerId !== this.pointerIdFor(event)) return;
    const point = this.pointFromEvent(event);
    if (!point) return;
    this.pointerPoint = point;
    this.selectAtPoint(point);
    this.render();
  }

  handlePointerUp(event) {
    if (event.cancelable) event.preventDefault();
    if (!this.pointerPressed || this.pointerId !== this.pointerIdFor(event)) return;
    const point = this.pointFromEvent(event);
    if (point) {
      this.pointerPoint = point;
      this.selectAtPoint(point);
    }
    const success = this.selectedIds.length >= PRACTICE_TARGET_COUNT;
    this.clearPointer();
    if (success) {
      this.succeed();
    } else {
      this.selectedIds = [];
      this.render();
    }
  }

  handlePointerCancel(event) {
    if (event.cancelable) event.preventDefault();
    if (this.pointerId !== this.pointerIdFor(event)) return;
    this.clearPointer();
    this.selectedIds = [];
    this.render();
  }

  selectAtPoint(point) {
    const first = PRACTICE_TARGETS.find((target) => this.selectedIds.includes(target.id));
    const candidates = PRACTICE_TARGETS
      .filter((target) => !this.selectedIds.includes(target.id))
      .map((target) => ({ target, distance: distanceSquared(point, target) }))
      .sort((left, right) => left.distance - right.distance);
    const candidate = candidates[0];
    if (!candidate || candidate.distance > 0.085 ** 2) return;
    if (first && candidate.target.color !== first.color) return;
    this.selectedIds.push(candidate.target.id);
  }

  clearPointer() {
    if (this.pointerId !== null) {
      try { this.canvas.releasePointerCapture?.(this.pointerId); } catch { /* best effort */ }
    }
    this.pointerId = null;
    this.pointerPressed = false;
    this.pointerPoint = null;
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
    const width = canvas.width;
    const height = canvas.height;
    const toCanvas = (target) => ({ x: target.x * width, y: target.y * height });
    const selected = new Set(this.selectedIds);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07132c");
    gradient.addColorStop(0.5, "#080b1c");
    gradient.addColorStop(1, "#120b28");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
      const radius = Math.max(18, width / 28);
      ctx.save();
      ctx.globalAlpha = isTarget ? 1 : 0.46;
      ctx.fillStyle = target.color;
      ctx.shadowColor = target.color;
      ctx.shadowBlur = isSelected ? radius * 1.8 : radius;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(4, 9, 23, 0.78)";
      ctx.font = `${Math.max(18, radius * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(target.symbol, point.x, point.y + 1);
      if (isSelected || this.state === "success" && isTarget) {
        ctx.strokeStyle = this.state === "success" ? "#75f0bb" : "#f8fcff";
        ctx.lineWidth = Math.max(3, radius * 0.12);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.pointerPressed && this.pointerPoint) {
      const point = { x: this.pointerPoint.x * width, y: this.pointerPoint.y * height };
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(8, width / 46), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const boardState = this.state;
    if (this.boardElement) this.boardElement.dataset.practiceState = boardState;
    canvas.dataset.practiceState = boardState;
    canvas.dataset.practiceSelectedCount = String(this.selectedIds.length);
    canvas.dataset.practiceRemaining = String(Math.ceil(this.remainingSeconds));
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
      this.messageElement.textContent = boardState === "ready"
        ? "まず練習を始め、光っている同じ色を3つなぞります。"
        : boardState === "running"
          ? "指を押したまま、赤い花火を3つ通ってから離します。"
          : boardState === "expired"
            ? "時間切れです。もう一度、3つをつないでみましょう。"
            : boardState === "success"
              ? "成功！3つの花火を巻き込めました。"
              : "練習を飛ばして、本番へ進みます。";
    }
    if (this.progressElement) this.progressElement.textContent = `${this.selectedIds.length} / ${PRACTICE_TARGET_COUNT}`;
    if (this.feedbackElement) {
      this.feedbackElement.textContent = boardState === "success"
        ? "巻き込み成功"
        : boardState === "expired"
          ? "もう一度挑戦できます"
          : this.selectedIds.length === 0
            ? "光っている3つをつないでください"
            : `${this.selectedIds.length}個選択中。指を離さないでください`;
    }
    if (this.startButton) {
      this.startButton.hidden = !["ready", "expired"].includes(boardState);
      this.startButton.disabled = !["ready", "expired"].includes(boardState);
      this.startButton.textContent = boardState === "expired" ? "もう一度練習する" : "練習を始める";
    }
    if (this.skipButton) {
      this.skipButton.hidden = !["ready", "running", "expired"].includes(boardState);
    }
  }

  snapshot() {
    return {
      state: this.state,
      remainingSeconds: this.remainingSeconds,
      durationSeconds: this.durationSeconds,
      selectedCount: this.selectedIds.length,
      targetCount: PRACTICE_TARGET_COUNT,
      running: this.timerId !== null,
    };
  }

  destroy() {
    this.stopTimer();
    this.stopSuccessTimer();
    this.clearPointer();
    this.onComplete = null;
    this.onSkip = null;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      this.canvas.removeEventListener(type, this.handlers[type]);
    }
    this.canvas.removeEventListener("contextmenu", this.handlers.contextmenu);
  }
}

export default TutorialController;
