export const PRACTICE_SECONDS = 12;

const finite = (value, fallback = PRACTICE_SECONDS) => Number.isFinite(Number(value))
  ? Number(value)
  : fallback;

/**
 * Product-shell tutorial. It teaches the gesture outside the deterministic
 * game session, so practice timers and copy never enter replay data.
 */
export class TutorialController {
  constructor(element, {
    durationSeconds = PRACTICE_SECONDS,
    onComplete = null,
    onSkip = null,
  } = {}) {
    if (!element) throw new TypeError("TutorialController requires a practice screen");
    this.element = element;
    this.durationSeconds = Math.max(10, Math.min(15, Math.trunc(finite(durationSeconds))));
    this.onComplete = typeof onComplete === "function" ? onComplete : null;
    this.onSkip = typeof onSkip === "function" ? onSkip : null;
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.timerId = null;
    this.state = "ready";
    this.valueElement = element.querySelector("#practice-value");
    this.messageElement = element.querySelector("#practice-message");
    this.startButton = element.querySelector("#practice-start");
    this.skipButton = element.querySelector("#practice-skip");
    this.startButton?.addEventListener("click", () => this.begin());
    this.skipButton?.addEventListener("click", () => this.skip());
    this.render();
  }

  show() {
    this.stopTimer();
    this.remainingSeconds = this.durationSeconds;
    this.startedAtMs = null;
    this.state = "ready";
    this.render();
    return this.snapshot();
  }

  begin() {
    if (this.state === "running") return this.snapshot();
    if (this.state === "complete" || this.state === "skipped") return this.snapshot();
    this.state = "running";
    this.startedAtMs = Date.now();
    this.render();
    this.timerId = setInterval(() => this.tick(), 250);
    return this.snapshot();
  }

  tick(now = Date.now()) {
    if (this.state !== "running" || this.startedAtMs === null) return this.snapshot();
    this.remainingSeconds = Math.max(0, this.durationSeconds - (now - this.startedAtMs) / 1000);
    if (this.remainingSeconds <= 0) {
      this.complete();
    } else {
      this.render();
    }
    return this.snapshot();
  }

  complete(force = false) {
    if (this.state === "complete") return this.snapshot();
    if (!force && this.state !== "running" && this.state !== "ready") return this.snapshot();
    if (!force && this.remainingSeconds > 0) return this.snapshot();
    this.stopTimer();
    this.remainingSeconds = 0;
    this.state = "complete";
    this.render();
    this.onComplete?.({ skipped: false });
    return this.snapshot();
  }

  skip() {
    if (this.state === "skipped" || this.state === "complete") return this.snapshot();
    this.stopTimer();
    this.state = "skipped";
    this.render();
    this.onSkip?.({ skipped: true });
    return this.snapshot();
  }

  stopTimer() {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
  }

  render() {
    this.element.dataset.practiceState = this.state;
    this.element.dataset.practiceRemaining = String(Math.ceil(this.remainingSeconds));
    if (this.valueElement) {
      this.valueElement.textContent = this.state === "ready"
        ? `${this.durationSeconds}秒`
        : this.state === "complete" || this.state === "skipped"
          ? "準備OK"
          : String(Math.max(1, Math.ceil(this.remainingSeconds)));
    }
    if (this.messageElement) {
      this.messageElement.textContent = this.state === "ready"
        ? "3つ以上を同じ色でなぞり、指を離して起爆します。"
        : this.state === "running"
          ? "画面の手順を読みながら、操作を覚えましょう。"
          : "それでは本番を始めましょう。";
    }
    if (this.startButton) {
      this.startButton.hidden = this.state !== "ready";
      this.startButton.disabled = this.state !== "ready";
    }
    if (this.skipButton) {
      this.skipButton.hidden = this.state !== "ready" && this.state !== "running";
    }
  }

  snapshot() {
    return {
      state: this.state,
      remainingSeconds: this.remainingSeconds,
      durationSeconds: this.durationSeconds,
      running: this.timerId !== null,
    };
  }

  destroy() {
    this.stopTimer();
    this.onComplete = null;
    this.onSkip = null;
  }
}

export default TutorialController;
