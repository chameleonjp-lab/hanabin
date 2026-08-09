import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createStrategyReplayLog } from "../src/core/input-frame.js";
import { DEFAULT_RULES } from "../src/config/rules.js";
import { replayGame } from "../src/core/replay.js";
import { runSimulation } from "../src/core/simulation.js";
import { stateFingerprint } from "../src/core/state.js";

const simulation = runSimulation(0, { strategy: "shortest-three" });
const replay = createStrategyReplayLog({
  seed: simulation.seed,
  rules: DEFAULT_RULES,
  frames: simulation.inputFrames,
});
const replayed = replayGame(replay);
const simulationFingerprint = stateFingerprint(simulation.state);
const replayFingerprint = stateFingerprint(replayed.state);
if (replayed.simulationFault || replayFingerprint !== simulationFingerprint) {
  throw new Error("generated replay did not reproduce its complete final state");
}
const serializedReplay = `${JSON.stringify(replay)}\n`;
writeFileSync("m2-strict-replay.json", serializedReplay, "utf8");
console.log(JSON.stringify({
  seed: replay.seed,
  ruleVersion: replay.ruleVersion,
  inputSchemaVersion: replay.inputSchemaVersion,
  frameCount: replay.frames.length,
  score: simulation.score,
  replayScore: replayed.state.score,
  scoreEventCount: replayed.state.scoreEvents.length,
  bonusEventCount: replayed.state.bonusEvents.length,
  finalStateMatched: true,
  replaySha256: createHash("sha256").update(serializedReplay).digest("hex"),
}));
