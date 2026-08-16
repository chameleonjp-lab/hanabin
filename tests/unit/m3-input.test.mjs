import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clientToBoard,
  PointerController,
} from "../../src/input/pointer-controller.js";
import { getEdgeAwareReticlePosition } from "../../src/render/competitive-layer.js";

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

test("a Pointer Capture failure clears the pointer and emits one interrupted marker", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget({ throwOnCapture: true });
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 19, clientX: 50, clientY: 50 });
    assert.equal(controller.activePointerId, null);
    assert.equal(controller.pressed, false);
    assert.deepEqual(interrupts, ["pointercapture-failed"]);

    const interrupted = controller.sampleFrame(0, 0);
    const following = controller.sampleFrame(1, 1);
    assert.equal(interrupted.pressed, false);
    assert.equal(interrupted.interrupted, true);
    assert.equal(following.interrupted, undefined);
    assert.equal(controller.activePointerId, null);
    controller.destroy();
  });
});

test("a Pointer Capture no-op is detected instead of leaving a pressed pointer", () => {
  withBrowserGlobals(() => {
    const element = makeEventTarget({ noOpCapture: true });
    const interrupts = [];
    const controller = new PointerController(element, {
      onInterrupt: (reason) => interrupts.push(reason),
    });

    element.dispatch("pointerdown", { pointerId: 20, clientX: 50, clientY: 50 });
    assert.equal(controller.activePointerId, null);
    assert.equal(controller.pressed, false);
    assert.deepEqual(interrupts, ["pointercapture-failed"]);
    assert.equal(controller.sampleFrame(0, 0).interrupted, true);
    controller.destroy();
  });
});
