import { t, getLocale } from '../i18n/index.js';
import { forecastSuccessCountFor } from "./forecast-feedback.js";

const formatScore = (value) => Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString(getLocale());

const safeText = (value, fallback = "") => typeof value === "string" ? value : fallback;

export const scoreBreakdownFor = (state = {}) => {
  const scoreEvents = Array.isArray(state.scoreEvents) ? state.scoreEvents : [];
  const bonusEvents = Array.isArray(state.bonusEvents) ? state.bonusEvents : [];
  const sum = (events, key, predicate = () => true) => events
    .filter(predicate)
    .reduce((total, event) => total + Math.max(0, Math.trunc(Number(event?.[key]) || 0)), 0);
  const direct = sum(scoreEvents, "baseAmount", (event) => event?.kind === "direct");
  const chain = sum(scoreEvents, "baseAmount", (event) => event?.kind === "chain");
  const inclusion = sum(scoreEvents, "inclusionAmount");
  const preparation = sum(bonusEvents, "preparationAmount");
  const forecast = sum(scoreEvents, "forecastPlanAmount") + sum(bonusEvents, "forecastPlanAmount");
  const other = sum(bonusEvents, "detonationAmount") + sum(bonusEvents, "comboAmount");
  return {
    direct,
    chain,
    inclusion,
    preparation,
    forecast,
    other,
    deductions: 0,
    total: direct + chain + inclusion + preparation + forecast + other,
  };
};

const detonationRowsFor = (state = {}) => {
  const rows = new Map();
  const scoreEvents = Array.isArray(state.scoreEvents) ? state.scoreEvents : [];
  scoreEvents
    .filter((event) => event?.kind === "direct")
    .forEach((event, index) => {
      const actionKey = event?.actionId === null || event?.actionId === undefined
        ? `unknown:${index}`
        : String(event.actionId);
      const row = rows.get(actionKey) ?? {
        actionId: event?.actionId ?? null,
        selectedCount: 0,
        fireTick: Number.isFinite(Number(event?.fireTick)) ? Number(event.fireTick) : null,
      };
      row.selectedCount += 1;
      if (row.fireTick === null && Number.isFinite(Number(event?.fireTick))) {
        row.fireTick = Number(event.fireTick);
      }
      rows.set(actionKey, row);
    });
  return [...rows.values()];
};

/** Derive one actionable run summary from the existing deterministic ledgers. */
export const resultStatsFor = (state = {}) => {
  const stats = state.stats ?? {};
  const detonations = detonationRowsFor(state);
  const detonationCount = Math.max(
    0,
    Math.trunc(Number(stats.detonationCount) || detonations.length),
  );
  const selectionTotal = detonations.reduce((total, row) => total + row.selectedCount, 0);
  const smallDetonations = detonations.filter((row) => row.selectedCount <= 3).length;
  const directTargets = Math.max(0, Math.trunc(Number(stats.directTargets) || 0));
  const chainTargets = Math.max(0, Math.trunc(Number(stats.chainTargets) || 0));
  const totalTargets = directTargets + chainTargets;
  return {
    detonationCount,
    selectionSamples: detonations.length,
    averageSelectionCount: detonations.length ? selectionTotal / detonations.length : null,
    smallDetonationRate: detonations.length ? smallDetonations / detonations.length : 0,
    selectionDrops: Math.max(0, Math.trunc(Number(stats.selectionDrops) || 0)),
    directTargets,
    chainTargets,
    chainRatio: totalTargets ? chainTargets / totalTargets : 0,
    forecastSuccesses: forecastSuccessCountFor(state),
    maxChain: Math.max(0, Math.trunc(Number(stats.maxChain) || 0)),
  };
};

export const resultHintFor = (state = {}) => {
  const metrics = resultStatsFor(state);
  if (Math.max(0, Number(state.finalScore ?? state.score) || 0) <= 0) {
    return t("まずは同じ色の花火を3つ見つけ、指を押したまま少し待ってから離してみましょう。");
  }
  if (metrics.averageSelectionCount !== null && metrics.averageSelectionCount < 3.4) {
    return t("平均{0}個で起爆しました。次は4個目を足し、爆発範囲を広げてみましょう。", [metrics.averageSelectionCount.toFixed(1)]);
  }
  if (metrics.selectionDrops >= 2 && metrics.selectionDrops > metrics.detonationCount) {
    return t("外輪が一周してから次へ動き、選択中の花火が消える前に離してみましょう。");
  }
  if (metrics.forecastSuccesses === 0 && metrics.maxChain < 5 && metrics.detonationCount > 0) {
    return t("金色の二重リングを3つ含め、次の波が近づいたときに離してみましょう。");
  }
  if (metrics.detonationCount > 0 && metrics.chainRatio < 0.35) {
    return t("選ぶ花火を次の花火の近くに集めてから離すと、連鎖が伸びやすくなります。");
  }
  if (metrics.directTargets > metrics.chainTargets) {
    return t("次は選択した花火を5個まで増やし、予告対象を準備に使ってみましょう。");
  }
  return t("連鎖の途中で次の色へ視線を移し、起爆後の短い待ち時間に次の花火を準備してみましょう。");
};

// The public play page was verified independently of the repository name.
export const CANONICAL_GAME_URL = "https://chameleonjp-lab.github.io/hanabin/";
export const publicUrlFor = () => CANONICAL_GAME_URL;
export const SHARE_TAGS = '#ハナビン #ゲーム制作';
export const buildHomeShareText = () => `${t("ハナビン\n同じ色の花火をつなぎ、連鎖を広げよう。\nhttps://chameleonjp-lab.github.io/hanabin/")}\n${SHARE_TAGS}`;

export const buildShareText = ({
  name = "",
  score = 0,
  maxChain = 0,
  url = publicUrlFor(),
} = {}) => {
  const title = t("HANABINプレイ結果");
  return `${t("{0}\nSCORE {1} / 最大連鎖 {2}\n{3}", [title, formatScore(score), Math.max(0, Math.trunc(Number(maxChain) || 0)), url])}\n${SHARE_TAGS}`;
};

export const openXComposer = (text, { windowObject = globalThis.window } = {}) => {
  try {
    const intent = new URL("https://x.com/intent/tweet");
    intent.searchParams.set("text", text);
    const composer = windowObject?.open?.(intent.href, "_blank");
    if (!composer) return false;
    try { composer.opener = null; } catch { /* The composer is already open. */ }
    return true;
  } catch {
    return false;
  }
};

const renderRankingList = (listElement, entries, ownerDocument, {
  showRuleVersion = false,
  mode = "local",
} = {}) => {
  if (!listElement) return;
  listElement.replaceChildren();
  if (!ownerDocument) return;
  if (!entries.length) {
    const empty = ownerDocument.createElement("li");
    empty.className = "result-ranking__empty";
    empty.textContent = t("まだ記録がありません");
    listElement.append(empty);
    return;
  }
  entries.forEach((entry, index) => {
    const item = ownerDocument.createElement("li");
    const rank = ownerDocument.createElement("span");
    rank.className = "result-ranking__rank";
    rank.textContent = `${Number.isInteger(entry?.rankNo) ? entry.rankNo : index + 1}`;
    const name = ownerDocument.createElement("span");
    name.className = "result-ranking__name";
    name.textContent = safeText(entry?.name ?? entry?.displayName) || t("名無し");
    const nameCell = showRuleVersion
      ? ownerDocument.createElement("span")
      : name;
    if (showRuleVersion) {
      nameCell.className = "result-ranking__name-block";
      const version = ownerDocument.createElement("small");
      version.className = "result-ranking__version";
      version.textContent = entry?.ruleVersion
        ? t("ルール {0}", [entry.ruleVersion])
        : t("ルール版不明");
      nameCell.append(name, version);
    }
    const value = ownerDocument.createElement("strong");
    value.className = "result-ranking__score";
    value.textContent = mode === "remote"
      ? t("{0}点 / {1}プレイ", [formatScore(entry?.score), Math.max(0, Math.trunc(Number(entry?.playCount) || 0))])
      : t("{0} / {1}連鎖", [formatScore(entry?.score), Math.max(0, Math.trunc(Number(entry?.maxChain) || 0))]);
    item.append(rank, nameCell, value);
    listElement.append(item);
  });
};

export const renderResult = (root, state, {
  profile = {},
  publicUrl = publicUrlFor(),
  isBestScore = false,
  isRetired = state.status === "retired",
  isReplayValid = null,
  ranking = [],
  legacyRanking = [],
  rankingMode = "local",
  rankingNote = "",
} = {}) => {
  if (!root || !state) return null;
  const stats = state.stats ?? {};
  const score = Math.max(0, Math.trunc(state.finalScore ?? state.score ?? 0));
  const maxChain = Math.max(0, Math.trunc(stats.maxChain ?? 0));
  const setText = (id, value) => {
    const element = root.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  };
  setText("result-score", formatScore(score));
  setText("result-chain", maxChain);
  setText("result-detonations", Math.max(0, Math.trunc(stats.detonationCount ?? 0)));
  setText("result-direct", Math.max(0, Math.trunc(stats.directTargets ?? 0)));
  setText("result-chain-targets", Math.max(0, Math.trunc(stats.chainTargets ?? 0)));
  setText("result-forecast-successes", forecastSuccessCountFor(state));
  const breakdown = scoreBreakdownFor(state);
  setText("result-score-direct", formatScore(breakdown.direct));
  setText("result-score-chain", formatScore(breakdown.chain));
  setText("result-score-inclusion", formatScore(breakdown.inclusion));
  setText("result-score-preparation", formatScore(breakdown.preparation));
  setText("result-score-forecast", formatScore(breakdown.forecast));
  setText("result-score-other", formatScore(breakdown.other));
  setText("result-score-deductions", "0");
  setText("result-player-name", safeText(profile.name) || t("ゲストプレイヤー"));
  const replayInvalid = state.status === "finished" && isReplayValid !== true;
  const invalidResult = Boolean(state.simulationFault) || replayInvalid;
  setText("result-status", isRetired ? t("リタイアしました") : invalidResult ? t("このプレイは無効です") : t("プレイ完了"));
  setText("result-best-score", formatScore(profile.bestScore ?? 0));
  setText("result-best-chain", Math.max(0, Math.trunc(profile.bestChain ?? 0)));
  setText("result-hint", resultHintFor(state));
  const bestMark = root.querySelector("#result-best-mark");
  if (bestMark) {
    bestMark.hidden = !isBestScore;
    bestMark.textContent = isBestScore ? t("自己ベスト更新") : "";
  }
  const shareText = buildShareText({
    name: profile.name,
    score,
    maxChain,
    url: publicUrl,
  });
  const shareButton = root.querySelector("#share-button");
  if (shareButton) shareButton.dataset.shareText = shareText;
  const ownerDocument = root.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  const rankingList = root.querySelector("#result-ranking-list");
  const remoteRanking = rankingMode === "remote";
  const entries = Array.isArray(ranking) ? ranking.slice(0, remoteRanking ? 30 : 10) : [];
  setText("result-ranking-title", remoteRanking ? t("カメレオンJP公式ランキング TOP30") : t("端末内ランキング TOP10"));
  setText("result-ranking-meta", remoteRanking ? t("スコア / プレイ回数") : t("スコア / 最大連鎖"));
  setText(
    "result-ranking-note",
    rankingNote || (remoteRanking
      ? t("カメレオンJPの実験場と共有している現在のランキングです。")
      : t("公式ランキングを取得できないため、この端末の記録を表示しています。")),
  );
  renderRankingList(rankingList, entries, ownerDocument, { mode: remoteRanking ? "remote" : "local" });
  const legacyEntries = Array.isArray(legacyRanking) ? legacyRanking.slice(0, 10) : [];
  const legacySection = root.querySelector("#legacy-ranking");
  if (legacySection) legacySection.hidden = legacyEntries.length === 0;
  renderRankingList(
    root.querySelector("#legacy-ranking-list"),
    legacyEntries,
    ownerDocument,
    { showRuleVersion: true },
  );
  return {
    score,
    maxChain,
    breakdown,
    hint: resultHintFor(state),
    shareText,
    ranking: entries,
    rankingMode: remoteRanking ? "remote" : "local",
    legacyRanking: legacyEntries,
  };
};

const fallbackCopy = (text) => {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
};

export const copyShareText = async (text, {
  navigatorObject = globalThis.navigator,
} = {}) => {
  if (!text) return false;
  try {
    if (navigatorObject?.clipboard?.writeText) {
      await navigatorObject.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard permission can be denied even after a user gesture.
  }
  return fallbackCopy(text);
};

export default renderResult;
