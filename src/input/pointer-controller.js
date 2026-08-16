import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
} from "../config/rules.js";
import {
  createPointerSampler,
  readPointerFrame,
  updatePointerSampler,
} from "../core/input-frame.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Touch input maps the finger to the target. Mouse input keeps the small
// above-finger offset that prevents the cursor from covering the reticle.
export const TOUCH_AIM_OFFSET_RATIO = 0;
export const MOUSE_AIM_OFFSET_RATIO = 0.1;

/**
 * Convert a browser client coordinate into M2's fixed 16:9 board.  The
 * renderer may change the canvas backing resolution or device-pixel ratio;
 * this conversion only reads the CSS bounding rect, so those changes cannot
 * alter a replay.
 */
export const clientToBoard = (clientX, clientY, rect, {
  boardWidth = BOARD_WIDTH,
  boardHeight = BOARD_HEIGHT,
  aimOffsetRatio = 0.1,
} = {}) => {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
      !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      rect.width <= 0 || rect.height <= 0 ||
      !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  const fingerX = clamp((Number(clientX) - rect.left) / rect.width, 0, 1);
  const fingerY = clamp((Number(clientY) - rect.top) / rect.height, 0, 1);
  const shortSide = Math.min(rect.width, rect.height);
  const offset = Math.max(1, shortSide * aimOffsetRatio);
  const margin = Math.max(1, offset * 0.45);
  let aimPixelX = fingerX * rect.width;
  let aimPixelY = fingerY * rect.height - offset;

  // The aim is normally above the finger.  At the top edge there is no room
  // above, so move sideways toward the board interior; at the bottom edge the
  // upward aim remains the safe direction.  Always clamp the aim itself.
  if (aimPixelY < margin) {
    const direction = fingerX <= 0.5 ? 1 : -1;
    aimPixelX += direction * offset;
    aimPixelY = fingerY * rect.height;
  }
  if (fingerY > 1 - margin / rect.height) aimPixelY = fingerY * rect.height - offset;
  aimPixelX = clamp(aimPixelX, margin, rect.width - margin);
  aimPixelY = clamp(aimPixelY, margin, rect.height - margin);

  return {
    // x/y are the aim location sent to M2.  fingerX/fingerY are display-only
    // values and never enter the replay schema.
    x: Math.round(aimPixelX / rect.width * boardWidth),
    y: Math.round(aimPixelY / rect.height * boardHeight),
    aimX: Math.round(aimPixelX / rect.width * boardWidth),
    aimY: Math.round(aimPixelY / rect.height * boardHeight),
    fingerX: Math.round(fingerX * boardWidth),
    fingerY: Math.round(fingerY * boardHeight),
  };
};

const pointerIdOf = (event) => Number.isInteger(event?.pointerId) && event.pointerId >= 0
  ? event.pointerId
  : null;

/**
 * Browser-only adapter for M2's fixed-tick pointer sampler.
 *
 * It deliberately does not call the game core from DOM event handlers.  DOM
 * events only update the latest owned position; GameSession samples that
 * position once for each deterministic update.
 */
export class PointerController {
  constructor(element, {
    boardWidth = BOARD_WIDTH,
    boardHeight = BOARD_HEIGHT,
    onChange = null,
    onInterrupt = null,
    isInputAllowed = null,
  } = {}) {
    if (!element || typeof element.addEventListener !== "function") {
      throw new TypeError("PointerController requires an event target");
    }
    this.element = element;
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
    this.sampler = createPointerSampler();
    this.fingerX = 0;
    this.fingerY = 0;
    this.pendingRelease = false;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.onInterrupt = typeof onInterrupt === "function" ? onInterrupt : null;
    this.isInputAllowed = typeof isInputAllowed === "function" ? isInputAllowed : () => true;
    this.destroyed = false;
    this.handlers = {
      pointerdown: (event) => this.handlePointerDown(event),
      pointermove: (event) => this.handlePointerMove(event),
      pointerup: (event) => this.handlePointerUp(event),
      pointercancel: (event) => this.handlePointerCancel(event),
      lostpointercapture: (event) => this.handleLostPointerCapture(event),
      contextmenu: (event) => {
        if (event.cancelable) event.preventDefault();
      },
      visibilitychange: () => {
        if (document.visibilityState !== "visible") this.interrupt("visibilitychange");
      },
      pagehide: () => this.interrupt("pagehide"),
      orientationchange: () => this.interrupt("orientationchange"),
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      element.addEventListener(type, this.handlers[type], { passive: false });
    }
    element.addEventListener("lostpointercapture", this.handlers.lostpointercapture, { passive: true });
    element.addEventListener("contextmenu", this.handlers.contextmenu, { passive: false });
    // visibilitychange is dispatched on document, not window.  Keeping this
    // listener here makes the adapter safe even when no GameController is
    // attached; the controller separately stops its fixed-tick clock.
    document.addEventListener("visibilitychange", this.handlers.visibilitychange, { passive: true });
    window.addEventListener("pagehide", this.handlers.pagehide, { passive: true });
    window.addEventListener("orientationchange", this.handlers.orientationchange, { passive: true });
    element.style.touchAction = "none";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.webkitTouchCallout = "none";
    element.style.webkitTapHighlightColor = "transparent";
  }

  boardPoint(event) {
    if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
    const point = clientToBoard(
      event.clientX,
      event.clientY,
      this.element.getBoundingClientRect(),
      {
        boardWidth: this.boardWidth,
        boardHeight: this.boardHeight,
        aimOffsetRatio: event?.pointerType === "touch"
          ? TOUCH_AIM_OFFSET_RATIO
          : MOUSE_AIM_OFFSET_RATIO,
      },
    );
    return point;
  }

  normalizeEvent(event, type) {
    const point = this.boardPoint(event);
    if (!point) return null;
    return {
      type,
      pointerId: pointerIdOf(event),
      x: point.x,
      y: point.y,
    };
  }

  notify(change = {}) {
    const position = this.position;
    if (this.element.dataset) {
      this.element.dataset.activePointerId = position.pointerId === null ? "" : String(position.pointerId);
      this.element.dataset.pointerPressed = position.pressed ? "true" : "false";
      this.element.dataset.aimX = String(position.aimX);
      this.element.dataset.aimY = String(position.aimY);
      this.element.dataset.fingerX = String(position.fingerX);
      this.element.dataset.fingerY = String(position.fingerY);
      this.element.dataset.pointerCapture = position.pointerId !== null &&
        typeof this.element.hasPointerCapture === "function" &&
        this.element.hasPointerCapture(position.pointerId) ? "true" : "false";
    }
    if (this.onChange) this.onChange({ ...change, ...position });
  }

  capture(pointerId) {
    if (!Number.isInteger(pointerId) || typeof this.element.setPointerCapture !== "function" ||
        typeof this.element.hasPointerCapture !== "function") return false;
    try {
      this.element.setPointerCapture(pointerId);
      // setPointerCapture can be shimmed or silently ignored. Verify the
      // pending capture synchronously so an outside pointerup cannot strand
      // the owned gesture.
      return this.element.hasPointerCapture(pointerId) === true;
    } catch {
      // A pointer may already have been released by the browser.  The sampler
      // remains authoritative and will still produce a release frame.
      return false;
    }
  }

  release(pointerId) {
    if (!Number.isInteger(pointerId) || typeof this.element.releasePointerCapture !== "function") return;
    try {
      if (this.element.hasPointerCapture?.(pointerId)) this.element.releasePointerCapture(pointerId);
    } catch {
      // Pointer Capture is best-effort during pagehide/orientationchange.
    }
  }

  handlePointerDown(event) {
    if (event.cancelable) event.preventDefault();
    if (!this.isInputAllowed()) return;
    // Keep a pending release/cancel marker ahead of a new pointerdown so the
    // next fixed tick records the boundary instead of transferring ownership
    // before the previous action has been sampled.
    if (this.sampler.marker !== null || this.pendingRelease) return;
    const pointerId = pointerIdOf(event);
    const normalized = this.normalizeEvent(event, "pointerdown");
    if (!normalized) return;
    const accepted = updatePointerSampler(this.sampler, normalized);
    if (!accepted) return;
    this.pendingRelease = false;
    const point = this.boardPoint(event);
    this.fingerX = point.fingerX;
    this.fingerY = point.fingerY;
    if (!this.capture(pointerId)) {
      // Without capture, an up event outside the canvas could leave the
      // sampler pressed forever. Convert the failed acquisition into the
      // normal one-shot interrupt marker instead.
      this.interrupt("pointercapture-failed");
      return;
    }
    this.notify({ type: "pointerdown", pointerId });
  }

  handlePointerMove(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (!this.isInputAllowed() && this.sampler.activePointerId === pointerId) {
      // The phase may have moved to finalizing while a finger is still down.
      // Release that gesture without inventing an orientation lifecycle pause.
      this.interrupt("input-disabled");
      return;
    }
    const normalized = this.normalizeEvent(event, "pointermove");
    if (!normalized) {
      if (this.sampler.activePointerId === pointerId) this.interrupt("invalid-pointer-geometry");
      return;
    }
    const accepted = updatePointerSampler(this.sampler, normalized);
    if (!accepted) return;
    this.pendingRelease = false;
    const point = this.boardPoint(event);
    this.fingerX = point.fingerX;
    this.fingerY = point.fingerY;
    this.notify({ type: "pointermove", pointerId });
  }

  handlePointerUp(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.sampler.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    if (!this.isInputAllowed() && this.sampler.activePointerId === pointerId) {
      this.interrupt("input-disabled");
      return;
    }
    const normalized = this.normalizeEvent(event, "pointerup");
    if (!normalized) {
      if (this.sampler.activePointerId === pointerId) this.interrupt("invalid-pointer-geometry");
      return;
    }
    const accepted = updatePointerSampler(this.sampler, normalized);
    if (!accepted) return;
    this.pendingRelease = true;
    const point = this.boardPoint(event);
    this.fingerX = point.fingerX;
    this.fingerY = point.fingerY;
    this.release(pointerId);
    this.notify({ type: "pointerup", pointerId });
  }

  handlePointerCancel(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.sampler.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    const normalized = this.normalizeEvent(event, "pointercancel");
    if (!normalized) {
      if (this.sampler.activePointerId === pointerId) this.interrupt("invalid-pointer-geometry");
      return;
    }
    const accepted = updatePointerSampler(this.sampler, normalized);
    if (!accepted) return;
    this.pendingRelease = false;
    const point = this.boardPoint(event);
    this.fingerX = point.fingerX;
    this.fingerY = point.fingerY;
    this.release(pointerId);
    this.notify({ type: "pointercancel", pointerId });
    if (this.onInterrupt) this.onInterrupt("pointercancel");
  }

  handleLostPointerCapture(event) {
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.sampler.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    if (this.sampler.activePointerId === pointerId) this.interrupt("lostpointercapture");
  }

  /** Force-release an owned pointer without inventing a browser event. */
  interrupt(reason = "interrupted") {
    if (this.destroyed) return false;
    const lifecycleReason = [
      "visibilitychange",
      "pagehide",
      "orientationchange",
      "lostpointercapture",
      "frame-backlog",
    ].includes(reason);
    const hadPointer = this.sampler.activePointerId !== null || this.sampler.pressed || this.pendingRelease;
    const hadMarker = this.sampler.marker !== null;
    const pointerId = this.sampler.activePointerId;
    let accepted = updatePointerSampler(this.sampler, { type: "interrupt" });
    // A pointerup can clear activePointerId before its release frame is
    // sampled. A lifecycle boundary must replace that pending release with a
    // single interrupted frame so it cannot detonate on resume.
    if (!accepted && lifecycleReason && !hadMarker && this.sampler.marker === null) {
      this.sampler.marker = "interrupted";
      accepted = true;
    }
    if (accepted) this.pendingRelease = false;
    if (accepted) this.release(pointerId);
    if ((hadPointer || accepted) && !hadMarker) {
      this.notify({ type: "interrupt", reason });
      if (this.onInterrupt) this.onInterrupt(reason);
    }
    return accepted;
  }

  sampleFrame(tick, actionId) {
    const frame = readPointerFrame(this.sampler, tick, actionId);
    this.pendingRelease = false;
    return frame;
  }

  get position() {
    return {
      x: clamp(this.sampler.x, 0, this.boardWidth),
      y: clamp(this.sampler.y, 0, this.boardHeight),
      aimX: clamp(this.sampler.x, 0, this.boardWidth),
      aimY: clamp(this.sampler.y, 0, this.boardHeight),
      fingerX: clamp(this.fingerX ?? this.sampler.x, 0, this.boardWidth),
      fingerY: clamp(this.fingerY ?? this.sampler.y, 0, this.boardHeight),
      pressed: this.sampler.pressed === true,
      pointerId: this.sampler.activePointerId,
    };
  }

  get activePointerId() {
    return this.sampler.activePointerId;
  }

  get pressed() {
    return this.sampler.pressed === true;
  }

  clear() {
    this.interrupt("clear");
    this.sampler.x = 0;
    this.sampler.y = 0;
    this.sampler.marker = null;
    this.fingerX = 0;
    this.fingerY = 0;
    this.pendingRelease = false;
  }

  destroy() {
    if (this.destroyed) return;
    // Clear while listeners and the sampler are still live so a held pointer
    // cannot survive teardown.  Avoid invoking the session callback during
    // destruction because there will be no next fixed tick to consume it.
    const onInterrupt = this.onInterrupt;
    this.onInterrupt = null;
    this.clear();
    this.onInterrupt = onInterrupt;
    this.destroyed = true;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      this.element.removeEventListener(type, this.handlers[type]);
    }
    this.element.removeEventListener("lostpointercapture", this.handlers.lostpointercapture);
    this.element.removeEventListener("contextmenu", this.handlers.contextmenu);
    document.removeEventListener("visibilitychange", this.handlers.visibilitychange);
    window.removeEventListener("pagehide", this.handlers.pagehide);
    window.removeEventListener("orientationchange", this.handlers.orientationchange);
  }
}

export default PointerController;
