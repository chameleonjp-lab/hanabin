export const PRESENTATION_EVENT_TYPES = Object.freeze([
  "tap",
  "trace",
  "select",
  "detonate",
  "chain",
  "milestone",
  "spawn",
  "expire",
  "score",
  "cancel",
]);

export const PRESENTATION_CHAIN_MILESTONES = Object.freeze([5, 10, 20, 30]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Math.trunc(finite(value, fallback));
const array = (value) => Array.isArray(value) ? value : [];
const distance = (left, right) => Math.hypot(
  finite(right?.x) - finite(left?.x),
  finite(right?.y) - finite(left?.y),
);
const pathDistance = (from, frame, to) => {
  const path = array(frame?.path).filter((point) =>
    Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
  if (!path.length) return distance(from, to);
  let total = 0;
  let previous = from;
  for (const point of path) {
    total += distance(previous, point);
    previous = point;
  }
  return total + distance(previous, to);
};

const runKeyFor = (state) => [
  state?.gameVersion ?? "game",
  state?.ruleVersion ?? "rules",
  state?.rulesFingerprint ?? "fingerprint",
  state?.seed ?? "seed",
].join(":");

const actionKeyFor = (state) => {
  const action = state?.lastAction;
  if (!action?.type) return "";
  return [
    action.type,
    action.actionId ?? "",
    action.id ?? "",
    action.reason ?? "",
    action.type === "select" ? (state?.lastAcquisitionTick ?? "") : "",
    ["selection-cancelled", "selection-cleared", "deselect"].includes(action.type)
      ? integer(state?.stats?.selectionDrops)
      : "",
  ].join(":");
};

const waveEntityCount = (wave) => {
  if (Array.isArray(wave?.entities)) return wave.entities.length;
  if (Array.isArray(wave?.fireworks)) return wave.fireworks.length;
  return Math.max(0, integer(wave?.count));
};

/**
 * Converts append-only deterministic state ledgers into bounded, deduplicated
 * presentation events. It never mutates the supplied state.
 */
export class PresentationEventTracker {
  constructor({
    traceDistance = 240,
    milestones = PRESENTATION_CHAIN_MILESTONES,
  } = {}) {
    this.traceDistance = Math.max(1, finite(traceDistance, 240));
    this.milestones = Object.freeze([...new Set(array(milestones)
      .map((value) => Math.max(1, integer(value)))
      .sort((left, right) => left - right))]);
    this.reset();
  }

  reset(state = null) {
    this.runKey = state ? runKeyFor(state) : null;
    this.lastTick = state ? integer(state.tick) : -1;
    this.inputIndex = 0;
    this.waveIndex = 0;
    this.scoreIndex = 0;
    this.bonusIndex = 0;
    this.previousSpawned = 0;
    this.previousExpired = 0;
    this.previousMaxChain = 0;
    this.previousSelectionDrops = state
      ? Math.max(0, integer(state?.stats?.selectionDrops))
      : 0;
    this.pointerPressed = false;
    this.pointerPoint = null;
    this.traceDistanceCarry = 0;
    this.lastActionKey = "";
    return this;
  }

  needsReset(state) {
    if (!state || typeof state !== "object") return false;
    if (this.runKey === null || this.runKey !== runKeyFor(state)) return true;
    if (integer(state.tick) < this.lastTick) return true;
    if (array(state.inputFrames).length < this.inputIndex) return true;
    if (array(state.waves).length < this.waveIndex) return true;
    if (array(state.scoreEvents).length < this.scoreIndex) return true;
    if (array(state.bonusEvents).length < this.bonusIndex) return true;
    if (integer(state.stats?.entitiesSpawned) < this.previousSpawned) return true;
    if (integer(state.stats?.entitiesExpired) < this.previousExpired) return true;
    if (integer(state.stats?.maxChain) < this.previousMaxChain) return true;
    if (integer(state.stats?.selectionDrops) < this.previousSelectionDrops) return true;
    return false;
  }

  consumePointerFrames(state, events) {
    const frames = array(state.inputFrames);
    let traced = 0;
    let finalPoint = this.pointerPoint;
    for (const frame of frames.slice(this.inputIndex)) {
      const interrupted = frame?.cancelled === true || frame?.interrupted === true;
      if (interrupted) {
        if (!events.some((event) => event.type === "cancel")) {
          events.push({
            type: "cancel",
            reason: frame.cancelled === true ? "pointer-cancelled" : "pointer-interrupted",
            tick: integer(frame.tick, integer(state.tick)),
          });
        }
        this.pointerPressed = false;
        this.pointerPoint = null;
        this.traceDistanceCarry = 0;
        continue;
      }
      const pressed = frame?.type === "pointer" && frame.pressed === true;
      const point = { x: integer(frame?.x), y: integer(frame?.y) };
      if (pressed && !this.pointerPressed) {
        events.push({ type: "tap", x: point.x, y: point.y, tick: integer(frame.tick) });
        this.traceDistanceCarry = 0;
      } else if (pressed && this.pointerPressed && this.pointerPoint) {
        traced += pathDistance(this.pointerPoint, frame, point);
      }
      this.pointerPressed = pressed;
      this.pointerPoint = pressed ? point : null;
      finalPoint = pressed ? point : finalPoint;
      if (!pressed) this.traceDistanceCarry = 0;
    }
    this.inputIndex = frames.length;
    this.traceDistanceCarry += traced;
    if (this.pointerPressed && this.traceDistanceCarry >= this.traceDistance) {
      events.push({
        type: "trace",
        distance: Math.round(this.traceDistanceCarry),
        x: finalPoint?.x ?? 0,
        y: finalPoint?.y ?? 0,
        tick: integer(state.tick),
      });
      this.traceDistanceCarry %= this.traceDistance;
    }
  }

  consumeLastAction(state, events) {
    const action = state.lastAction;
    const key = actionKeyFor(state);
    if (!key || key === this.lastActionKey) return;
    this.lastActionKey = key;
    if (action.type === "select") {
      const entity = array(state.fireworks).find((item) => String(item.id) === String(action.id));
      events.push({
        type: "select",
        targetId: action.id,
        count: array(state.selectedIds).length,
        color: entity?.color ?? state.selectedColor ?? null,
        tick: integer(state.tick),
      });
    } else if (action.type === "detonate") {
      events.push({
        type: "detonate",
        actionId: action.actionId ?? null,
        count: Math.max(0, integer(action.count)),
        tick: integer(state.tick),
      });
    } else if (["selection-cancelled", "selection-cleared", "deselect"].includes(action.type) &&
        !events.some((event) => event.type === "cancel")) {
      events.push({
        type: "cancel",
        reason: action.reason ?? action.type,
        tick: integer(state.tick),
      });
    }
  }

  consumeSelectionDrops(state, events) {
    const drops = Math.max(0, integer(state.stats?.selectionDrops));
    if (drops > this.previousSelectionDrops && !events.some((event) => event.type === "cancel")) {
      events.push({
        type: "cancel",
        reason: state.lastAction?.reason ?? "selection-dropped",
        count: drops - this.previousSelectionDrops,
        tick: integer(state.tick),
      });
    }
    this.previousSelectionDrops = drops;
  }

  consumeWavesAndExpiry(state, events) {
    const waves = array(state.waves);
    const added = waves.slice(this.waveIndex);
    const spawned = Math.max(0, integer(state.stats?.entitiesSpawned));
    if (added.length) {
      const metadataCount = added.reduce((sum, wave) => sum + waveEntityCount(wave), 0);
      events.push({
        type: "spawn",
        waves: added.length,
        count: Math.max(0, spawned - this.previousSpawned) || metadataCount,
        waveIndex: added.at(-1)?.waveIndex ?? null,
        tick: integer(state.tick),
      });
    }
    this.waveIndex = waves.length;
    this.previousSpawned = spawned;

    const expired = Math.max(0, integer(state.stats?.entitiesExpired));
    if (expired > this.previousExpired) {
      events.push({
        type: "expire",
        count: expired - this.previousExpired,
        tick: integer(state.tick),
      });
    }
    this.previousExpired = expired;
  }

  consumeScoreLedgers(state, events) {
    const scoreEvents = array(state.scoreEvents);
    const bonusEvents = array(state.bonusEvents);
    const addedScores = scoreEvents.slice(this.scoreIndex);
    const addedBonuses = bonusEvents.slice(this.bonusIndex);
    this.scoreIndex = scoreEvents.length;
    this.bonusIndex = bonusEvents.length;

    const chainGroups = new Map();
    for (const event of addedScores) {
      if (event?.kind !== "chain") continue;
      const depth = Math.max(0, integer(event.depth ?? event.generation));
      const key = `${event.actionId ?? "action"}:${event.fireTick ?? state.tick}:${depth}`;
      const group = chainGroups.get(key) ?? {
        type: "chain",
        actionId: event.actionId ?? null,
        fireTick: integer(event.fireTick, integer(state.tick)),
        depth,
        count: 0,
        amount: 0,
      };
      group.count += 1;
      group.amount += Math.max(0, integer(event.amount));
      chainGroups.set(key, group);
    }
    events.push(...chainGroups.values());

    const maxChain = Math.max(0, integer(state.stats?.maxChain));
    for (const milestone of this.milestones) {
      if (this.previousMaxChain < milestone && milestone <= maxChain) {
        events.push({ type: "milestone", milestone, tick: integer(state.tick) });
      }
    }
    this.previousMaxChain = maxChain;

    const scoreAmount = [...addedScores, ...addedBonuses]
      .reduce((sum, event) => sum + Math.max(0, integer(event?.amount)), 0);
    if (scoreAmount > 0) {
      events.push({
        type: "score",
        amount: scoreAmount,
        entries: addedScores.length + addedBonuses.length,
        tick: integer(state.tick),
      });
    }
  }

  consume(state) {
    if (!state || typeof state !== "object") return [];
    if (this.needsReset(state)) this.reset(state);
    const events = [];
    this.consumePointerFrames(state, events);
    this.consumeLastAction(state, events);
    this.consumeSelectionDrops(state, events);
    this.consumeWavesAndExpiry(state, events);
    this.consumeScoreLedgers(state, events);
    this.lastTick = integer(state.tick);
    return events;
  }

  snapshot() {
    return {
      runKey: this.runKey,
      lastTick: this.lastTick,
      inputIndex: this.inputIndex,
      waveIndex: this.waveIndex,
      scoreIndex: this.scoreIndex,
      bonusIndex: this.bonusIndex,
      previousSpawned: this.previousSpawned,
      previousExpired: this.previousExpired,
      previousMaxChain: this.previousMaxChain,
      previousSelectionDrops: this.previousSelectionDrops,
      pointerPressed: this.pointerPressed,
      traceDistanceCarry: this.traceDistanceCarry,
    };
  }
}

export const createPresentationEventTracker = (options) => new PresentationEventTracker(options);

export default PresentationEventTracker;
