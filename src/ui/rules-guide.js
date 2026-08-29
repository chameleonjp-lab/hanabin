import {
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
} from "../config/rules.js";
import { scoreForChain } from "../core/scoring.js";

const integer = (value) => Math.max(0, Math.trunc(Number(value) || 0));
const format = (value) => integer(value).toLocaleString("ja-JP");

export const explosionRangeRows = (rules = DEFAULT_RULES) => [3, 4, 5, 6].map((count) => ({
  count,
  label: count === 6 ? "6個以上" : `${count}個`,
  radius: directExplosionRadiusForSelection(count, rules),
}));

export const scoreGuideModel = (rules = DEFAULT_RULES) => ({
  direct: `直接起爆した花火1個につき +${format(rules.directScore)}点`,
  preparation: `4個目以降の選択は1個につき +${format(rules.preparationScorePerExtraSelection)}点（1回最大 +${format(rules.preparationScoreCap)}点）`,
  chain: `連鎖は1個 +${format(rules.chainScoreBase)}点から始まり、世代ごとに${integer(rules.chainScoreGrowthPercent)}%上昇（最大 +${format(scoreForChain(7, rules))}点/個）`,
  inclusion: `1回の起爆で4個目以降を巻き込むたび +${format(rules.inclusionScorePerExtraTarget)}点（1回最大 +${format(rules.inclusionScoreCap)}点）`,
  forecast: rules.forecastPlanLeadTicks
    ? `次の波まで${(rules.forecastPlanLeadTicks / rules.tickRate).toFixed(1)}秒以内に予告色をちょうど${integer(rules.forecastPlanSelectionCount)}個（うち金色の二重リング${integer(rules.minimumSelection)}個以上）準備すると +${format(rules.forecastPlanBonus)}点。そこから対象の次波を連鎖させると1個 +${format(rules.forecastPlanChainBonusPerTarget)}点`
    : `予告色${integer(rules.forecastPlanSelectionCount)}個の準備成功で +${format(rules.forecastPlanBonus)}点。予告連鎖は1個 +${format(rules.forecastPlanChainBonusPerTarget)}点`,
  penalty: `減点はありません。選択不足、キャンセル、時間切れの花火は0点です`,
  choices: `ゲーム中は同色${integer(rules.minimumPlayableChoices)}個以上の選択肢を常に確保します。花火が消えたときも自動補充されます`,
  selection: `1本指で花火の中心から判定半径${format(rules.selectionHitRadius)}以内を約${(rules.minHoldTicks / rules.tickRate).toFixed(2)}秒（${integer(rules.minHoldTicks)}更新）、外輪が一周して選択数が増えるまで押すと選択されます。選択開始から${(rules.selectionTimeoutTicks / rules.tickRate).toFixed(1)}秒で、3個以上は自動起爆、3個未満は取消です`,
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
