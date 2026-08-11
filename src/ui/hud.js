import { COLORS, DEFAULT_RULES } from "../config/rules.js";
import { colorName, colorValue, colorSymbol } from "../render/competitive-layer.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const byId = (root, id) => root?.querySelector?.(`#${id}`) ?? null;

const formatScore = (value) => Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ja-JP");
const formatSeconds = (value) => Math.max(0, Number(value) || 0).toFixed(1);

export const forecastMarkup = (waves = []) => waves.slice(0, 2).map((wave, index) => {
  const color = colorName(wave.primaryColor);
  const value = colorValue(wave.primaryColor);
  const symbol = colorSymbol(wave.primaryColor);
  return `<span class="forecast-item" data-wave-index="${index}" data-wave-color="${color}">` +
    `<i class="forecast-swatch" style="color:${value}" aria-hidden="true">${symbol}</i>` +
    `<span>${index + 1}波</span></span>`;
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
  if (forecast) {
    const forecastKey = (safeState.upcomingWaves ?? []).slice(0, 2)
      .map((wave) => `${wave.waveId ?? ""}:${wave.primaryColor ?? ""}`).join("|");
    if (forecast.dataset.forecastKey !== forecastKey) {
      forecast.dataset.forecastKey = forecastKey;
      forecast.innerHTML = forecastMarkup(safeState.upcomingWaves ?? []);
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
  else if (state?.lastAction?.type === "detonate") {
    const count = Number(state.lastAction.count) || 0;
    message = count > 0 ? `${count}個の連鎖` : "連鎖を探しましょう";
  } else if (state?.selectedIds?.length >= 3) {
    message = "指を離して起爆";
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
