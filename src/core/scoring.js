import { DEFAULT_RULES, mergeRules, scoreForColor } from "../config/rules.js";

export { scoreForColor };

const integer = (value) => Number.isFinite(value) ? Math.trunc(value) : 0;
const nonNegative = (value) => Math.max(0, integer(value));

export const scoreForDirect = (directCount = 0, rules = DEFAULT_RULES) =>
  nonNegative(directCount) * rules.directScore;

export const scoreForPreparation = (selectedCount = 0, rules = DEFAULT_RULES) => Math.min(
  rules.preparationScoreCap,
  Math.max(0, nonNegative(selectedCount) - rules.minimumSelection) *
    rules.preparationScorePerExtraSelection,
);

export const scoreForChain = (generation = 0, rules = DEFAULT_RULES) => {
  const depth = Math.min(7, nonNegative(generation));
  if (depth <= 0) return 0;
  return Math.min(
    rules.chainScoreCap,
    Math.round(rules.chainScoreBase * (100 + Math.max(0, depth - 1) * rules.chainScoreGrowthPercent) / 100),
  );
};

export const scoreForInclusion = (includedCount = 0, rules = DEFAULT_RULES) => Math.min(
  rules.inclusionScoreCap,
  Math.max(0, nonNegative(includedCount) - rules.minimumSelection) * rules.inclusionScorePerExtraTarget,
);

export const calculateScore = ({
  directCount = 0,
  selectedCount = 0,
  chainGenerations = [],
  includedCount = 0,
  rules = DEFAULT_RULES,
} = {}) => {
  const resolvedRules = mergeRules(rules);
  const generations = Array.isArray(chainGenerations) ? chainGenerations : [];
  return scoreForDirect(directCount, resolvedRules) +
    scoreForPreparation(selectedCount, resolvedRules) +
    generations.reduce((total, generation) => total + scoreForChain(generation, resolvedRules), 0) +
    scoreForInclusion(includedCount, resolvedRules);
};

export const scoreEventAmount = (sourceColor, targetColor, rules = DEFAULT_RULES) =>
  scoreForColor(sourceColor, targetColor, mergeRules(rules));

export default calculateScore;
