import { createStrategyReplayLog } from "../src/core/input-frame.js";
import { DEFAULT_RULES } from "../src/config/rules.js";
import { replayGame } from "../src/core/replay.js";
import { runSimulation } from "../src/core/simulation.js";

const simulation = runSimulation(0, { strategy: "shortest-three" });
const replay = createStrategyReplayLog({
  seed: simulation.seed,
  rules: DEFAULT_RULES,
  frames: simulation.inputFrames,
});
const replayed = replayGame(replay);
if (replayed.simulationFault || replayed.state.score !== simulation.score) {
  throw new Error("generated replay did not reproduce its score");
}
console.log(JSON.stringify({
  seed: replay.seed,
  ruleVersion: replay.ruleVersion,
  inputSchemaVersion: replay.inputSchemaVersion,
  frameCount: replay.frames.length,
  score: simulation.score,
  replayScore: replayed.state.score,
}));
