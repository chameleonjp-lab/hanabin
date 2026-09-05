import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clientToBoard,
  PointerController,
} from "../../src/input/pointer-controller.js";
import { getEdgeAwareReticlePosition } from "../../src/render/competitive-layer.js";
import {
  findPracticeCandidate,
  PRACTICE_TARGETS,
  practiceTargetBoardPoint,
  TutorialController,
} from "../../src/ui/tutorial.js";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;

const makeEventTarget = ({
  left = 0,
  top = 0,
  width = 100,
  height = 100,
  throwOnCapture = false,
  noOpCapture = false,
} = {}) => {
  const listeners = new Map();
  const captures = new Set();
  const target = {
    style: {},
    dataset: {},
    getBoundingClientRect: () => ({ left, top, width, height }),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    setPointerCapture(pointerId) {
      if (throwOnCapture) throw new Error("capture unavailable");
      if (!noOpCapture) captures.add(pointerId);
    },
    releasePointerCapture(pointerId) {
      captures.delete(pointerId);
    },
    hasPointerCapture(pointerId) {
      return captures.has(pointerId);
    },
    dispatch(type, event = {}) {
      const source = {
        type,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...event,
      };
      for (const handler of listeners.get(type) ?? []) handler(source);
      return source;
    },
    captured(pointerId) {
      return captures.has(pointerId);
    },
  };
  return target;
};

const withBrowserGlobals = (callback) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentStub = {
    visibilityState: "visible",
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      documentListeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of documentListeners.get(type) ?? []) handler({ type, ...event });
    },
  };
  const windowStub = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      windowListeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of windowListeners.get(type) ?? []) handler({ type, ...event });
    },
  };
  globalThis.document = documentStub;
  globalThis.window = windowStub;
  try {
    return callback({ documentStub, windowStub });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

const makeTutorialFixture = () => {
  const canvas = makeEventTarget({ width: 160, height: 90 });
  const gradient = { addColorStop() {} };
  const transforms = [];
  const context = new Proxy({
    setTransform(...values) { transforms.push(values); },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "createLinearGradient") return () => gradient;
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  Object.assign(canvas, {
    width: 1_600,
    height: 900,
    getContext: () => context,
  });
  const elements = new Map([
    ["#practice-board", makeEventTarget()],
    ["#practice-canvas", canvas],
    ["#practice-value", makeEventTarget()],
    ["#practice-message", makeEventTarget()],
    ["#practice-progress", makeEventTarget()],
    ["#practice-feedback", makeEventTarget()],
    ["#practice-start", makeEventTarget()],
    ["#practice-skip", makeEventTarget()],
    ["#practice-continue", makeEventTarget()],
  ]);
  return {
    canvas,
    context,
    transforms,
    element: { querySelector: (selector) => elements.get(selector) ?? null },
  };
};

test("clientToBoard is based on CSS geometry, not backing-store DPR", () => {
  const oneDevicePixel = clientToBoard(60, 70, {
    left: 10,
    top: 20,
    width: 100,
    height: 100,
  });
  const twoDevicePixel = clientToBoard(120, 140, {
    left: 20,
    top: 40,
    width: 200,
    height: 200,
  });

  assert.deepEqual(
    {
      x: oneDevicePixel.x,
      y: oneDevicePixel.y,
      aimX: oneDevicePixel.aimX,
      aimY: oneDevicePixel.aimY,
      fingerX: oneDevicePixel.fingerX,
      fingerY: oneDevicePixel.fingerY,
    },
    {
      x: twoDevicePixel.x,
      y: twoDevicePixel.y,
      aimX: twoDevicePixel.aimX,
      aimY: twoDevicePixel.aimY,
      fingerX: twoDevicePixel.fingerX,
      fingerY: twoDevicePixel.fingerY,
    },
  );
});

test("touch input uses the finger position instead of the mouse reticle offset", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget({ width: 200, height: 100 });
    const controller = new PointerController(element);

    element.dispatch("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 50,
    });
    const touchPosition = controller.position;
    assert.equal(touchPosition.x, touchPosition.fingerX);
    assert.equal(touchPosition.y, touchPosition.fingerY);

    controller.clear();
    element.dispatch("pointerdown", {
      pointerId: 2,
      pointerType: "mouse",
      clientX: 100,
      clientY: 50,
    });
    const mousePosition = controller.position;
    assert.notEqual(mousePosition.y, mousePosition.fingerY);
    controller.destroy();
  });
});

test("clientToBoard returns null for a zero or invalid rect", () => {
  assert.equal(clientToBoard(10, 10, { left: 0, top: 0, width: 0, height: 100 }), null);
  assert.equal(clientToBoard(10, 10, { left: 0, top: 0, width: 100, height: 0 }), null);
  assert.equal(clientToBoard(10, 10, null), null);
  assert.equal(clientToBoard(Number.NaN, 10, { left: 0, top: 0, width: 100, height: 100 }), null);
  assert.equal(clientToBoard("10", 10, { left: 0, top: 0, width: 100, height: 100 }), null);
});

test("clientToBoard and the renderer keep edge-aware aims inside the board", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const topLeft = clientToBoard(rect.left, rect.top, rect);
  const topRight = clientToBoard(rect.left + rect.width, rect.top, rect);
  const bottomLeft = clientToBoard(rect.left, rect.top + rect.height, rect);
  const bottomRight = clientToBoard(rect.left + rect.width, rect.top + rect.height, rect);

  for (const point of [topLeft, topRight, bottomLeft, bottomRight]) {
    assert.ok(point.x >= 0 && point.x <= BOARD_WIDTH);
    assert.ok(point.y >= 0 && point.y <= BOARD_HEIGHT);
  }
  assert.ok(topLeft.x > topLeft.fingerX);
  assert.ok(topRight.x < topRight.fingerX);
  assert.ok(bottomLeft.y < bottomLeft.fingerY);
  assert.ok(bottomRight.y < bottomRight.fingerY);

  const renderTopLeft = getEdgeAwareReticlePosition(0, 0, 200, 100, {
    offset: 20,
    margin: 5,
  });
  const renderTopRight = getEdgeAwareReticlePosition(200, 0, 200, 100, {
    offset: 20,
    margin: 5,
  });
  const renderBottom = getEdgeAwareReticlePosition(100, 100, 200, 100, {
    offset: 20,
    margin: 5,
  });

  assert.ok(renderTopLeft.x > renderTopLeft.pointerX);
  assert.ok(renderTopRight.x < renderTopRight.pointerX);
  assert.ok(renderBottom.y < renderBottom.pointerY);
  for (const point of [renderTopLeft, renderTopRight, renderBottom]) {
    assert.ok(point.x >= 5 && point.x <= 195);
    assert.ok(point.y >= 5 && point.y <= 95);
  }
});

test("the input surface blocks Safari scrolling, selection, callout, and context menus", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const controller = new PointerController(element);

    assert.equal(element.style.touchAction, "none");
    assert.equal(element.style.userSelect, "none");
    assert.equal(element.style.webkitUserSelect, "none");
    assert.equal(element.style.webkitTouchCallout, "none");
    assert.equal(element.style.webkitTapHighlightColor, "transparent");
    assert.equal(element.dispatch("contextmenu").defaultPrevented, true);
    controller.destroy();
  });
});

test("the first pointer owns the sampler and a second pointer cannot move or release it", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const controller = new PointerController(element);

    element.dispatch("pointerdown", { pointerId: 11, clientX: 50, clientY: 50 });
    const beforeSecond = { ...controller.position };
    assert.equal(controller.activePointerId, 11);
    assert.equal(element.captured(11), true);

    element.dispatch("pointerdown", { pointerId: 22, clientX: 90, clientY: 90 });
    element.dispatch("pointermove", { pointerId: 22, clientX: 90, clientY: 90 });
    element.dispatch("pointerup", { pointerId: 22, clientX: 90, clientY: 90 });
    assert.deepEqual(controller.position, beforeSecond);
    assert.equal(controller.activePointerId, 11);
    assert.equal(controller.pressed, true);
    assert.equal(element.dataset.secondaryPointerIgnored, "1");
    assert.equal(element.dataset.lastPointerChange, "secondary-pointer-ignored");

    element.dispatch("pointerup", { pointerId: 11, clientX: 50, clientY: 50 });
    const frame = controller.sampleFrame(0, 0);
    assert.equal(frame.pressed, false);
    assert.equal(controller.activePointerId, null);
    assert.equal(element.captured(11), false);
    controller.destroy();
  });
});

test("a held pointer released after input becomes disabled does not invent an orientation pause", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const interrupts = [];
    let inputAllowed = true;
    const controller = new PointerController(element, {
      isInputAllowed: () => inputAllowed,
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 31, clientX: 50, clientY: 50 });
    inputAllowed = false;
    element.dispatch("pointerup", { pointerId: 31, clientX: 50, clientY: 50 });

    assert.deepEqual(interrupts, ["input-disabled"]);
    assert.equal(controller.activePointerId, null);
    assert.equal(element.captured(31), false);
    const interrupted = controller.sampleFrame(0, 0);
    assert.equal(interrupted.interrupted, true);
    controller.destroy();
  });
});

test("a malformed terminal event force-releases the owned pointer", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 44, clientX: 50, clientY: 50 });
    element.dispatch("pointerup");

    assert.deepEqual(interrupts, ["invalid-pointer-event"]);
    assert.equal(controller.activePointerId, null);
    assert.equal(element.captured(44), false);
    assert.equal(controller.sampleFrame(0, 0).interrupted, true);
    controller.destroy();
  });
});

test("pointercancel emits one cancellation marker and clears capture", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 4, clientX: 40, clientY: 40 });
    element.dispatch("pointercancel", { pointerId: 4, clientX: 40, clientY: 40 });
    const cancelled = controller.sampleFrame(7, 7);
    const following = controller.sampleFrame(8, 8);

    assert.deepEqual(interrupts, ["pointercancel"]);
    assert.equal(cancelled.pressed, false);
    assert.equal(cancelled.cancelled, true);
    assert.equal(following.pressed, false);
    assert.equal(following.cancelled, undefined);
    assert.equal(following.interrupted, undefined);
    assert.equal(controller.activePointerId, null);
    assert.equal(element.captured(4), false);
    controller.destroy();
  });
});

test("a lifecycle interrupt emits one interrupted marker and can be sampled once", () => {
  withBrowserGlobals(({ documentStub }) => {
    const element = makeEventTarget();
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 8, clientX: 50, clientY: 50 });
    documentStub.visibilityState = "hidden";
    documentStub.dispatch("visibilitychange");
    const interrupted = controller.sampleFrame(3, 3);
    const following = controller.sampleFrame(4, 4);

    assert.deepEqual(interrupts, ["visibilitychange"]);
    assert.equal(interrupted.pressed, false);
    assert.equal(interrupted.interrupted, true);
    assert.equal(following.interrupted, undefined);
    assert.equal(controller.activePointerId, null);
    assert.equal(element.captured(8), false);
    controller.destroy();
  });
});

test("lifecycle owners are notified even when no pointer is active", () => {
  withBrowserGlobals(({ windowStub }) => {
    const element = makeEventTarget();
    const lifecycle = [];
    const controller = new PointerController(element, {
      onLifecycle: (reason, detail) => lifecycle.push({ reason, interrupted: detail.interrupted }),
    });

    windowStub.dispatch("orientationchange");

    assert.deepEqual(lifecycle, [{ reason: "orientationchange", interrupted: true }]);
    assert.equal(controller.sampleFrame(0, 0).interrupted, true);
    assert.equal(controller.sampleFrame(1, 1).interrupted, undefined);
    controller.destroy();
  });
});

test("lostpointercapture safely interrupts only the owned pointer", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const lifecycle = [];
    const controller = new PointerController(element, {
      onLifecycle: (reason) => lifecycle.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 61, clientX: 50, clientY: 50 });
    element.dispatch("lostpointercapture", { pointerId: 99 });
    assert.equal(controller.activePointerId, 61);
    element.dispatch("lostpointercapture", { pointerId: 61 });

    assert.deepEqual(lifecycle, ["lostpointercapture"]);
    assert.equal(controller.activePointerId, null);
    assert.equal(controller.sampleFrame(0, 0).interrupted, true);
    assert.equal(controller.sampleFrame(1, 1).interrupted, undefined);
    controller.destroy();
  });
});

test("a rapid second hold is queued behind the unsampled release boundary", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const controller = new PointerController(element);

    element.dispatch("pointerdown", { pointerId: 71, clientX: 25, clientY: 25 });
    element.dispatch("pointerup", { pointerId: 71, clientX: 25, clientY: 25 });
    element.dispatch("pointerdown", { pointerId: 72, clientX: 75, clientY: 75 });

    assert.equal(controller.activePointerId, 72);
    assert.equal(element.dataset.lastPointerChange, "pointerdown-queued-after-boundary");
    const boundary = controller.sampleFrame(0, 0);
    assert.equal(boundary.pressed, false);
    assert.equal(controller.activePointerId, 72);
    assert.equal(controller.sampleFrame(1, 1).pressed, true);
    controller.destroy();
  });
});

test("a queued second hold can release through the fallback window path", () => {
  withBrowserGlobals(({ windowStub }) => {
    const element = makeEventTarget({ throwOnCapture: true });
    const controller = new PointerController(element);

    element.dispatch("pointerdown", { pointerId: 75, clientX: 25, clientY: 25 });
    element.dispatch("pointerup", { pointerId: 75, clientX: 25, clientY: 25 });
    element.dispatch("pointerdown", { pointerId: 76, clientX: 75, clientY: 75 });

    assert.equal(controller.activePointerId, 76);
    assert.equal(element.dataset.pointerCaptureMode, "fallback");
    windowStub.dispatch("pointermove", {
      pointerId: 76, clientX: 90, clientY: 90,
    });
    windowStub.dispatch("pointerup", {
      pointerId: 76, clientX: 90, clientY: 90,
    });

    assert.equal(controller.activePointerId, null);
    assert.equal(controller.sampleFrame(0, 0).pressed, false);
    assert.equal(controller.sampleFrame(1, 1).pressed, false);
    controller.destroy();
  });
});

test("a second tap released before its queued tick cannot become a ghost hold", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget();
    const controller = new PointerController(element);

    element.dispatch("pointerdown", { pointerId: 73, clientX: 25, clientY: 25 });
    element.dispatch("pointerup", { pointerId: 73, clientX: 25, clientY: 25 });
    element.dispatch("pointerdown", { pointerId: 74, clientX: 75, clientY: 75 });
    element.dispatch("pointerup", { pointerId: 74, clientX: 75, clientY: 75 });

    assert.equal(controller.activePointerId, null);
    assert.equal(controller.sampleFrame(0, 0).pressed, false);
    assert.equal(controller.sampleFrame(1, 1).pressed, false);
    assert.equal(element.captured(74), false);
    controller.destroy();
  });
});

test("practice candidates use the real 16,000 x 9,000 circular hit radius", () => {
  const target = practiceTargetBoardPoint(PRACTICE_TARGETS[0]);
  const rules = { selectionHitRadius: 520 };

  assert.equal(findPracticeCandidate(target, [], rules)?.id, PRACTICE_TARGETS[0].id);
  assert.equal(findPracticeCandidate({ x: target.x + 520, y: target.y }, [], rules)?.id,
    PRACTICE_TARGETS[0].id);
  assert.equal(findPracticeCandidate({ x: target.x + 521, y: target.y }, [], rules), null);
  assert.equal(findPracticeCandidate({ x: target.x + 400, y: target.y + 400 }, [], rules), null);
});

test("portrait client coordinates rotate the logical board clockwise", () => {
  const rect = { left: 10, top: 20, width: 200, height: 400 };
  assert.deepEqual(clientToBoard(110, 220, rect, {
    orientation: "landscape",
    aimOffsetRatio: 0,
  }), { x: 8_000, y: 4_500, aimX: 8_000, aimY: 4_500, fingerX: 8_000, fingerY: 4_500 });
  assert.deepEqual(clientToBoard(210, 20, rect, {
    orientation: "portrait",
    aimOffsetRatio: 0,
  }), { x: 0, y: 0, aimX: 0, aimY: 0, fingerX: 0, fingerY: 0 });
  assert.deepEqual(clientToBoard(10, 20, rect, {
    orientation: "portrait",
    aimOffsetRatio: 0,
  }), { x: 0, y: 9_000, aimX: 0, aimY: 9_000, fingerX: 0, fingerY: 9_000 });
  assert.deepEqual(clientToBoard(210, 420, rect, {
    orientation: "portrait",
    aimOffsetRatio: 0,
  }), { x: 16_000, y: 0, aimX: 16_000, aimY: 0, fingerX: 16_000, fingerY: 0 });
  assert.deepEqual(clientToBoard(10, 420, rect, {
    orientation: "portrait",
    aimOffsetRatio: 0,
  }), { x: 16_000, y: 9_000, aimX: 16_000, aimY: 9_000, fingerX: 16_000, fingerY: 9_000 });
});

test("practice canvas uses CSS dimensions and preserves its DPR transform", () => {
  withBrowserGlobals(({ windowStub }) => {
    windowStub.devicePixelRatio = 2;
    const { canvas, element, transforms } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    assert.equal(canvas.width, 320);
    assert.equal(canvas.height, 180);
    assert.equal(canvas.dataset.practiceCssWidth, "160");
    assert.equal(canvas.dataset.practiceDevicePixelRatio, "2");
    assert.ok(transforms.length >= 2);
    assert.ok(transforms.every((transform) => transform[0] === 2 && transform[3] === 2));
    tutorial.destroy();
  });
});

test("each 60 Hz practice timer callback consumes exactly one input tick", () => {
  withBrowserGlobals(() => {
    const { element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    tutorial.startedAtMs = 1_000;

    tutorial.tick(1_000 + 1_000 / tutorial.rules.tickRate);

    assert.equal(tutorial.snapshot().inputTick, 1);
    tutorial.destroy();
  });
});

test("practice requires three sampled ticks per target and advances after the first release", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    const clientPoint = (target) => ({
      pointerId: 81,
      pointerType: "touch",
      clientX: target.x * 160,
      clientY: target.y * 90,
    });

    canvas.dispatch("pointerdown", clientPoint(PRACTICE_TARGETS[0]));
    tutorial.advanceInputTicks(2);
    assert.equal(tutorial.snapshot().selectedCount, 0);
    tutorial.advanceInputTicks(1);
    assert.equal(tutorial.snapshot().selectedCount, 1);
    for (const target of PRACTICE_TARGETS.slice(1)) {
      canvas.dispatch("pointermove", clientPoint(target));
      tutorial.advanceInputTicks(3);
    }
    assert.equal(tutorial.snapshot().selectedCount, 3);
    assert.equal(tutorial.snapshot().state, "running");
    canvas.dispatch("pointerup", clientPoint(PRACTICE_TARGETS.at(-1)));
    tutorial.advanceInputTicks(1);

    assert.equal(tutorial.snapshot().state, "stage-transition");
    assert.equal(tutorial.snapshot().stage, 1);
    assert.equal(tutorial.snapshot().selectedCount, 3);
    tutorial.destroy();
  });
});

test("practice applies the real 2.5-second selection timeout", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const cancellations = [];
    const tutorial = new TutorialController(element, {
      sound: { cancel: (event) => cancellations.push(event.reason) },
    });
    tutorial.state = "running";
    const target = PRACTICE_TARGETS[0];
    const event = {
      pointerId: 84,
      pointerType: "touch",
      clientX: target.x * 160,
      clientY: target.y * 90,
    };
    canvas.dispatch("pointerdown", event);
    tutorial.advanceInputTicks(3);
    assert.equal(tutorial.snapshot().selectedCount, 1);
    tutorial.advanceInputTicks(tutorial.rules.selectionTimeoutTicks);
    assert.equal(tutorial.snapshot().selectedCount, 0);
    assert.equal(tutorial.snapshot().state, "running");
    assert.equal(tutorial.snapshot().lastFailureReason, "selection-timeout");
    assert.deepEqual(cancellations, ["selection-timeout"]);
    tutorial.destroy();
  });
});

test("practice auto-advances after three selected targets reach the 2.5-second boundary", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    const point = (target) => ({
      pointerId: 85,
      pointerType: "touch",
      clientX: target.x * 160,
      clientY: target.y * 90,
    });

    canvas.dispatch("pointerdown", point(PRACTICE_TARGETS[0]));
    tutorial.advanceInputTicks(3);
    for (const target of PRACTICE_TARGETS.slice(1)) {
      canvas.dispatch("pointermove", point(target));
      tutorial.advanceInputTicks(3);
    }
    assert.equal(tutorial.snapshot().selectedCount, 3);

    tutorial.advanceInputTicks(tutorial.rules.selectionTimeoutTicks);

    assert.equal(tutorial.snapshot().state, "stage-transition");
    assert.equal(tutorial.snapshot().stage, 1);
    assert.equal(tutorial.snapshot().selectedCount, 3);
    tutorial.destroy();
  });
});

test("practice stage two requires moving targets and a real nearby chain target", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    tutorial.stage = 2;
    const clientPoint = (target) => ({
      pointerId: 87,
      pointerType: "touch",
      clientX: target.x * 160,
      clientY: target.y * 90,
    });

    let targets = tutorial.practiceTargets(tutorial.inputTick);
    tutorial.selectedIds = targets.slice(0, 3).map((target) => target.id);
    assert.equal(tutorial.isPracticeChainCaptured(targets), true);
    assert.equal(tutorial.isPracticeChainCaptured(targets.map((target) => target.id === "practice-chain-yellow-1"
      ? { ...target, x: 0.95 }
      : target)), false);
    tutorial.resetGesture();
    targets = tutorial.practiceTargets(tutorial.inputTick);
    canvas.dispatch("pointerdown", clientPoint(targets[0]));
    tutorial.advanceInputTicks(3);
    for (let index = 1; index < 3; index += 1) {
      targets = tutorial.practiceTargets(tutorial.inputTick);
      canvas.dispatch("pointermove", clientPoint(targets[index]));
      tutorial.advanceInputTicks(3);
    }
    assert.equal(tutorial.snapshot().selectedCount, 3);
    canvas.dispatch("pointerup", clientPoint(tutorial.practiceTargets(tutorial.inputTick)[2]));
    tutorial.advanceInputTicks(1);

    assert.equal(tutorial.snapshot().state, "success");
    assert.equal(tutorial.snapshot().stage, 2);
    assert.equal(tutorial.snapshot().chainCaptured, true);
    assert.ok(tutorial.selectedRecords.every((target) => target.x >= 0 && target.x <= 1 &&
      target.y >= 0 && target.y <= 1));
    tutorial.destroy();
  });
});

test("practice ignores a complete press and sweep between two sampled ticks", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    const clientPoint = (target) => ({
      pointerId: 82,
      pointerType: "touch",
      clientX: target.x * 160,
      clientY: target.y * 90,
    });

    canvas.dispatch("pointerdown", clientPoint(PRACTICE_TARGETS[0]));
    for (const target of PRACTICE_TARGETS.slice(1)) {
      canvas.dispatch("pointermove", clientPoint(target));
    }
    canvas.dispatch("pointerup", clientPoint(PRACTICE_TARGETS.at(-1)));
    tutorial.advanceInputTicks(1);

    assert.equal(tutorial.snapshot().state, "running");
    assert.equal(tutorial.snapshot().selectedCount, 0);
    tutorial.destroy();
  });
});

test("practice can acquire a target crossed by a sampled path after three ticks", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    const target = practiceTargetBoardPoint(PRACTICE_TARGETS[1]);
    const framePoint = (actionId) => ({
      pointerId: 86,
      pointerType: "touch",
      clientX: target.x / 100,
      clientY: target.y / 100,
      path: [
        { x: target.x - 1_000, y: target.y },
        { x: target.x, y: target.y },
        { x: target.x + 1_000, y: target.y },
      ],
      actionId,
    });

    canvas.dispatch("pointerdown", {
      pointerId: 86,
      pointerType: "touch",
      clientX: 0,
      clientY: target.y / 100,
    });
    tutorial.consumeInputFrame({
      type: "pointer",
      pressed: true,
      x: target.x + 1_000,
      y: target.y,
      path: framePoint(0).path,
      actionId: 0,
    });
    tutorial.consumeInputFrame({
      type: "pointer",
      pressed: true,
      x: target.x + 1_000,
      y: target.y,
      path: framePoint(1).path,
      actionId: 1,
    });
    assert.equal(tutorial.snapshot().selectedCount, 0);
    tutorial.consumeInputFrame({
      type: "pointer",
      pressed: true,
      x: target.x + 1_000,
      y: target.y,
      path: framePoint(2).path,
      actionId: 2,
    });
    assert.equal(tutorial.snapshot().selectedCount, 1);
    tutorial.destroy();
  });
});

test("practice tap and trace cues use the same 240-board-unit movement contract as play", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const cues = { taps: 0, traces: [] };
    const tutorial = new TutorialController(element, {
      sound: {
        unlock() {},
        tap() { cues.taps += 1; },
        trace(event) { cues.traces.push(event.distance); },
      },
    });
    tutorial.state = "running";
    const pointer = (clientX) => ({
      pointerId: 83,
      pointerType: "touch",
      clientX,
      clientY: 45,
    });

    canvas.dispatch("pointerdown", pointer(10));
    canvas.dispatch("pointermove", pointer(11));
    canvas.dispatch("pointermove", pointer(12));
    assert.equal(cues.taps, 1);
    assert.deepEqual(cues.traces, []);
    canvas.dispatch("pointermove", pointer(13));
    assert.deepEqual(cues.traces, [300]);
    canvas.dispatch("pointerup", pointer(13));
    canvas.dispatch("pointermove", pointer(20));
    assert.deepEqual(cues.traces, [300]);
    tutorial.destroy();
  });
});

test("practice cannot start, skip, or continue while portrait interaction is blocked", () => {
  withBrowserGlobals(() => {
    const { element } = makeTutorialFixture();
    let allowed = false;
    const tutorial = new TutorialController(element, {
      isInteractionAllowed: () => allowed,
    });

    assert.equal(tutorial.snapshot().interactionAllowed, false);
    assert.equal(tutorial.startButton.disabled, true);
    assert.equal(tutorial.begin().state, "ready");
    assert.equal(tutorial.snapshot().lastFailureReason, "portrait-unsupported");
    assert.equal(tutorial.skip().state, "ready");

    allowed = true;
    tutorial.render();
    assert.equal(tutorial.startButton.disabled, false);
    assert.equal(tutorial.begin().state, "running");
    tutorial.destroy();
  });
});

test("a Pointer Capture failure falls back to window events without stranding the pointer", () => {
  withBrowserGlobals(({ windowStub }) => {
    const element = makeEventTarget({ throwOnCapture: true });
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 19, clientX: 50, clientY: 50 });
    assert.equal(controller.activePointerId, 19);
    assert.equal(controller.pressed, true);
    assert.deepEqual(interrupts, []);
    assert.equal(element.dataset.pointerCaptureMode, "fallback");

    windowStub.dispatch("pointermove", {
      pointerId: 19, clientX: 90, clientY: 90,
    });
    assert.equal(controller.position.pressed, true);
    windowStub.dispatch("pointerup", {
      pointerId: 19, clientX: 90, clientY: 90,
    });
    assert.equal(controller.sampleFrame(0, 0).pressed, false);
    assert.equal(controller.activePointerId, null);
    controller.destroy();
  });
});

test("a Pointer Capture no-op also uses the release-safe fallback", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget({ noOpCapture: true });
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 20, clientX: 50, clientY: 50 });
    assert.equal(controller.activePointerId, 20);
    assert.equal(controller.pressed, true);
    assert.deepEqual(interrupts, []);
    assert.equal(element.dataset.pointerCaptureMode, "fallback");
    controller.destroy();
  });
});
