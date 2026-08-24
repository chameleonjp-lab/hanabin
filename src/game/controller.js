import { DEFAULT_RULES, mergeRules } from "../config/rules.js";
import { replayGame } from "../core/replay.js";
import { PointerController } from "../input/pointer-controller.js";
import { CanvasRenderer } from "../render/canvas-renderer.js";
import { SoundController } from "../audio/sound.js";
import { detectPresentationExperience } from "../presentation/experience.js";
import { createProfileStore, sanitizePlayerName } from "../storage/local-storage.js";
import { GameSession } from "./session.js";
import { PresentationEventTracker } from "./presentation-events.js";
import { updateHud, updatePlayMessage } from "../ui/hud.js";
import { copyShareText, publicUrlFor, renderResult } from "../ui/result.js";
import { renderRulesGuide } from "../ui/rules-guide.js";
import ScreenController from "../ui/screens.js";
import { TutorialController } from "../ui/tutorial.js";

const FRAME_MS = 1000 / 60;
const COUNTDOWN_SECONDS = 3;
const MAX_TICKS_PER_FRAME = 12;
const MAX_CLOCK_BACKLOG_MS = 1_000;
const QUALITY_LABELS = Object.freeze({ high: "高", medium: "中", low: "低" });
const SOUND_METHODS = Object.freeze({
  trace: "trace",
  select: "selection",
  detonate: "detonation",
  chain: "chain",
  milestone: "milestone",
  spawn: "spawn",
  expire: "expire",
  score: "score",
  cancel: "cancel",
});

export const isClockBacklogUnsafe = (value) =>
  !Number.isFinite(value) || value > MAX_CLOCK_BACKLOG_MS;

export const toScreenPhase = (phase) => {
  if (phase === "playing") return "play";
  if (phase === "fault") return "result";
  return phase;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const nowMs = () => typeof performance !== "undefined" && Number.isFinite(performance.now())
  ? performance.now()
  : 0;

/**
 * Connects DOM, Canvas, Pointer Events and the deterministic GameSession.
 * requestAnimationFrame is presentation scheduling only; game ticks are
 * consumed in a separate accumulator and never use render-frame count.
 */
export class GameController {
  constructor({
    root,
    canvas,
    rules = DEFAULT_RULES,
    seed = 1,
  } = {}) {
    if (!root || !canvas) throw new TypeError("GameController requires root and canvas");
    this.root = root;
    this.canvas = canvas;
    this.rules = mergeRules(rules);
    this.defaultSeed = Number(seed) >>> 0 || 1;
    this.nextSeed = this.defaultSeed;
    this.profileStore = createProfileStore();
    this.profile = this.profileStore.load();
    if (this.profile.bestRuleVersion !== this.rules.ruleVersion) {
      this.profile = this.profileStore.update({
        bestScore: 0,
        bestChain: 0,
        bestRuleVersion: this.rules.ruleVersion,
      });
    }
    this.experience = detectPresentationExperience();
    this.screens = new ScreenController(root);
    this.renderer = new CanvasRenderer(canvas, {
      boardWidth: this.rules.boardWidth,
      boardHeight: this.rules.boardHeight,
      quality: this.profile.quality,
      autoQuality: !this.profile.qualityManual,
      variant: this.experience.variant,
      reducedMotion: this.experience.reducedMotion,
    });
    this.sound = new SoundController({
      enabled: this.profile.soundEnabled,
      variant: this.experience.variant,
    });
    this.presentationEvents = new PresentationEventTracker();
    this.presentationUpdateCount = 0;
    this.presentationEventCounts = {};
    this.pointer = new PointerController(canvas, {
      boardWidth: this.rules.boardWidth,
      boardHeight: this.rules.boardHeight,
      onChange: (change) => this.handlePointerChange(change),
      onInterrupt: (reason) => this.handlePointerInterrupt(reason),
      isInputAllowed: () => this.inputAllowed(),
    });
    this.session = new GameSession({
      seed: this.nextSeed,
      rules: this.rules,
      pointer: this.pointer,
      onPhaseChange: (phase, previous) => this.handlePhaseChange(phase, previous),
      // Consume event deltas at every fixed-tick boundary so an intermediate
      // select/detonate action cannot be overwritten before its SE is seen.
      // Canvas/HUD rendering remains batched after frame()/advanceTicks().
      onUpdate: (session) => this.handleSessionUpdate(session),
    });
    this.hud = root.querySelector("#game-hud");
    this.status = root.querySelector("#app-status");
    this.playMessage = root.querySelector("#play-message");
    this.countdownValue = root.querySelector("#countdown-value");
    this.countdownMessage = root.querySelector("#countdown-message");
    this.resultScore = root.querySelector("#result-score");
    this.resultChain = root.querySelector("#result-chain");
    this.resultDetonations = root.querySelector("#result-detonations");
    this.resultDirect = root.querySelector("#result-direct");
    this.resultChainTargets = root.querySelector("#result-chain-targets");
    this.resultReplay = root.querySelector("#result-replay");
    this.playerNameInput = root.querySelector("#player-name");
    this.profileError = root.querySelector("#profile-error");
    this.homeBestScore = root.querySelector("#home-best-score");
    this.homeBestChain = root.querySelector("#home-best-chain");
    this.qualitySelect = root.querySelector("#quality-select");
    this.qualityActiveLabel = root.querySelector("#quality-active-label");
    this.soundToggle = root.querySelector("#sound-toggle");
    this.resumeOverlay = root.querySelector("#resume-overlay");
    this.resumeValue = root.querySelector("#resume-value");
    this.shareButton = root.querySelector("#share-button");
    this.shareStatus = root.querySelector("#share-status");
    this.startButton = root.querySelector("#start-button");
    this.practiceButton = root.querySelector("#practice-button");
    this.practiceHomeButton = root.querySelector("#practice-home");
    this.retryButton = root.querySelector("#retry-button");
    this.homeButton = root.querySelector("#home-button");
    this.pendingStartSeed = null;
    this.resumeStartedMs = null;
    this.resumeDurationMs = 3_000;
    this.lastPersistedResultKey = "";
    this.lastBestScore = false;
    this.practiceReturnsHome = false;
    this.pointerHintText = "";
    this.pointerHintUntilMs = 0;
    this.tutorial = new TutorialController(root.querySelector("#practice-screen"), {
      rules: this.rules,
      sound: this.sound,
      isInteractionAllowed: () => !this.isPortrait(),
      onComplete: () => this.finishPractice(false),
      onSkip: () => this.finishPractice(true),
    });
    this.rafId = null;
    this.running = false;
    this.clockPaused = false;
    this.resumePendingFrame = false;
    this.interruptPending = false;
    this.accumulatorMs = 0;
    this.lastFrameMs = null;
    this.countdownStartedMs = null;
    this.countdownPausedAtMs = null;
    this.finalizeOnFrame = false;
    this.resultOnFrame = false;
    this.deterministicTestMode = false;
    this.destroyed = false;
    this.renderCount = 0;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundPageShow = () => this.handlePageShow();
    this.boundResize = () => {
      this.refreshPresentationExperience();
      this.renderer.resize();
      if (this.screens.phase === "practice") this.tutorial.resizeCanvas();
      this.render();
    };
    this.transitions = this.screens.history();

    this.playerNameInput?.addEventListener("input", () => this.validateNameField());
    this.qualitySelect?.addEventListener("change", () => this.setQualityPreference(this.qualitySelect.value));
    this.soundToggle?.addEventListener("change", () => {
      this.setSoundEnabled(this.soundToggle.checked);
      if (this.soundToggle.checked) void this.sound.unlock();
    });
    this.startButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.requestStart();
    });
    this.practiceButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.openPractice({ returnHome: false });
    });
    this.practiceHomeButton?.addEventListener("click", () => this.goHome());
    this.retryButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.start();
    });
    this.homeButton?.addEventListener("click", () => this.goHome());
    this.shareButton?.addEventListener("click", () => this.shareResult());
    // The pointer adapter owns the marker; this listener only resumes the
    // wall-clock accumulator and intentionally never catches up hidden time.
    document.addEventListener("visibilitychange", this.boundVisibility, { passive: true });
    window.addEventListener("pageshow", this.boundPageShow, { passive: true });
    window.addEventListener("resize", this.boundResize, { passive: true });
    renderRulesGuide(this.root, this.rules);
    this.applyProfileToControls();
    this.applyExperienceToRoot();
    this.render();
  }

  applyProfileToControls() {
    if (this.playerNameInput) this.playerNameInput.value = this.profile.name;
    if (this.qualitySelect) {
      this.qualitySelect.value = this.profile.qualityManual ? this.profile.quality : "auto";
    }
    if (this.soundToggle) this.soundToggle.checked = this.profile.soundEnabled;
    this.updateHomeBest();
    this.root.dataset.soundEnabled = this.profile.soundEnabled ? "true" : "false";
    this.root.dataset.practiceComplete = this.profile.practiceCompleted || this.profile.practiceSkipped
      ? "true"
      : "false";
    this.updateQualityLabel();
  }

  applyExperienceToRoot() {
    this.root.dataset.presentationVariant = this.experience.variant;
    this.root.dataset.reducedMotion = this.experience.reducedMotion ? "true" : "false";
    this.updateQualityLabel();
  }

  refreshPresentationExperience() {
    const next = detectPresentationExperience();
    const changed = next.variant !== this.experience.variant ||
      next.reducedMotion !== this.experience.reducedMotion;
    this.experience = next;
    if (changed) {
      this.renderer.setExperience(next);
      this.sound.setVariant(next.variant);
    }
    this.applyExperienceToRoot();
    return changed;
  }

  updateQualityLabel() {
    const snapshot = this.renderer?.qualityController?.snapshot?.();
    if (!snapshot) return;
    const mode = snapshot.auto ? "自動調整" : "固定";
    const device = snapshot.variant === "desktop" ? "PCリッチ演出" : "スマホ軽量演出";
    if (this.qualityActiveLabel) {
      this.qualityActiveLabel.textContent = `${mode}：${QUALITY_LABELS[snapshot.level] ?? snapshot.level} / ${device}`;
    }
  }

  updateHomeBest() {
    if (this.homeBestScore) this.homeBestScore.textContent = Math.max(0, Math.trunc(this.profile.bestScore ?? 0)).toLocaleString("ja-JP");
    if (this.homeBestChain) this.homeBestChain.textContent = String(Math.max(0, Math.trunc(this.profile.bestChain ?? 0)));
  }

  validateNameField() {
    const raw = this.playerNameInput?.value ?? "";
    const valid = raw.trim() === "" || sanitizePlayerName(raw) !== "";
    if (this.profileError) this.profileError.hidden = valid;
    return valid;
  }

  persistProfileControls() {
    if (!this.validateNameField()) return false;
    const name = sanitizePlayerName(this.playerNameInput?.value ?? this.profile.name);
    this.profile = this.profileStore.update({
      name,
      soundEnabled: this.soundToggle?.checked ?? this.profile.soundEnabled,
    });
    this.sound.setEnabled(this.profile.soundEnabled);
    this.updateHomeBest();
    this.applyProfileToControls();
    return true;
  }

  setPlayerName(value) {
    const normalized = sanitizePlayerName(String(value ?? ""));
    if (String(value ?? "").trim() && !normalized) {
      if (this.profileError) this.profileError.hidden = false;
      return false;
    }
    if (this.playerNameInput) this.playerNameInput.value = normalized;
    this.profile = this.profileStore.update({ name: normalized });
    if (this.profileError) this.profileError.hidden = true;
    return true;
  }

  setQuality(level) {
    const snapshot = this.renderer.setQuality(level);
    this.renderer.setAutoQuality(false);
    this.profile = this.profileStore.update({ quality: snapshot.level, qualityManual: true });
    if (this.qualitySelect) this.qualitySelect.value = snapshot.level;
    this.updateQualityLabel();
    return snapshot;
  }

  setQualityPreference(value) {
    if (value === "auto") {
      this.renderer.setAutoQuality(true);
      const snapshot = this.renderer.qualityController.snapshot();
      this.profile = this.profileStore.update({
        quality: snapshot.level,
        qualityManual: false,
      });
      if (this.qualitySelect) this.qualitySelect.value = "auto";
      this.updateQualityLabel();
      return snapshot;
    }
    return this.setQuality(value);
  }

  setSoundEnabled(enabled) {
    const value = this.sound.setEnabled(enabled);
    this.profile = this.profileStore.update({ soundEnabled: value });
    if (this.soundToggle) this.soundToggle.checked = value;
    this.root.dataset.soundEnabled = value ? "true" : "false";
    return value;
  }

  handlePointerChange(change = {}) {
    if (["pointerdown", "pointerdown-queued-after-boundary"].includes(change.type)) {
      void this.sound.unlock();
      this.sound.tap(change);
    }
    if (change.type === "secondary-pointer-ignored") {
      this.pointerHintText = "操作は1本指のみです。最初の指をそのまま使ってください";
      this.pointerHintUntilMs = nowMs() + 1_200;
    } else if (change.type === "pointerdown-ignored-pending-boundary") {
      this.pointerHintText = "短い連続タップでは選択しません。外輪が一周するまで押してください";
      this.pointerHintUntilMs = nowMs() + 1_200;
    }
    // Production pointer events only update the sampler and immediate SE.
    // The active rAF loop paints the latest point once; rendering every
    // pointermove would add a second paint path on 120 Hz Safari devices.
    if (this.deterministicTestMode) this.render();
    else this.ensureLoop();
  }

  playPresentationEvents(state) {
    for (const event of this.presentationEvents.consume(state)) {
      this.presentationEventCounts[event.type] =
        (this.presentationEventCounts[event.type] ?? 0) + 1;
      const method = SOUND_METHODS[event.type];
      if (method && typeof this.sound[method] === "function") this.sound[method](event);
    }
  }

  handleSessionUpdate(session) {
    this.presentationUpdateCount += 1;
    this.playPresentationEvents(session?.state);
  }

  openPractice({ returnHome = false, seed = null } = {}) {
    if (this.destroyed || this.isPortrait()) {
      if (this.status && this.isPortrait()) this.status.textContent = "横向きにしてから練習してください";
      return null;
    }
    this.practiceReturnsHome = returnHome === true;
    this.pendingStartSeed = this.practiceReturnsHome ? null : seed;
    this.tutorial.show();
    this.screens.show("practice", this.screens.phase);
    this.tutorial.resizeCanvas();
    this.tutorial.render();
    if (this.status) this.status.textContent = "何度でも操作を練習できます";
    this.render();
    return this.tutorial.snapshot();
  }

  requestStart(seed = null) {
    if (!this.persistProfileControls()) return null;
    if (this.isPortrait()) {
      if (this.status) this.status.textContent = "横向きにしてから開始してください";
      return null;
    }
    if (!this.profile.practiceCompleted && !this.profile.practiceSkipped) {
      this.openPractice({ returnHome: false, seed });
      if (this.status) this.status.textContent = "最初の操作を練習しましょう";
      return null;
    }
    return this.start(seed);
  }

  finishPractice(skipped = false) {
    if (!this.practiceReturnsHome || skipped !== true) {
      this.profile = this.profileStore.update({
        practiceCompleted: skipped !== true,
        practiceSkipped: skipped === true,
      });
    }
    this.applyProfileToControls();
    if (this.practiceReturnsHome) {
      this.practiceReturnsHome = false;
      this.pendingStartSeed = null;
      this.goHome();
      return this.session.state;
    }
    const seed = this.pendingStartSeed;
    this.pendingStartSeed = null;
    return this.start(seed);
  }

  updateResumePresentation(remainingSeconds = null) {
    if (!this.resumeOverlay) return;
    const active = remainingSeconds !== null && remainingSeconds > 0;
    this.resumeOverlay.hidden = !active;
    if (active && this.resumeValue) this.resumeValue.textContent = String(Math.max(1, Math.ceil(remainingSeconds)));
  }

  isResumeGateActive() {
    return !this.deterministicTestMode && this.resumeStartedMs !== null;
  }

  async shareResult() {
    const text = this.shareButton?.dataset.shareText ?? "";
    const copied = await copyShareText(text);
    if (this.shareStatus) this.shareStatus.textContent = copied ? "共有文を準備しました" : "共有文を準備できませんでした";
    return copied;
  }

  get phase() {
    return this.session.phase;
  }

  handlePhaseChange(phase, previous) {
    const screenPhase = toScreenPhase(phase);
    this.screens.show(screenPhase, toScreenPhase(previous));
    // The play canvas is hidden during home, practice, and countdown. Resize
    // it after the play screen becomes visible so the first rendered frame
    // uses the real CSS geometry instead of the 1600x900 fallback.
    if (screenPhase === "play") this.renderer.resize();
    this.root.dataset.phase = phase;
    this.transitions = this.screens.history();
    if (phase === "home") {
      if (this.status) this.status.textContent = "静的ページの読み込みが完了しました";
    } else if (phase === "countdown") {
      if (this.status) this.status.textContent = "開始準備中…";
    } else if (phase === "playing") {
      if (this.status) this.status.textContent = "プレイ中 — 60秒";
    } else if (phase === "finalizing") {
      if (this.status) this.status.textContent = "連鎖を確定中…";
      this.finalizeOnFrame = true;
    } else if (phase === "result") {
      if (this.status) this.status.textContent = "プレイ結果";
      this.populateResult();
    } else if (phase === "fault") {
      if (this.status) this.status.textContent = "判定エラー";
      this.populateResult();
    }
    this.render();
  }

  handlePointerInterrupt(reason) {
    // No state is mutated here. The sampler's cancelled/interrupted marker is
    // consumed by exactly one next fixed tick in GameSession.nextFrame().
    this.interruptPending = true;
    // Losing capture ends only the active gesture; it is not a page lifecycle
    // boundary and must not stop the fixed-tick clock indefinitely.
    if (["visibilitychange", "pagehide", "orientationchange"].includes(reason)) {
      this.pauseClock(reason);
    }
    if (reason === "input-disabled" && this.phase === "finalizing" && !this.clockPaused) {
      // A held pointer is released after the fixed tick boundary. The
      // terminal presentation can now advance, but must remain visible until
      // that release has happened so the boundary is observable.
      this.ensureLoop();
    }
  }

  isPortrait() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
      window.matchMedia("(orientation: portrait)").matches;
  }

  inputAllowed() {
    return this.phase === "playing" && !this.clockPaused && !this.isPortrait() &&
      !this.isResumeGateActive() &&
      (typeof document === "undefined" || document.visibilityState === "visible");
  }

  handleOrientation({ portrait } = {}) {
    // The practice controller owns its own clock, but shares the same
    // landscape-only product contract and must update its controls too.
    if (portrait === true || this.isPortrait()) {
      if (this.tutorial?.state === "running") {
        this.tutorial.handlePointerLifecycle("orientationchange");
      } else {
        this.tutorial?.render();
      }
      this.pauseClock("orientationchange");
      this.pointer.interrupt("orientationchange");
      return;
    }
    this.tutorial?.render();
    if (["countdown", "playing", "finalizing"].includes(this.phase) &&
        document.visibilityState === "visible") {
      this.resumeClock();
    }
  }

  pauseClock() {
    if (this.phase === "countdown" && this.countdownPausedAtMs === null) {
      this.countdownPausedAtMs = nowMs();
    }
    this.clockPaused = true;
    this.resumePendingFrame = true;
    this.resumeStartedMs = null;
    this.updateResumePresentation(null);
    this.lastFrameMs = null;
    this.accumulatorMs = 0;
    this.renderer.resetFrameObservation();
    this.stopLoop();
  }

  resumeClock() {
    if (this.isPortrait() || (document.visibilityState !== "visible" && !this.deterministicTestMode)) return;
    if (this.phase === "countdown") {
      if (this.countdownPausedAtMs !== null && this.countdownStartedMs !== null) {
        this.countdownStartedMs += nowMs() - this.countdownPausedAtMs;
      }
      this.countdownPausedAtMs = null;
      this.clockPaused = false;
      this.lastFrameMs = null;
      this.accumulatorMs = 0;
      this.renderer.resetFrameObservation();
      this.resumeStartedMs = null;
      this.updateResumePresentation(null);
      this.ensureLoop();
      return;
    }
    // Page visibility can change while the two-frame terminal presentation is
    // in progress. Resume that presentation without sampling another input
    // frame or adding hidden time to the play clock.
    if (this.phase === "finalizing") {
      this.clockPaused = false;
      this.lastFrameMs = null;
      this.accumulatorMs = 0;
      this.renderer.resetFrameObservation();
      this.resumePendingFrame = false;
      this.resumeStartedMs = null;
      this.updateResumePresentation(null);
      this.ensureLoop();
      return;
    }
    if (this.phase !== "playing") return;
    this.clockPaused = false;
    this.lastFrameMs = null;
    this.accumulatorMs = 0;
    this.renderer.resetFrameObservation();
    this.resumePendingFrame = true;
    this.resumeStartedMs = this.deterministicTestMode ? null : nowMs();
    if (this.resumeStartedMs !== null) this.updateResumePresentation(3);
    if (!this.deterministicTestMode) this.ensureLoop();
  }

  handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      this.pauseClock("visibilitychange");
      this.pointer.interrupt("visibilitychange");
      return;
    }
    if (!this.clockPaused) return;
    // Start a new wall-clock interval. No elapsed hidden duration is added to
    // the accumulator and no catch-up burst is generated.
    this.resumeClock();
  }

  handlePageShow() {
    if (document.visibilityState === "visible") this.resumeClock();
  }

  start(seed = null) {
    if (this.destroyed) return null;
    if (this.isPortrait()) {
      if (this.status) this.status.textContent = "横向きにしてから開始してください";
      return null;
    }
    if (seed !== null && Number.isFinite(Number(seed))) {
      this.nextSeed = Math.trunc(Number(seed)) >>> 0 || 1;
    }
    const runSeed = this.nextSeed;
    this.nextSeed = (runSeed + 1) >>> 0 || 1;
    this.pointer.clear();
    this.clockPaused = false;
    this.resumePendingFrame = false;
    this.resumeStartedMs = null;
    this.updateResumePresentation(null);
    this.interruptPending = false;
    this.accumulatorMs = 0;
    this.lastFrameMs = null;
    this.renderer.resetFrameObservation();
    this.finalizeOnFrame = false;
    this.resultOnFrame = false;
    this.presentationEvents.reset();
    this.presentationUpdateCount = 0;
    this.presentationEventCounts = {};
    this.pointerHintText = "";
    this.pointerHintUntilMs = 0;
    this.lastPersistedResultKey = "";
    this.lastBestScore = false;
    this.shareStatus && (this.shareStatus.textContent = "");
    this.countdownStartedMs = nowMs();
    this.countdownPausedAtMs = null;
    this.session.prepare(runSeed);
    if (!this.deterministicTestMode) this.ensureLoop();
    return this.session.state;
  }

  goHome() {
    if (this.destroyed) return;
    this.pointer.clear();
    this.clockPaused = false;
    this.resumePendingFrame = false;
    this.resumeStartedMs = null;
    this.updateResumePresentation(null);
    this.interruptPending = false;
    this.accumulatorMs = 0;
    this.lastFrameMs = null;
    this.renderer.resetFrameObservation();
    this.countdownStartedMs = null;
    this.countdownPausedAtMs = null;
    this.finalizeOnFrame = false;
    this.resultOnFrame = false;
    this.pendingStartSeed = null;
    this.practiceReturnsHome = false;
    this.presentationEvents.reset();
    this.presentationUpdateCount = 0;
    this.presentationEventCounts = {};
    this.pointerHintText = "";
    this.pointerHintUntilMs = 0;
    this.tutorial.show();
    this.session.goHome();
    if (this.screens.phase !== "home") {
      this.screens.show("home", this.screens.phase);
      this.root.dataset.phase = "home";
      this.transitions = this.screens.history();
      if (this.status) this.status.textContent = "静的ページの読み込みが完了しました";
      this.render();
    }
    this.stopLoop();
  }

  ensureLoop() {
    if (this.destroyed || this.rafId !== null) return;
    this.running = true;
    this.rafId = requestAnimationFrame((time) => this.frame(time));
  }

  stopLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.running = false;
  }

  frame(timestamp) {
    this.rafId = null;
    if (this.destroyed) return;
    const timestampMs = Number.isFinite(timestamp) ? timestamp : nowMs();
    this.renderer.observeAnimationFrame(timestampMs);
    if (this.phase === "countdown") {
      if (this.clockPaused) {
        this.render();
        return;
      }
      const started = this.countdownStartedMs ?? timestampMs;
      const remaining = Math.max(0, COUNTDOWN_SECONDS - (timestampMs - started) / 1000);
      this.updateCountdownPresentation(remaining);
      this.session.updateCountdown(remaining);
      if (this.phase === "playing") {
        this.lastFrameMs = timestampMs;
        this.accumulatorMs = 0;
      }
      this.render();
    } else if (this.phase === "playing") {
      let resumeGateActive = false;
      if (this.resumeStartedMs !== null) {
        const remaining = Math.max(0, (this.resumeDurationMs - (timestampMs - this.resumeStartedMs)) / 1000);
        if (remaining > 0) {
          resumeGateActive = true;
          this.updateResumePresentation(remaining);
        } else {
          this.resumeStartedMs = null;
          this.updateResumePresentation(null);
        }
      }
      if (resumeGateActive) {
        this.render();
      } else if (this.clockPaused) {
        this.render();
      } else if (this.resumePendingFrame) {
        // One marked interrupt frame is the first tick after resume. It is
        // sampled once; no wall-clock catch-up occurs.
        this.session.nextFrame();
        this.interruptPending = false;
        this.resumePendingFrame = false;
        this.lastFrameMs = timestampMs;
        this.accumulatorMs = 0;
      } else {
        if (this.lastFrameMs === null) this.lastFrameMs = timestampMs;
        const elapsed = Math.max(0, timestampMs - this.lastFrameMs);
        this.lastFrameMs = timestampMs;
        this.accumulatorMs += elapsed;
        if (isClockBacklogUnsafe(this.accumulatorMs)) {
          // A long visible main-thread stall provides no usable input samples.
          // Record one explicit interruption and start a fresh clock interval
          // instead of silently dropping ticks or entering a catch-up spiral.
          this.pointer.interrupt("frame-backlog");
          this.session.nextFrame();
          this.interruptPending = false;
          this.accumulatorMs = 0;
        } else {
          // Bound work per paint so a late visible frame cannot monopolize the
          // browser. Safe backlog is retained and consumed by later paints.
          let ticksThisFrame = 0;
          while (this.accumulatorMs >= FRAME_MS && this.phase === "playing" &&
              ticksThisFrame < MAX_TICKS_PER_FRAME) {
            this.session.nextFrame();
            this.accumulatorMs -= FRAME_MS;
            ticksThisFrame += 1;
          }
        }
      }
      this.render();
    } else if (this.phase === "finalizing") {
      if (this.finalizeOnFrame) {
        this.finalizeOnFrame = false;
        this.session.finalize();
        this.resultOnFrame = true;
      } else if (this.resultOnFrame) {
        this.resultOnFrame = false;
        this.session.showResult();
      }
      this.render();
    } else if (this.phase === "result" || this.phase === "fault" || this.phase === "home") {
      this.render();
    }

    if (["countdown", "finalizing"].includes(this.phase) ||
        (this.phase === "playing" && !this.clockPaused)) this.ensureLoop();
    else this.running = false;
  }

  updateCountdownPresentation(remaining) {
    if (!this.countdownValue || !this.countdownMessage) return;
    const display = Math.max(1, Math.ceil(remaining));
    this.countdownValue.textContent = remaining <= 0 ? "GO" : String(display);
    this.countdownMessage.textContent = remaining <= 0
      ? "花火を選びましょう"
      : display === 1 ? "あと少し…" : "最初の花火を探しましょう";
  }

  populateResult() {
    const state = this.session.state;
    if (!state) return;
    const stats = state.stats ?? {};
    const score = Math.max(0, Math.trunc(state.finalScore ?? state.score ?? 0));
    const maxChain = Math.max(0, Math.trunc(stats.maxChain ?? 0));
    const resultKey = `${state.seed}:${state.actionCount}:${score}:${maxChain}:${state.simulationFault?.code ?? "ok"}`;
    if (resultKey !== this.lastPersistedResultKey) {
      const previousBest = this.profile.bestScore;
      if (!state.simulationFault) {
        this.profile = this.profileStore.update({
          bestScore: Math.max(this.profile.bestScore, score),
          bestChain: Math.max(this.profile.bestChain, maxChain),
          bestRuleVersion: this.rules.ruleVersion,
        });
        this.lastBestScore = score > previousBest;
        this.updateHomeBest();
      }
      this.lastPersistedResultKey = resultKey;
    }
    renderResult(this.root, state, {
      profile: this.profile,
      publicUrl: publicUrlFor(),
      isBestScore: this.lastBestScore,
    });
    const check = this.session.replayCheck;
    if (this.resultReplay) {
      this.resultReplay.dataset.fault = state.simulationFault ? "true" : "false";
      this.resultReplay.textContent = state.simulationFault
        ? `このプレイは無効です（${state.simulationFault.code ?? "simulationFault"}）`
        : check?.ok ? "入力記録の再生一致を確認しました" : "入力記録の検証に失敗しました";
    }
  }

  render() {
    this.renderCount += 1;
    this.canvas.dataset.renderCount = String(this.renderCount);
    const state = this.session.state;
    const phase = this.phase;
    if (state && ["countdown", "playing", "finalizing"].includes(phase)) {
      this.playPresentationEvents(state);
    }
    if (phase === "playing" || phase === "finalizing") {
      this.renderer.render(state, { pointer: this.pointer.position, phase, rules: this.rules });
      updateHud(this.hud, state, {
        phase,
        rules: this.session.rules,
        remainingSeconds: this.session.getRemainingSeconds(),
      });
      updatePlayMessage(this.playMessage, state, phase);
      if (this.playMessage && this.pointerHintText && nowMs() < this.pointerHintUntilMs) {
        this.playMessage.textContent = this.pointerHintText;
      }
    } else if (state) {
      this.renderer.render(state, { pointer: this.pointer.position, phase, rules: this.rules });
    } else {
      this.renderer.render(null, { pointer: this.pointer.position, phase });
    }
    if (phase === "result" || phase === "fault") this.populateResult();
    this.updateQualityLabel();
  }

  /** Testable fixed-tick API; it does not expose target mutation methods. */
  advanceTicks(count = 1) {
    if (this.deterministicTestMode) this.stopLoop();
    if (this.deterministicTestMode && this.clockPaused && !this.isPortrait()) this.resumeClock();
    if (this.isPortrait() || this.clockPaused) return this.snapshot();
    // The real practice requires a pointer gesture. Test callers must use the
    // explicit skip path instead of silently completing it through ticks.
    if (this.screens.phase === "practice") return this.snapshot();
    if (this.phase === "home" || this.phase === "countdown") this.session.beginPlay();
    const state = this.session.advanceTicks(count);
    if (this.deterministicTestMode) {
      this.resumePendingFrame = false;
      this.interruptPending = false;
    }
    this.render();
    return this.snapshot();
  }

  settleTerminal() {
    if (this.deterministicTestMode) this.stopLoop();
    if (this.isPortrait() || this.clockPaused) return this.snapshot();
    const state = this.session.finishNow();
    this.finalizeOnFrame = false;
    this.resultOnFrame = false;
    this.populateResult();
    this.render();
    return this.snapshot();
  }

  snapshot() {
    return this.session.snapshot();
  }

  renderModel() {
    return {
      phase: this.phase,
      clock: {
        paused: this.clockPaused,
        running: this.running,
        resumeRemainingSeconds: this.resumeStartedMs === null
          ? 0
          : Math.max(0, (this.resumeDurationMs - (nowMs() - this.resumeStartedMs)) / 1000),
      },
      profile: { ...this.profile },
      experience: { ...this.experience },
      presentation: {
        updateCount: this.presentationUpdateCount,
        eventCounts: { ...this.presentationEventCounts },
      },
      practice: this.tutorial.snapshot(),
      state: this.session.snapshot(),
      pointer: { ...this.pointer.position },
      canvas: {
        width: this.renderer.width,
        height: this.renderer.height,
        dataset: {
          ...this.canvas.dataset,
        },
      },
    };
  }

  recordedReplay() {
    return clone(this.session.replay);
  }

  testApi() {
    this.deterministicTestMode = true;
    this.stopLoop();
    // Browser tests explicitly choose a decoration profile. Keep the
    // production auto-quality controller out of those comparisons so a fast
    // test runner cannot raise a manually selected low profile mid-run.
    this.renderer.qualityController.auto = false;
    return {
      snapshot: () => this.snapshot(),
      advanceTicks: (count) => this.advanceTicks(count),
      settleTerminal: () => this.settleTerminal(),
      recordedReplay: () => this.recordedReplay(),
      replay: (replay) => clone(replayGame(replay, { rules: this.session.rules })),
      transitions: () => this.screens.history(),
      renderModel: () => this.renderModel(),
      setQuality: (level) => this.renderer.setQuality(level),
      setQualityPreference: (value) => this.setQualityPreference(value),
      setPlayerName: (name) => this.setPlayerName(name),
      setSoundEnabled: (enabled) => this.setSoundEnabled(enabled),
      skipPractice: () => this.tutorial.skip(),
      shareText: () => this.shareButton?.dataset.shareText ?? "",
      profile: () => ({ ...this.profile }),
      start: (seed) => {
        this.start(seed);
        return this.snapshot();
      },
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    document.removeEventListener("visibilitychange", this.boundVisibility);
    window.removeEventListener("pageshow", this.boundPageShow);
    window.removeEventListener("resize", this.boundResize);
    this.pointer.destroy();
    this.tutorial.destroy();
    this.sound.destroy();
    this.renderer.destroy();
  }
}

export default GameController;
