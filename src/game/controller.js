import { t, getLocale } from '../i18n/index.js';
import { DEFAULT_RULES, mergeRules } from "../config/rules.js";
import { replayGame } from "../core/replay.js";
import { PointerController } from "../input/pointer-controller.js";
import { CanvasRenderer } from "../render/canvas-renderer.js";
import { SoundController } from "../audio/sound.js";
import { detectPresentationExperience } from "../presentation/experience.js";
import { createProfileStore, sanitizePlayerName } from "../storage/local-storage.js";
import { createRankingStore } from "../storage/local-ranking.js";
import {
  createRankingClient,
  createRequestId,
  RANKING_STATES,
} from "../ranking/client.js";
import { GameSession } from "./session.js";
import { PresentationEventTracker } from "./presentation-events.js";
import { updateHud, updatePlayMessage } from "../ui/hud.js";
import { buildHomeShareText, copyShareText, openXComposer, publicUrlFor, renderResult } from "../ui/result.js";
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

/** A result is recordable only after the live state has passed replay checks. */
export const isRecordableResult = (state, replayCheck) =>
  Boolean(state && state.status === "finished" && !state.simulationFault && replayCheck?.ok === true);

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
    rankingClient = null,
  } = {}) {
    if (!root || !canvas) throw new TypeError("GameController requires root and canvas");
    this.root = root;
    this.canvas = canvas;
    this.rules = mergeRules(rules);
    this.defaultSeed = Number(seed) >>> 0 || 1;
    this.nextSeed = this.defaultSeed;
    this.profileStore = createProfileStore();
    this.rankingStore = createRankingStore(undefined, undefined, {
      ruleVersion: this.rules.ruleVersion,
    });
    this.rankingClient = rankingClient ?? createRankingClient();
    this.profile = this.profileStore.load();
    if (this.profile.bestRuleVersion !== this.rules.ruleVersion) {
      this.profile = this.profileStore.update({
        bestScore: 0,
        bestChain: 0,
        bestRuleVersion: this.rules.ruleVersion,
      });
    }
    this.experience = detectPresentationExperience();
    this.orientation = this.isPortrait() ? "portrait" : "landscape";
    this.screens = new ScreenController(root);
    this.renderer = new CanvasRenderer(canvas, {
      boardWidth: this.rules.boardWidth,
      boardHeight: this.rules.boardHeight,
      quality: this.profile.quality,
      autoQuality: !this.profile.qualityManual,
      variant: this.experience.variant,
      reducedMotion: this.experience.reducedMotion,
      orientation: this.orientation,
    });
    this.sound = new SoundController({
      enabled: this.profile.soundEnabled,
      volume: this.profile.soundVolume,
      variant: this.experience.variant,
    });
    this.presentationEvents = new PresentationEventTracker();
    this.presentationUpdateCount = 0;
    this.presentationEventCounts = {};
    this.pointer = new PointerController(canvas, {
      boardWidth: this.rules.boardWidth,
      boardHeight: this.rules.boardHeight,
      orientation: this.orientation,
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
    this.soundVolumeInput = root.querySelector("#sound-volume");
    this.resumeOverlay = root.querySelector("#resume-overlay");
    this.resumeValue = root.querySelector("#resume-value");
    this.pauseButton = root.querySelector("#pause-button");
    this.pauseMenu = root.querySelector("#pause-menu");
    this.pauseResumeButton = root.querySelector("#pause-resume-button");
    this.pauseRetireButton = root.querySelector("#pause-retire-button");
    this.pauseRulesButton = root.querySelector("#pause-rules-button");
    this.pauseRulesPanel = root.querySelector("#pause-rules-panel");
    this.shareButton = root.querySelector("#share-button");
    this.shareStatus = root.querySelector("#share-status");
    this.resultStatus = root.querySelector("#result-status");
    this.resultRankingStatus = root.querySelector("#result-ranking-status");
    this.rankingRetryButton = root.querySelector("#ranking-retry-button");
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
    this.userPaused = false;
    this.pauseRulesOpen = false;
    this.pointerHintText = "";
    this.pointerHintUntilMs = 0;
    this.rankingPlay = null;
    this.rankingStartRequest = null;
    this.rankingStartPromise = null;
    this.rankingStartState = RANKING_STATES.idle;
    this.rankingStatus = RANKING_STATES.idle;
    this.rankingEntries = [];
    this.rankingEntriesResultKey = "";
    this.rankingSyncKey = "";
    this.rankingSyncPromise = null;
    this.rankingResumePromise = null;
    this.rankingSubmission = null;
    this.rankingSubmissionSubmitted = false;
    this.currentResultKey = "";
    this.lifecycleToken = 0;
    this.tutorial = new TutorialController(root.querySelector("#practice-screen"), {
      rules: this.rules,
      sound: this.sound,
      orientation: this.orientation,
      isInteractionAllowed: () => true,
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
    this.rankingResumePromise = this.resumePendingRankingSubmission();
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundPageShow = () => this.handlePageShow();
    this.boundResize = () => {
      this.refreshPresentationExperience();
      this.renderer.resize();
      if (this.screens.phase === "practice") this.tutorial.resizeCanvas();
      this.render();
    };
    this.transitions = this.screens.history();

    const saveHomeName = (event) => {
      if (this.validateNameField() && !event.isComposing) {
        this.profile = this.profileStore.update({ name: sanitizePlayerName(this.playerNameInput.value) });
      }
    };
    this.playerNameInput?.addEventListener("input", saveHomeName);
    this.playerNameInput?.addEventListener("compositionend", saveHomeName);
    this.qualitySelect?.addEventListener("change", () => this.setQualityPreference(this.qualitySelect.value));
    this.soundToggle?.addEventListener("change", () => {
      this.setSoundEnabled(this.soundToggle.checked);
      if (this.soundToggle.checked) void this.sound.unlock();
    });
    this.soundVolumeInput?.addEventListener("input", () => {
      this.profile = this.profileStore.update({ soundVolume: this.sound.setVolume(this.soundVolumeInput.value) });
      if (this.profile.soundVolume > 0 && this.profile.soundEnabled) void this.sound.unlock();
    });
    this.startButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.requestStart();
    });
    this.practiceButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.requestPractice();
    });
    this.practiceHomeButton?.addEventListener("click", () => this.goHome());
    this.retryButton?.addEventListener("click", () => {
      void this.sound.unlock();
      this.requestStart();
    });
    this.rankingRetryButton?.addEventListener("click", () => {
      void this.retryRanking();
    });
    this.homeButton?.addEventListener("click", () => this.goHome());
    this.shareButton?.addEventListener("click", () => this.shareResult());
    root.querySelector('#home-share-button')?.addEventListener('click', async () => {
      const text=buildHomeShareText();
      if (!openXComposer(text) && !(await copyShareText(text))) window.prompt(t("共有文をコピー"), text);
    });
    this.pauseButton?.addEventListener("click", () => this.pauseGame());
    this.pauseResumeButton?.addEventListener("click", () => this.resumeGame());
    this.pauseRetireButton?.addEventListener("click", () => this.retireGame());
    this.pauseRulesButton?.addEventListener("click", () => this.togglePauseRules());
    // The pointer adapter owns the marker; this listener only resumes the
    // wall-clock accumulator and intentionally never catches up hidden time.
    document.addEventListener("visibilitychange", this.boundVisibility, { passive: true });
    window.addEventListener("pageshow", this.boundPageShow, { passive: true });
    window.addEventListener("resize", this.boundResize, { passive: true });
    // The static HTML keeps the pause controls available to assistive
    // technology, but they must not appear before a playable session exists.
    this.setPauseMenu(false);
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
    if (this.soundVolumeInput) this.soundVolumeInput.value = String(this.profile.soundVolume);
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
    const mode = snapshot.auto ? t("自動調整") : t("固定");
    if (this.qualityActiveLabel) {
      this.qualityActiveLabel.textContent = `${mode}：${t(QUALITY_LABELS[snapshot.level] ?? snapshot.level)}`;
    }
  }

  updateHomeBest() {
    if (this.homeBestScore) this.homeBestScore.textContent = Math.max(0, Math.trunc(this.profile.bestScore ?? 0)).toLocaleString(getLocale());
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
      this.pointerHintText = t("操作は1本指のみです。最初の指をそのまま使ってください");
      this.pointerHintUntilMs = nowMs() + 1_200;
    } else if (change.type === "pointerdown-ignored-pending-boundary") {
      this.pointerHintText = t("短い連続タップでは選択しません。外輪が一周するまで押してください");
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
    if (this.destroyed) return null;
    this.practiceReturnsHome = returnHome === true;
    this.pendingStartSeed = this.practiceReturnsHome ? null : seed;
    this.tutorial.show();
    this.screens.show("practice", this.screens.phase);
    this.tutorial.resizeCanvas();
    this.tutorial.render();
    if (this.status) this.status.textContent = t("何度でも操作を練習できます");
    this.render();
    return this.tutorial.snapshot();
  }

  requestStart(seed = null) {
    if (!this.persistProfileControls()) {
      if (this.status) this.status.textContent = t("名前は空欄にするか、12文字以内で入力してください");
      this.playerNameInput?.focus?.();
      return null;
    }
    if (!this.profile.practiceCompleted && !this.profile.practiceSkipped) {
      this.openPractice({ returnHome: false, seed });
      if (this.status) this.status.textContent = t("最初の操作を練習しましょう");
      return null;
    }
    return this.start(seed);
  }

  requestPractice() {
    if (!this.persistProfileControls()) {
      if (this.status) this.status.textContent = t("名前は空欄にするか、12文字以内で入力してください");
      this.playerNameInput?.focus?.();
      return null;
    }
    return this.openPractice({ returnHome: false });
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
    if (!this.persistProfileControls()) {
      if (this.status) this.status.textContent = t("名前は空欄にするか、12文字以内で入力してください");
      this.playerNameInput?.focus?.();
      return this.session.state;
    }
    const seed = this.pendingStartSeed;
    this.pendingStartSeed = null;
    return this.start(seed);
  }

  rankingNoteFor(hasRemoteRanking = false) {
    if (hasRemoteRanking) return t("カメレオンJPの実験場と共有している現在のランキングです。");
    if (this.deterministicTestMode) return t("テスト用のため、端末内ランキングを表示しています。");
    if (this.rankingStatus === RANKING_STATES.submitting) return this.rankingPlay?.guest
      ? t("カメレオンJPの実験場からランキングを取得しています。")
      : t("結果をカメレオンJPの実験場へ送信しています。");
    if ([RANKING_STATES.retryableFailed, RANKING_STATES.permanentFailed].includes(this.rankingStatus)) {
      return t("オンラインランキングを取得できないため、この端末の記録を表示しています。");
    }
    return t("カメレオンJPの実験場からランキングを取得しています。");
  }

  updateRankingUi() {
    const hasRemoteRanking = this.rankingEntriesResultKey === this.currentResultKey &&
      Array.isArray(this.rankingEntries);
    if (this.resultRankingStatus) {
      const retired = this.session?.state?.status === "retired";
      const messages = {
        [RANKING_STATES.idle]: t("ランキングを読み込んでいます…"),
        [RANKING_STATES.starting]: t("プレイ開始を記録しています…"),
        [RANKING_STATES.submitting]: this.rankingPlay?.guest ? t("ランキングを読み込んでいます…") : t("プレイ回数とスコアを連携しています…"),
        [RANKING_STATES.submitted]: retired && !this.rankingPlay?.guest
          ? t("プレイ回数を記録しました。リタイアはランキング対象外です。")
          : t("カメレオンJP公式ランキングを表示しています。"),
        [RANKING_STATES.retryableFailed]: t("ランキング連携に失敗しました。結果は保持されています。"),
        [RANKING_STATES.permanentFailed]: t("この結果はランキングへ登録できませんでした。"),
      };
      this.resultRankingStatus.textContent = this.rankingStorageFailed ? t("端末に記録を保存できません。結果を失わないため、再読み込みせず保存できる状態で再送してください。") : messages[this.rankingStatus] ?? messages[RANKING_STATES.idle];
      this.resultRankingStatus.dataset.state = this.rankingStatus;
    }
    if (this.rankingRetryButton) {
      const retryable = this.rankingStatus === RANKING_STATES.retryableFailed;
      this.rankingRetryButton.hidden = !retryable;
      this.rankingRetryButton.disabled = Boolean(this.rankingSyncPromise);
    }
    return hasRemoteRanking;
  }

  renderCurrentResult(state = this.session?.state) {
    if (!state) return null;
    const remote = this.rankingEntriesResultKey === this.currentResultKey &&
      Array.isArray(this.rankingEntries);
    const localRanking = this.rankingStore?.list?.() ?? [];
    const legacyRanking = this.rankingStore?.legacyList?.() ?? [];
    const rendered = renderResult(this.root, state, {
      profile: { ...this.profile, name: this.rankingPlay?.displayName ?? this.profile.name },
      publicUrl: publicUrlFor(),
      isBestScore: this.lastBestScore,
      isRetired: state.status === "retired",
      ranking: remote ? this.rankingEntries : localRanking,
      legacyRanking,
      rankingMode: remote ? "remote" : "local",
      rankingNote: this.rankingNoteFor(remote),
      isReplayValid: this.session.replayCheck?.ok === true,
    });
    this.updateRankingUi();
    if (this.resultStatus) this.resultStatus.dataset.retired = state.status === "retired" ? "true" : "false";
    if (this.resultReplay) {
      const invalid = Boolean(state.simulationFault) ||
        (state.status === "finished" && this.session.replayCheck?.ok !== true);
      this.resultReplay.dataset.fault = invalid ? "true" : "false";
      this.resultReplay.textContent = invalid
        ? t("このプレイは無効です")
        : state.status === "retired"
          ? t("リタイアしました")
        : this.session.replayCheck?.ok ? t("プレイ結果を確認しました") : t("プレイ結果を確認できませんでした");
    }
    return rendered;
  }

  persistRankingSubmission(record) {
    const saved=this.rankingClient.savePendingSubmission?.(record);
    if(saved?.persisted===false){const error=new Error('Result storage unavailable');error.code='result_storage_unavailable';error.retryable=true;throw error;}
    return saved;
  }

  async syncRankingResult(state, resultKey) {
    const play = this.rankingPlay;
    if (!play || !this.rankingClient) return null;
    if (play.guest) {
      const isCurrent = () => this.rankingPlay === play && this.currentResultKey === resultKey;
      try {
        const entries = await this.rankingClient.fetchTopRanking(30);
        if (isCurrent()) {
          this.rankingEntries = entries;
          this.rankingEntriesResultKey = resultKey;
          this.rankingStatus = RANKING_STATES.submitted;
        }
      } catch {
        if (isCurrent()) this.rankingStatus = RANKING_STATES.retryableFailed;
      }
      if (isCurrent()) this.populateResult();
      return isCurrent() ? this.rankingStatus : null;
    }
    const recordable = isRecordableResult(state, this.session?.replayCheck);
    const score = Math.max(0, Math.trunc(state.finalScore ?? state.score ?? 0));
    const reachedWave = Math.max(1, Math.trunc(Number(state.stats?.wavesSpawned) || 1));
    const resultType = recordable ? "game_over" : "retire";
    const isCurrentRun = () => this.rankingPlay === play && this.currentResultKey === resultKey;
    let failure = null;
    try {
      // Snapshot the finalized result before any await. A later home name,
      // new play, or language change cannot change the queued request.
      if (!play.submission) {
        play.submission = {
          submissionId: createRequestId(), startId: play.startId,
          playId: play.playId, displayName: play.displayName,
          score: recordable ? score : 0, resultType, reachedWave,
        };
      }
      this.persistRankingSubmission(play.submission);
      if (isCurrentRun()) this.rankingSubmission = play.submission;
      if (!await this.startRankingPlay(play)) throw play.startError ?? new Error("Ranking start unavailable");
      if (!play.submission.playId) {
        play.submission = { ...play.submission, playId: play.playId };
        this.persistRankingSubmission(play.submission);
      }
      if (!play.finished) {
        await this.rankingClient.finishPlay({ playId: play.playId, displayName: play.displayName,
          resultType, reachedWave, score: recordable ? score : 0 });
        play.finished = true;
      }
      if (recordable && !play.submitted) {
        await this.rankingClient.submitScore({ playId: play.playId,
          submissionId: play.submission.submissionId, displayName: play.displayName, score });
        play.submitted = true;
      }
      this.rankingClient.clearPendingSubmission?.(play.submission.submissionId);
      if (isCurrentRun()) this.rankingSubmissionSubmitted = play.…7469 tokens truncated…   retire: () => this.retireGame(),
      togglePauseRules: () => this.togglePauseRules(),
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

