import { DEFAULT_RULES, mergeRules } from "../config/rules.js";
import { detonate } from "./engine.js";

export { detonate };

export const selectionRadiusMultiplierPercent = (count) => {
  const value = Number.isFinite(count) ? Math.trunc(count) : 0;
  return Math.min(140, 100 + Math.max(0, value - 3) * 15);
};

export const selectionDurationMultiplierPercent = (count) => {
  const value = Number.isFinite(count) ? Math.trunc(count) : 0;
  if (value <= 4) return 100;
  return Math.min(115, 100 + (value - 3) * 5);
};

// Compatibility name kept for the M2 public surface. The argument is a
// selection count, never wall-clock hold time.
export const holdDurationMultiplierPercent = selectionDurationMultiplierPercent;

export const attenuatedRadius = (base, percent) => Math.round(
  Math.max(0, Number.isFinite(base) ? base : 0) *
  Math.max(0, Number.isFinite(percent) ? percent : 0) / 100,
);

const idCompare = (left, right) => String(left).localeCompare(String(right), "en", { numeric: true });
const distanceSquared = (leftX, leftY, rightX, rightY) =>
  (leftX - rightX) ** 2 + (leftY - rightY) ** 2;

/** Resolve a chain without mutating the game. Input order does not affect it. */
export const resolveChain = (entities = [], options = {}) => {
  const rules = mergeRules(options.rules ?? DEFAULT_RULES);
  const ordered = [...entities].sort((left, right) => idCompare(left.id, right.id));
  const byId = new Map(ordered.map((entity) => [String(entity.id), entity]));
  const selectedIds = [...(options.selectedIds ?? [])].map(String).sort(idCompare);
  const directX = Number.isInteger(options.directX) ? options.directX : 0;
  const directY = Number.isInteger(options.directY) ? options.directY : 0;
  const events = [];
  const claimedTargets = new Set();
  let eventId = 0;
  const startTick = Number.isInteger(options.tick) ? options.tick : 0;
  const actionId = Number.isInteger(options.actionId) ? options.actionId : 0;
  const radiusMultiplierPercent = selectionRadiusMultiplierPercent(selectedIds.length);
  const durationMultiplierPercent = selectionDurationMultiplierPercent(selectedIds.length);
  const directRadius = attenuatedRadius(rules.baseExplosionRadius, radiusMultiplierPercent);
  const explosionDurationTicks = Math.round(
    rules.baseExplosionDurationTicks * durationMultiplierPercent / 100,
  );
  for (const id of selectedIds) {
    const source = byId.get(id);
    if (!source || claimedTargets.has(id)) continue;
    claimedTargets.add(id);
    eventId += 1;
    events.push({
      fireTick: startTick,
      actionId,
      sourceId: source.id,
      eventId,
      targetId: source.id,
      x: directX,
      y: directY,
      generation: 0,
      radius: directRadius,
      directRadius,
      radiusMultiplierPercent,
      durationMultiplierPercent,
      explosionDurationTicks,
    });
  }
  const queue = [...events];
  while (queue.length) {
    queue.sort((left, right) =>
      left.fireTick - right.fireTick || left.actionId - right.actionId ||
      idCompare(left.sourceId, right.sourceId) || left.eventId - right.eventId,
    );
    const fireTick = queue[0].fireTick;
    if (fireTick > startTick + rules.maxChainTicks) {
      return { events, simulationFault: { code: "CHAIN_TICK_LIMIT" } };
    }
    const due = [];
    while (queue.length && queue[0].fireTick === fireTick) due.push(queue.shift());
    const proposals = [];
    for (const event of due) {
      const source = byId.get(String(event.targetId));
      if (!source) continue;
      const originX = Number.isInteger(event.x) ? event.x : source.x;
      const originY = Number.isInteger(event.y) ? event.y : source.y;
      for (const candidate of ordered) {
        const candidateId = String(candidate.id);
        if (claimedTargets.has(candidateId)) continue;
        const percent = candidate.color === source.color
          ? rules.sameColorRadius
          : rules.differentColorRadius;
        const radius = Math.max(
          attenuatedRadius(event.directRadius, rules.minimumRadius),
          attenuatedRadius(event.radius, percent),
        );
        const candidateDistance = distanceSquared(originX, originY, candidate.x, candidate.y);
        if (candidateDistance > radius * radius) continue;
        proposals.push({ event, source, candidate, radius, candidateDistance });
      }
    }
    proposals.sort((left, right) =>
      left.event.fireTick - right.event.fireTick ||
      left.event.actionId - right.event.actionId ||
      idCompare(left.source.id, right.source.id) ||
      left.event.eventId - right.event.eventId ||
      left.candidateDistance - right.candidateDistance ||
      right.candidate.depth - left.candidate.depth ||
      idCompare(left.candidate.id, right.candidate.id),
    );
    for (const proposal of proposals) {
      const candidateId = String(proposal.candidate.id);
      if (claimedTargets.has(candidateId)) continue;
      claimedTargets.add(candidateId);
      eventId += 1;
      const child = {
        fireTick: proposal.event.fireTick + 1,
        actionId: proposal.event.actionId,
        sourceId: proposal.source.id,
        eventId,
        targetId: proposal.candidate.id,
        x: proposal.candidate.x,
        y: proposal.candidate.y,
        generation: proposal.event.generation + 1,
        radius: proposal.radius,
        directRadius: proposal.event.directRadius,
        radiusMultiplierPercent: proposal.event.radiusMultiplierPercent,
        durationMultiplierPercent: proposal.event.durationMultiplierPercent,
        explosionDurationTicks: proposal.event.explosionDurationTicks,
      };
      events.push(child);
      queue.push(child);
      if (events.length > rules.maxChainEvents) {
        return { events, simulationFault: { code: "CHAIN_EVENT_LIMIT" } };
      }
    }
  }
  events.sort((left, right) =>
    left.fireTick - right.fireTick || left.actionId - right.actionId ||
    idCompare(left.sourceId, right.sourceId) || left.eventId - right.eventId,
  );
  return { events, simulationFault: null };
};
