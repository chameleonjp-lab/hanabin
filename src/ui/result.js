import { forecastSuccessCountFor } from "./forecast-feedback.js";

const formatScore = (value) => Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ja-JP");

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
    return "まずは同じ色の花火を3つ見つけ、指を押したまま少し待ってから離してみましょう。";
  }
  if (metrics.averageSelectionCount !== null && metrics.averageSelectionCount < 3.4) {
    return `平均${metrics.averageSelectionCount.toFixed(1)}個で起爆しました。次は4個目を足し、爆発範囲を広げてみましょう。`;
  }
  if (metrics.selectionDrops >= 2 && metrics.selectionDrops > metrics.detonationCount) {
    return "外輪が一周してから次へ動き、選択中の花火が消える前に離してみましょう。";
  }
  if (metrics.forecastSuccesses === 0 && metrics.maxChain < 5 && metrics.detonationCount > 0) {
    return "金色の二重リングを3つ含め、次の波が近づいたときに離してみましょう。";
  }
  if (metrics.detonationCount > 0 && metrics.chainRatio < 0.35) {
    return "選ぶ花火を次の花火の近くに集めてから離すと、連鎖が伸びやすくなります。";
  }
  if (metrics.directTargets > metrics.chainTargets) {
    return "次は選択した花火を5個まで増やし、予告対象を準備に使ってみましょう。";
  }
  return "連鎖の途中で次の色へ視線を移し、起爆後の短い待ち時間に次の花火を準備してみましょう。";
};

export const publicUrlFor = (location = globalThis.location) => {
  try {
    const url = new URL(location?.href ?? "", location?.href ?? undefined);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "https://github.com/chameleonjp-lab/hanabin";
  }
};

export const buildShareText = ({
  name = "",
  score = 0,
  maxChain = 0,
  url = publicUrlFor(),
} = {}) => {
  const player = safeText(name).trim();
  const title = player ? `${player}さんのHANABIN結果` : "HANABINプレイ結果";
  return `${title}\nSCORE ${formatScore(score)} / 最大連鎖 ${Math.max(0, Math.trunc(Number(maxChain) || 0))}\n${url}`;
};

export const renderResult = (root, state, {
  profile = {},
  publicUrl = publicUrlFor(),
  isBestScore = false,
  isRetired = state.status === "retired",
  ranking = [],
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
  setText("result-player-name", safeText(profile.name) || "ゲストプレイヤー");
  setText("result-status", isRetired ? "リタイアしました" : state.simulationFault ? "このプレイは無効です" : "プレイ完了");
  setText("result-best-score", formatScore(profile.bestScore ?? 0));
  setText("result-best-chain", Math.max(0, Math.trunc(profile.bestChain ?? 0)));
  setText("result-hint", resultHintFor(state));
  const bestMark = root.querySelector("#result-best-mark");
  if (bestMark) {
    bestMark.hidden = !isBestScore;
    bestMark.textContent = isBestScore ? "自己ベスト更新" : "";
  }
  const shareText = buildShareText({
    name: profile.name,
    score,
    maxChain,
    url: publicUrl,
  });
  const shareButton = root.querySelector("#share-button");
  if (shareButton) shareButton.dataset.shareText = shareText;
  const rankingList = root.querySelector("#result-ranking-list");
  const entries = Array.isArray(ranking) ? ranking.slice(0, 10) : [];
  if (rankingList) {
    rankingList.replaceChildren();
    const ownerDocument = root.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!entries.length) {
      if (!ownerDocument) return { score, maxChain, breakdown, hint: resultHintFor(state), shareText, ranking: entries };
      const empty = ownerDocument.createElement("li");
      empty.className = "result-ranking__empty";
      empty.textContent = "まだ記録がありません";
      rankingList.append(empty);
    } else {
      entries.forEach((entry, index) => {
        const item = ownerDocument.createElement("li");
        const rank = ownerDocument.createElement("span");
        rank.className = "result-ranking__rank";
        rank.textContent = `${index + 1}`;
        const name = ownerDocument.createElement("span");
        name.className = "result-ranking__name";
        name.textContent = safeText(entry?.name) || "名無し";
        const value = ownerDocument.createElement("strong");
        value.className = "result-ranking__score";
        value.textContent = `${formatScore(entry?.score)} / ${Math.max(0, Math.trunc(Number(entry?.maxChain) || 0))}連鎖`;
        item.append(rank, name, value);
        rankingList.append(item);
      });
    }
  }
  return { score, maxChain, breakdown, hint: resultHintFor(state), shareText, ranking: entries };
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
    if (navigatorObject?.share) {
      await navigatorObject.share({ text });
      return true;
    }
    if (navigatorObject?.clipboard?.writeText) {
      await navigatorObject.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return fallbackCopy(text);
};

export default renderResult;
