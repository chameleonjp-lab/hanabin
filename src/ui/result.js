import { forecastSuccessCountFor } from "./forecast-feedback.js";

const formatScore = (value) => Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ja-JP");

const safeText = (value, fallback = "") => typeof value === "string" ? value : fallback;

export const resultHintFor = (state = {}) => {
  const stats = state.stats ?? {};
  const maxChain = Math.max(0, Math.trunc(Number(stats.maxChain) || 0));
  const directTargets = Math.max(0, Math.trunc(Number(stats.directTargets) || 0));
  const chainTargets = Math.max(0, Math.trunc(Number(stats.chainTargets) || 0));
  if (Math.max(0, Number(state.finalScore ?? state.score) || 0) <= 0) {
    return "まずは同じ色の花火を3つ見つけて、3tick押し続けてみましょう。";
  }
  if (maxChain < 5) return "次の波の予告を見て、同じ色を先回りしてつなぐと連鎖が伸びます。";
  if (directTargets > chainTargets) return "次は選択した花火を5個まで増やし、予告対象を準備に使ってみましょう。";
  return "連鎖の途中で次の色へ視線を移し、起爆後の9tickを準備に使ってみましょう。";
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
  setText("result-player-name", safeText(profile.name) || "ゲストプレイヤー");
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
  return { score, maxChain, hint: resultHintFor(state), shareText };
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
