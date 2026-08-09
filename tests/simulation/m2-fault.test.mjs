import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";
import { applyInputFrame, createGame, validateGame } from "../../src/core/engine.js";

test("invalid pointer coordinates become a deterministic fault, not a silent repair", () => {
  const state = createGame(0, DEFAULT_RULES);
  applyInputFrame(state, {
    tick: 0,
    actionId: 0,
    type: "pointer",
    pressed: true,
    x: DEFAULT_RULES.boardWidth + 1,
    y: 0,
  }, { rules: DEFAULT_RULES });
  assert.equal(state.status, "fault");
  assert.equal(state.simulationFault.code, "POINTER_OUT_OF_RANGE");
});

test("reversed action IDs become a deterministic fault and state validation stays explicit", () => {
  const state = createGame(0, DEFAULT_RULES);
  applyInputFrame(state, {
    tick: 0,
    actionId: 0,
    type: "noop",
    pressed: false,
    x: 0,
    y: 0,
  }, { rules: DEFAULT_RULES });
  applyInputFrame(state, {
    tick: 1,
    actionId: 0,
    type: "noop",
    pressed: false,
    x: 0,
    y: 0,
  }, { rules: DEFAULT_RULES });
  assert.equal(state.status, "fault");
  assert.equal(state.simulationFault.code, "ACTION_ORDER");
  assert.deepEqual(validateGame(state), []);
});

test("state validation detects a score ledger mismatch", () => {
  const state = createGame(0, DEFAULT_RULES);
  state.score = 999;
  assert.ok(validateGame(state).includes("SCORE_LEDGER_MISMATCH"));
});
