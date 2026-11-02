import { t, getLocale } from '../i18n/index.js';
import {
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
} from "../config/rules.js";
import { scoreForChain } from "../core/scoring.js";

const integer = (value) => Math.max(0, Math.trunc(Number(value) || 0));
const format = (value) => integer(value).toLocaleString(getLocale());

export const explosionRangeRows = (rules = DEFAULT_RULES) => [3, 4, 5, 6].map((count) => ({
  count,
  label: count === 6 ? t("6個以上") : t("{0}個", [count]),
  radius: directExplosionRadiusForSelection(count, rules),
}));

export const scoreGuideModel = (rules = DEFAULT_RULES) => ({
  direct: t("直接起爆した花火1個につき +{0}点", [format(rules.directScore)]),
  preparation: t("4個目以降の選択は1個につき +{0}点（1回最大 +{1}点）", [format(rules.preparationScorePerExtraSelection), format(rules.preparationScoreCap)]),
  chain: t("連鎖は1個 +{0}点から始まり、世代ごとに{1}%上昇（最大 +{2}点/個）", [format(rules.chainScoreBase), integer(rules.chainScoreGrowthPercent), format(scoreForChain(7, rules))]),
  inclusion: t("1回の起爆で4個目以降を巻き込むたび +{0}点（1回最大 +{1}点）", [format(rules.inclusionScorePerExtraTarget), format(rules.inclusionScoreCap)]),
  forecast: rules.forecastPlanLeadTicks
    ? t("次の波まで{0}秒以内に予告色をちょうど{1}個（うち金色の二重リング{2}個以上）準備すると +{3}点。そこから対象の次波を連鎖させると1個 +{4}点", [(rules.forecastPlanLeadTicks / rules.tickRate).toFixed(1), integer(rules.forecastPlanSelectionCount), integer(rules.minimumSelection), format(rules.forecastPlanBonus), format(rules.forecastPlanChainBonusPerTarget)])
    : t("予告色{0}個の準備成功で +{1}点。予告連鎖は1個 +{2}点", [integer(rules.forecastPlanSelectionCount), format(rules.forecastPlanBonus), format(rules.forecastPlanChainBonusPerTarget)]),
  penalty: t("減点はありません。選択不足、キャンセル、時間切れの花火は0点です", []),
  choices: t("ゲーム中は同色{0}個以上の選択肢を常に確保します。花火が消えたときも自動補充されます", [integer(rules.minimumPlayableChoices)]),
  selection: t("1本指で花火の中心から判定半径{0}以内を約{1}秒（{2}更新）、外輪が一周して選択数が増えるまで押すと選択されます。選択開始から{3}秒で、3個以上は自動起爆、3個未満は取消です", [format(rules.selectionHitRadius), (rules.minHoldTicks / rules.tickRate).toFixed(2), integer(rules.minHoldTicks), (rules.selectionTimeoutTicks / rules.tickRate).toFixed(1)]),
  ranges: explosionRangeRows(rules),
});

export const renderRulesGuide = (root, rules = DEFAULT_RULES) => {
  if (!root?.querySelector) return null;
  const model = scoreGuideModel(rules);
  const setText = (id, value) => {
    const element = root.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  };
  for (const key of ["direct", "preparation", "chain", "inclusion", "forecast", "penalty", "choices", "selection"]) {
    setText(`rule-${key}`, model[key]);
  }
  const range = root.querySelector("#rule-explosion-ranges");
  if (range) {
    range.textContent = model.ranges.map((row) => `${row.label}: ${format(row.radius)}`).join(" / ");
  }
  return model;
};

export default renderRulesGuide;
