import {
  COLORS,
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
} from "../config/rules.js";
import { colorName, colorValue, colorSymbol } from "../render/competitive-layer.js";
import { forecastSuccessForAction } from "./forecast-feedback.js";
import { playableChoiceCount } from "../core/engine.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const byId = (root, id) => root?.querySelector?.(`#${id}`) ?? null;

const formatScore = (value) => Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ja-JP");
const formatSeconds = (value) => Math.max(0, Number(value) || 0).toFixed(1);
const positionLabels = Object.freeze({ left: "左", center: "中央", right: "右" });
const idKey = (value) => String(value);

const safeRuleCount = (value, fallback) => Math.max(1, Math.trunc(Number(value) || fallback));

/**
 * Derive the player-facing forecast preparation state without changing the
 * game state. The core remains the only place that awards the bonus; this
 * helper only explains the same timing and selection conditions in the HUD.
 */
export const forecastReadinessFor = (state = {}, rules = DEFAULT_RULES) => {
  const nextWave = state?.upcomingWaves?.[0] ?? null;
  const tick = Number(state?.tick);
  const fireTick = Number(nextWave?.fireTick);
  const leadTicks = Number.isFinite(tick) && Number.isFinite(fireTick)
    ? Math.trunc(fireTick - tick)
    : null;
  const requiredSelectionCount = safeRuleCount(rules.forecastPlanSelectionCount, 5);
  const requiredBridgeCount = safeRuleCount(rules.minimumSelection, 3);
  const selectedIds = Array.isArray(state?.selectedIds) ? state.selectedIds : [];
  const entitiesById = new Map(
    (Array.isArray(state?.fireworks) ? state.fireworks : [])
      .map((entity) => [idKey(entity?.id), entity]),
  );
  const selectedEntities = selectedIds
    .map((id) => entitiesById.get(idKey(id)))
    .filter((entity) => entity?.status === "active" && entity.visible !== false);
  const selectedCount = selectedEntities.length;
  const selectedColor = state?.selectedColor ?? selectedEntities[0]?.color ?? null;
  const forecastColor = nextWave ? colorName(nextWave.primaryColor) : null;
  const selectedColorMatches = selectedCount > 0 &&
    colorName(selectedColor) === forecastColor &&
    selectedEntities.every((entity) => colorName(entity.color) === forecastColor);
  const forecastWaveIndex = Number.isInteger(nextWave?.waveIndex) ? nextWave.waveIndex : null;
  const bridgeCount = selectedEntities.filter((entity) =>
    forecastWaveIndex !== null && entity.forecastForWaveIndex === forecastWaveIndex,
  ).length;
  const windowOpen = Boolean(nextWave &&
    Number.isFinite(leadTicks) &&
    leadTicks >= 1 &&
    leadTicks <= rules.forecastPlanLeadTicks);
  let status = "window-closed";
  if (windowOpen) {
    if (!selectedCount) status = "window-open";
    else if (!selectedColorMatches) status = "wrong-color";
    else if (selectedCount === requiredSelectionCount && bridgeCount >= requiredBridgeCount) status = "ready";
    else status = "progress";
  }
  return {
    status,
    windowOpen,
    ready: status === "ready",
    waveId: nextWave?.waveId ?? null,
    waveIndex: forecastWaveIndex,
    forecastColor,
    leadTicks,
    selectedCount,
    requiredSelectionCount,
    bridgeCount,
    requiredBridgeCount,
    selectionRemaining: Math.max(0, requiredSelectionCount - selectedCount),
    bridgeRemaining: Math.max(0, requiredBridgeCount - bridgeCount),
  };
};

const forecastCueTextFor = (readiness = {}) => {
  if (readiness.status === "ready") return "予告準備OK";
  if (readiness.status === "window-open") return "今なら予告準備";
  if (readiness.status === "wrong-color") return "予告色を選択";
  if (readiness.status !== "progress") return "";
  if (readiness.selectedCount > readiness.requiredSelectionCount) {
    return `ちょうど${readiness.requiredSelectionCount}個に調整`;
  }
  const remaining = [];
  if (readiness.selectionRemaining > 0) remaining.push(`あと${readiness.selectionRemaining}個`);
  if (readiness.bridgeRemaining > 0) remaining.push(`金色の輪あと${readiness.bridgeRemaining}個`);
  return remaining.join("・") || `ちょうど${readiness.requiredSelectionCount}個`;
};

const INPUT_FAILURE_MESSAGES = Object.freeze({
  "selection-not-held": "もう少し押してから動かします",
  "target-outside-selection-geometry": "花火にもっと近くを通します",
  "different-color": "同じ色の花火だけをつなぎます",
  cooldown: "爆発直後です。少し待ちます",
  "target-already-selected": "この花火は選択済みです",
  "selection-limit": "選択は12個までです",
  "target-expired": "花火が消えました。近くから選び直します",
  "target-offscreen": "花火が画面外へ出ました。近くから選び直します",
  "target-not-active": "この花火はもうありません",
  "target-not-selectable": "花火の中心に近づけます",
  "selection-coordinate-required": "花火の中心を狙います",
  "one-acquisition-per-tick": "少しずつなぞります",
  "selection-timeout": "時間切れです。3個以上なら離して起爆します",
  "release-rejected": "起爆できませんでした。もう一度選びます",
});

export const inputFailureMessageFor = (reason) => INPUT_FAILURE_MESSAGES[reason] ?? "花火の中心を狙います";

export const blastRangeForSelection = (count = 0, rules = DEFAULT_RULES) => {
  const selectedCount = Math.max(0, Math.trunc(Number(count) || 0));
  const effectiveCount = Math.max(rules.minimumSelection, selectedCount);
  const radius = directExplosionRadiusForSelection(effectiveCount, rules);
  const label = selectedCount < rules.minimumSelection
    ? `3個で ${radius.toLocaleString("ja-JP")}`
    : `${radius.toLocaleString("ja-JP")}`;
  return { count: selectedCount, radius, label };
};

export const forecastMarkup = (
  waves = [],
  currentTick = 0,
  rules = DEFAULT_RULES,
  readiness = null,
) => {
  const forecastReadiness = readiness ?? forecastReadinessFor({
    upcomingWaves: waves,
    tick: currentTick,
  }, rules);
  return waves.slice(0, 2).map((wave, index) => {
    const color = colorName(wave.primaryColor);
    const value = colorValue(wave.primaryColor);
    const symbol = colorSymbol(wave.primaryColor);
    const position = positionLabels[wave.position] ?? "—";
    const fireTick = Number(wave.fireTick);
    const seconds = Number.isFinite(fireTick)
      ? formatSeconds((fireTick - (Number(currentTick) || 0)) / rules.tickRate)
      : "—";
    const isPrimary = index === 0;
    const isWindowOpen = isPrimary && forecastReadiness.windowOpen &&
      (forecastReadiness.waveId === null || forecastReadiness.waveId === wave.waveId);
    const classes = ["forecast-item"];
    if (isWindowOpen) classes.push("forecast-item--window-open");
    if (isWindowOpen && forecastReadiness.ready) classes.push("forecast-item--ready");
    const cue = isWindowOpen ? forecastCueTextFor(forecastReadiness) : "";
    const readinessAttributes = isPrimary
      ? ` data-forecast-window="${isWindowOpen ? "open" : "closed"}"` +
        ` data-forecast-ready="${isWindowOpen && forecastReadiness.ready ? "true" : "false"}"` +
        ` data-forecast-status="${isWindowOpen ? forecastReadiness.status : "window-closed"}"` +
        ` data-forecast-selected-count="${isWindowOpen ? forecastReadiness.selectedCount : 0}"` +
        ` data-forecast-bridge-count="${isWindowOpen ? forecastReadiness.bridgeCount : 0}"`
      : "";
    return `<span class="${classes.join(" ")}" data-wave-index="${index}" data-wave-color="${color}"${readinessAttributes}>` +
      `<i class="forecast-swatch" style="color:${value}" aria-hidden="true">${symbol}</i>` +
      `<span class="forecast-order">${index + 1}波</span>` +
      `<span class="forecast-position" data-wave-position="${wave.position ?? ""}">${position}</span>` +
      `<span class="forecast-arrival" data-wave-fire-tick="${Number.isFinite(fireTick) ? fireTick : ""}">あと${seconds}s</span>` +
      (cue ? `<span class="forecast-cue">${cue}</span>` : "") +
      `</span>`;
  }).join("");
};

const selectionInterruptionMessageFor = (reason) => {
  if (reason === "release-below-minimum") {
    return "3個未満のため取消。外輪が一周するまで押してなぞりましょう";
  }
  if (reason === "selection-timeout") {
    return "時間切れで取消。3個以上なら離すか2.5秒で起爆します";
  }
  if (["target-expired", "target-offscreen"].includes(reason)) {
    return inputFailureMessageFor(reason);
  }
  return "操作を中断しました。1本指でもう一度なぞりましょう";
};

/** Update only DOM presentation; state remains owned by GameSession. */
export const updateHud = (root, state, {
  phase = "playing",
  rules = DEFAULT_RULES,
  remainingSeconds = null,
} = {}) => {
  if (!root) return;
  const score = byId(root, "hud-score");
  const time = byId(root, "hud-time");
  const combo = byId(root, "hud-combo");
  const selection = byId(root, "hud-selection");
  const selectionColor = byId(root, "hud-selection-color");
  const selectionCount = byId(root, "hud-selection-count");
  const selectionTime = byId(root, "hud-selection-time");
  const blastRange = byId(root, "hud-blast-range");
  const choiceCount = byId(root, "hud-choice-count");
  const forecast = byId(root, "hud-forecast-items");
  const safeState = state ?? {};
  const seconds = remainingSeconds === null
    ? Math.max(0, (rules.maxTicks - (safeState.tick ?? 0)) / rules.tickRate)
    : remainingSeconds;
  if (score) score.textContent = formatScore(safeState.score);
  if (time) time.textContent = formatSeconds(seconds);
  if (combo) combo.textContent = String(Math.max(0, Math.trunc(safeState.stats?.maxChain ?? safeState.maxCombo ?? 0)));
  const selectedCount = Array.isArray(safeState.selectedIds) ? safeState.selectedIds.length : 0;
  const selectedColor = safeState.selectedColor;
  if (selection) selection.dataset.selectionCount = String(selectedCount);
  if (selectionColor) {
    selectionColor.textContent = selectedColor === null || selectedColor === undefined
      ? "—"
      : colorSymbol(selectedColor);
    selectionColor.style.color = selectedColor === null || selectedColor === undefined
      ? "#a8b7dd"
      : colorValue(selectedColor);
    if (selection) selection.dataset.selectionColor = selectedColor === null || selectedColor === undefined
      ? ""
      : colorName(selectedColor);
  }
  if (selectionCount) selectionCount.textContent = String(selectedCount);
  if (selectionTime) {
    const age = safeState.selectionSinceTick === null || safeState.selectionSinceTick === undefined
      ? null
      : Math.max(0, (safeState.selectionAgeTicks ?? 0));
    const limit = rules.selectionTimeoutTicks;
    selectionTime.textContent = age === null ? "—" : `${formatSeconds((limit - age) / rules.tickRate)}s`;
    selectionTime.dataset.selectionAgeTicks = age === null ? "" : String(age);
  }
  if (blastRange) {
    const blast = blastRangeForSelection(selectedCount, rules);
    blastRange.textContent = blast.label;
    blastRange.dataset.radius = String(blast.radius);
  }
  if (choiceCount) {
    const available = playableChoiceCount(safeState, rules);
    choiceCount.textContent = String(available);
    choiceCount.dataset.minimum = String(rules.minimumPlayableChoices);
    choiceCount.dataset.guaranteed = available >= rules.minimumPlayableChoices ? "true" : "false";
    root.dataset.availableChoices = String(available);
  }
  if (forecast) {
    const forecastReadiness = forecastReadinessFor(safeState, rules);
    const forecastKey = (safeState.upcomingWaves ?? []).slice(0, 2)
      .map((wave) => {
        const fireTick = Number(wave.fireTick);
        const progressBucket = Number.isFinite(fireTick)
          ? Math.ceil(Math.max(0, fireTick - (safeState.tick ?? 0)) / 6)
          : "";
        return `${wave.waveId ?? ""}:${wave.primaryColor ?? ""}:${wave.position ?? ""}:${progressBucket}`;
      }).join("|") + `|${forecastReadiness.status}:${forecastReadiness.selectedCount}:${forecastReadiness.bridgeCount}`;
    if (forecast.dataset.forecastKey !== forecastKey) {
      forecast.dataset.forecastKey = forecastKey;
      forecast.innerHTML = forecastMarkup(
        safeState.upcomingWaves ?? [],
        safeState.tick ?? 0,
        rules,
        forecastReadiness,
      );
      if (!safeState.upcomingWaves?.length) forecast.textContent = "—";
    }
  }
  root.dataset.phase = phase;
};

export const updatePlayMessage = (element, state, phase = "playing") => {
  if (!element) return;
  let message = "";
  if (phase === "finalizing") message = "最後の連鎖を確定中…";
  else if (state?.simulationFault) message = "判定エラー：このプレイは無効です";
  else if (["selection-cleared", "selection-cancelled"].includes(state?.lastAction?.type)) {
    message = selectionInterruptionMessageFor(state.lastAction.reason);
  } else if (state?.lastAction?.type === "ignored" && state.pointerPressed) {
    message = inputFailureMessageFor(state.lastAction.reason);
  } else if (state?.lastAction?.type === "detonate") {
    const forecastSuccess = forecastSuccessForAction(state, state.lastAction.actionId);
    if (forecastSuccess) {
      message = "予告成功！次の波を先回りしました";
    } else {
      const count = Number(state.lastAction.count) || 0;
      message = count > 0 ? `${count}個の連鎖` : "連鎖を探しましょう";
    }
  } else if (state?.selectedIds?.length >= 3) {
    message = "指を離すか2.5秒で自動起爆";
  } else if (state?.selectedIds?.length === 2) {
    message = "あと1個つないで起爆";
  } else if (state?.selectedIds?.length === 1) {
    message = "あと2個。同じ色をそのままなぞる";
  } else if (state?.pointerPressed) {
    message = "外輪が一周して選択数が増えるまで短く押してください";
  }
  if (element.textContent !== message) element.textContent = message;
};

export const colorLegend = () => COLORS.map((name, index) => ({
  name,
  index,
  value: colorValue(index),
  symbol: colorSymbol(index),
}));

export default updateHud;
