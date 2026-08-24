import assert from "node:assert/strict";
import { test } from "node:test";

import { createOrientationGuide } from "../../src/ui/orientation-guide.js";

test("orientation guide notifies only when orientation actually changes", () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let portrait = false;
  globalThis.window = {
    matchMedia: () => ({ matches: portrait }),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
  };
  const dispatch = (type) => {
    for (const handler of listeners.get(type) ?? []) handler({ type });
  };
  const element = { hidden: false, dataset: {} };
  const transitions = [];
  try {
    const destroy = createOrientationGuide(element, (value) => transitions.push(value));
    assert.equal(element.hidden, true);
    assert.deepEqual(transitions, [{ portrait: false, previousPortrait: null }]);

    dispatch("resize");
    assert.equal(transitions.length, 1, "landscape browser-chrome resize must be inert");

    dispatch("orientationchange");
    assert.deepEqual(transitions.at(-1), { portrait: false, previousPortrait: false });
    assert.equal(transitions.length, 2, "a physical landscape-to-landscape rotation must notify");

    portrait = true;
    dispatch("resize");
    assert.equal(element.hidden, false);
    assert.deepEqual(transitions.at(-1), { portrait: true, previousPortrait: false });
    assert.equal(transitions.length, 3);

    portrait = false;
    dispatch("orientationchange");
    assert.equal(element.hidden, true);
    assert.deepEqual(transitions.at(-1), { portrait: false, previousPortrait: true });
    assert.equal(transitions.length, 4);
    destroy();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
