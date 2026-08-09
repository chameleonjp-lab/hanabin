import { DEFAULT_RULES, mergeRules } from "../config/rules.js";
import {
  createReplayLog,
  parseReplayLog,
  validateReplayLog,
} from "./input-frame.js";
import {
  advanceGame,
  applyInputFrame,
  createGame,
  finishGame,
  snapshotGame,
} from "./engine.js";

const faultState = (state, code, details) => {
  state.status = "fault";
  state.simulationFault = { code, message: "replay rejected", tick: state.tick, details };
  return state;
};

export const replayGame = (replayOrSerialized, options = {}) => {
  const rules = mergeRules(options.rules ?? DEFAULT_RULES);
  const replay = parseReplayLog(replayOrSerialized);
  const validationErrors = validateReplayLog(replay, rules);
  const state = createGame(replay?.seed ?? 1, rules);
  if (validationErrors.length) {
    faultState(state, "INVALID_REPLAY", validationErrors);
    return { state, simulationFault: state.simulationFault, validationErrors };
  }
  for (const frame of replay.frames) {
    applyInputFrame(state, frame, { rules });
    if (state.simulationFault) break;
  }
  if (!state.simulationFault && options.finish !== false) {
    if (state.tick < rules.maxTicks) advanceGame(state, rules.maxTicks, rules);
    finishGame(state, rules, false);
  }
  return {
    state: snapshotGame(state),
    simulationFault: state.simulationFault,
    validationErrors: [],
  };
};

export const makeReplay = ({ seed, rules = DEFAULT_RULES, frames = [] }) =>
  createReplayLog({ seed, rules, frames });

export const replayDeterministic = (replay, options = {}) => {
  const first = replayGame(replay, options);
  const second = replayGame(replay, options);
  return {
    deterministic: JSON.stringify(first.state) === JSON.stringify(second.state),
    first,
    second,
  };
};

export default replayGame;
