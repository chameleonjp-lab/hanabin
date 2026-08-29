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

export const blastRangeForSelection = (count = 0, rules = DEFAULT_RULES) => {
  const selectedCount = Math.max(0, Math.trunc(Number(count) || 0));
  const effectiveCount = Math.max(rules.minimumSelection, selectedCount);
  const radius = directExplosionRadiusForSelection(effectiveCount, rules);
  const label = selectedCount < rules.minimumSelection
    ? `3個で ${radius.toLocaleString("ja-JP")}`
    : `${radius.toLocaleString("ja-JP")}`;
  return { count: selectedCount, radius, label };
};

export const forecastMarkup = (waves = [], currentTick = 0, rules = DEFAULT_RULES) => waves.slice(0, 2).map((wave, index) => {
  const color = colorName(wave.primaryColor);
  const value = colorValue(wave.primaryColor);
  const symbol = colorSymbol(wave.primaryColor);
  const position = positionLabels[wave.position] ?? "—";
  const fireTick = Number(wave.fireTick);
  const seconds = Number.isFinite(fireTick)
    ? formatSeconds((fireTick - (Number(currentTick) || 0)) / rules.tickRate)
    : "—";
  return `<span class="forecast-item" data-wave-index="${index}" data-wave-color="${color}">` +
    `<i class="forecast-swatch" style="color:${value}" aria-hidden="true">${symbol}</i>` +
    `<span class="forecast-order">${index + 1}波</span>` +
    `<span class="forecast-position" data-wave-position="${wave.position ?? ""}">${position}</span>` +
    `<span class="forecast-arrival" data-wave-fire-tick="${Number.isFinite(fireTick) ? fireTick : ""}">あと${seconds}s</span>` +
    `</span>`;
}).join("");

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
    const forecastKey = (safeState.upcomingWaves ?? []).slice(0, 2)
      .map((wave) => {
        const fireTick = Number(wave.fireTick);
        const progressBucket = Number.isFinite(fireTick)
          ? Math.ceil(Math.max(0, fireTick - (safeState.tick ?? 0)) / 6)
          : "";
        return `${wave.waveId ?? ""}:${wave.primaryColor ?? ""}:${wave.position ?? ""}:${progressBucket}`;
      }).join("|");
    if (forecast.dataset.forecastKey !== forecastKey) {
      forecast.dataset.forecastKey = forecastKey;
      forecast.innerHTML = forecastMarkup(safeState.upcomingWaves ?? [], safeState.tick ?? 0, rules);
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
    message = state.lastAction.reason === "release-below-minimum"
      ? "3個未満のため取消。外輪が一周するまで押してなぞりましょう"
      : "操作を中断しました。1本指でもう一度なぞりましょう";
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
