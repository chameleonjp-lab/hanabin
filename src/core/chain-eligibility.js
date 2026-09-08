import {
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
  mergeRules,
} from "../config/rules.js";

/**
 * A choice reserve keeps the board playable after a wave disappears. It is a
 * selectable direct target, but it must never participate in propagation.
 */
export const CHAIN_INELIGIBLE_LAYOUT = "choice-reserve";

const hasLiveState = (entity) => entity &&
  (entity.status === undefined || entity.status === "active") &&
  entity.visible !== false &&
  entity.chainReserved !== true &&
  entity.chainQueued !== true;

/** Return whether an entity may be the source of a propagated chain. */
export const isChainSourceEligible = (entity) => Boolean(
  hasLiveState(entity) &&
  entity.layout !== CHAIN_INELIGIBLE_LAYOUT &&
  entity.chainable !== false,
);

/** Return whether an entity may be captured as a propagated chain target. */
export const isChainTargetEligible = (entity) => Boolean(
  hasLiveState(entity) &&
  entity.layout !== CHAIN_INELIGIBLE_LAYOUT,
);

/**
 * Read-only direct-radius geometry shared by the core-facing tests and HUD.
 * The returned array is new and the input entities are never mutated.
 */
export const chainTargetsWithinDirectRadius = ({
  selectedEntities = [],
  candidateEntities = [],
  selectionCount = selectedEntities.length,
  rules: rulesArg = DEFAULT_RULES,
} = {}) => {
  const rules = mergeRules(rulesArg);
  const safeSelectionCount = Math.max(0, Math.trunc(Number(selectionCount) || 0));
  const radius = directExplosionRadiusForSelection(safeSelectionCount, rules);
  const radiusSquared = radius ** 2;
  const selectedKeys = new Set(
    (Array.isArray(selectedEntities) ? selectedEntities : []).map((entity) => String(entity?.id)),
  );
  const sources = (Array.isArray(selectedEntities) ? selectedEntities : [])
    .filter(isChainSourceEligible);
  return (Array.isArray(candidateEntities) ? candidateEntities : [])
    .filter(isChainTargetEligible)
    .filter((candidate) => !selectedKeys.has(String(candidate.id)))
    .filter((candidate) => sources.some((source) =>
      Number.isFinite(source.x) && Number.isFinite(source.y) &&
      Number.isFinite(candidate.x) && Number.isFinite(candidate.y) &&
      (source.x - candidate.x) ** 2 + (source.y - candidate.y) ** 2 <= radiusSquared,
    ));
};

export default isChainTargetEligible;
