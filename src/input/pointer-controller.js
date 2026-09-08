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

// Every pointer type uses the coordinate under the pointer as its aim. Keep
// these exports as zero-valued compatibility markers for callers that used to
// inspect the input mode's offset.
export const TOUCH_AIM_OFFSET_RATIO = 0;
export const MOUSE_AIM_OFFSET_RATIO = 0;

/**
 * Convert a browser client coordinate into M2's fixed 16:9 board.  The
 * renderer may change the canvas backing resolution or device-pixel ratio;
 * this conversion only reads the CSS bounding rect, so those changes cannot
 * alter a replay.
 */
export const clientToBoard = (clientX, clientY, rect, {
  boardWidth = BOARD_WIDTH,
  boardHeight = BOARD_HEIGHT,
  orientation = "landscape",
} = {}) => {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
      !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      rect.width <= 0 || rect.height <= 0 ||
      !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  const fingerX = clamp((Number(clientX) - rect.left) / rect.width, 0, 1);
  const fingerY = clamp((Number(clientY) - rect.top) / rect.height, 0, 1);
  // Keep the aim and the display-only finger marker on the same pixel. The
  // board's fixed logical coordinates are the only values sent to the core.
  const aimPixelX = fingerX * rect.width;
  const aimPixelY = fingerY * rect.height;

  const toBoard = (pixelX, pixelY) => orientation === "portrait"
    ? {
      // In portrait the logical 16:9 board is rotated clockwise. The
      // logical top is on screen-right and the logical bottom on screen-left.
      x: Math.round(pixelY / rect.height * boardWidth),
      y: Math.round((rect.width - pixelX) / rect.width * boardHeight),
    }
    : {
      x: Math.round(pixelX / rect.width * boardWidth),
      y: Math.round(pixelY / rect.height * boardHeight),
    };
  const aim = toBoard(aimPixelX, aimPixelY);
  const finger = toBoard(fingerX * rect.width, fingerY * rect.height);
  return {
    // x/y are the aim location sent to M2.  fingerX/fingerY are display-only
    // values and never enter the replay schema.
    x: aim.x,
    y: aim.y,
    aimX: aim.x,
    aimY: aim.y,
    fingerX: finger.x,
    fingerY: finger.y,
  };
};

const pointerIdOf = (event) => Number.isInteger(event?.pointerId) && event.pointerId >= 0
  ? event.pointerId
  : null;

// Safari normally exposes Pointer Events, but a few embedded/webview paths
// still deliver only Touch Events. Keep the fallback id outside the browser's
// usual pointer-id range so a native pointer cannot be confused with it.
const TOUCH_FALLBACK_POINTER_ID_BASE = 1_000_000;

const firstTouch = (event, identifier = null) => {
  const changed = Array.from(event?.changedTouches ?? []);
  const active = Array.from(event?.touches ?? []);
  const candidates = [...changed, ...active];
  return candidates.find((touch) => identifier === null || touch?.identifier === identifier) ?? null;
};

// A touchend/touchcancel can contain another finger in `touches` while the
// owned finger is still down. Terminal handlers must only inspect
// changedTouches so a secondary finger cannot release the game's gesture.
const terminalTouch = (event, identifier, fallback = null) => {
  const changed = Array.from(event?.changedTouches ?? []);
  if (changed.length > 0) return changed.find((touch) => touch?.identifier === identifier) ?? null;
  return fallback;
};

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
    onLifecycle = null,
    isInputAllowed = null,
    orientation = "landscape",
  } = {}) {
    if (!element || typeof element.addEventListener !== "function") {
      throw new TypeError("PointerController requires an event target");
    }
    this.element = element;
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
    this.orientation = orientation === "portrait" ? "portrait" : "landscape";
    this.sampler = createPointerSampler();
    this.fingerX = 0;
    this.fingerY = 0;
    this.pendingRelease = false;
    this.deferredPointer = null;
    this.captureMode = "none";
    this.touchFallbackPointerId = null;
    this.touchFallbackIdentifier = null;
    this.touchFallbackClientX = null;
    this.touchFallbackClientY = null;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.onInterrupt = typeof onInterrupt === "function" ? onInterrupt : null;
    this.onLifecycle = typeof onLifecycle === "function" ? onLifecycle : null;
    this.isInputAllowed = typeof isInputAllowed === "function" ? isInputAllowed : () => true;
    this.destroyed = false;
    this.handlers = {
      pointerdown: (event) => this.handlePointerDown(event),
      pointermove: (event) => this.handlePointerMove(event),
      pointerup: (event) => this.handlePointerUp(event),
      pointercancel: (event) => this.handlePointerCancel(event),
      touchstart: (event) => this.handleTouchStart(event),
      touchmove: (event) => this.handleTouchMove(event),
      touchend: (event) => this.handleTouchEnd(event),
      touchcancel: (event) => this.handleTouchCancel(event),
      lostpointercapture: (event) => this.handleLostPointerCapture(event),
      contextmenu: (event) => {
        if (event.cancelable) event.preventDefault();
      },
      visibilitychange: () => {
        if (document.visibilityState !== "visible") this.handleLifecycle("visibilitychange");
      },
      pagehide: () => this.handleLifecycle("pagehide"),
      orientationchange: () => this.handleLifecycle("orientationchange"),
      fallbackPointerMove: (event) => this.handleFallbackPointerEvent(event),
      fallbackPointerUp: (event) => this.handleFallbackPointerEvent(event),
      fallbackPointerCancel: (event) => this.handleFallbackPointerEvent(event),
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      element.addEventListener(type, this.handlers[type], { passive: false });
    }
    // Touch Events are a compatibility path for WebKit containers that do
    // not emit Pointer Events. On browsers that emit both, the native pointer
    // owns the sampler first and these handlers remain no-ops.
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
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
    // Pointer Capture is supported by current browsers, but some embedded
    // webviews and older engines can reject it. Window listeners are a
    // release-safe fallback for events that leave the canvas. Events whose
    // target is the canvas are already handled by the element listeners and
    // are ignored here to avoid double sampling.
    for (const type of ["pointermove", "pointerup", "pointercancel"]) {
      window.addEventListener(type, this.handlers[`fallbackPointer${type === "pointermove" ? "Move" : type === "pointerup" ? "Up" : "Cancel"}`], { passive: false });
    }
    element.style.touchAction = "none";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.webkitTouchCallout = "none";
    element.style.webkitTapHighlightColor = "transparent";
    element.dataset.orientation = this.orientation;
  }

  setOrientation(orientation = "landscape") {
    const next = orientation === "portrait" ? "portrait" : "landscape";
    const changed = this.orientation !== next;
    this.orientation = next;
    if (this.element.dataset) this.element.dataset.orientation = next;
    return changed;
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
        orientation: this.orientation,
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

  syntheticTouchEvent(type, touch) {
    return {
      type,
      pointerId: TOUCH_FALLBACK_POINTER_ID_BASE + Number(touch.identifier),
      pointerType: "touch",
      clientX: Number(touch.clientX),
      clientY: Number(touch.clientY),
      cancelable: true,
      target: this.element,
      preventDefault() {},
    };
  }

  handleTouchStart(event) {
    if (event.cancelable) event.preventDefault();
    const touch = firstTouch(event);
    if (!touch || this.sampler.activePointerId !== null || this.deferredPointer !== null ||
        this.touchFallbackPointerId !== null) return;
    const pointerId = TOUCH_FALLBACK_POINTER_ID_BASE + Number(touch.identifier);
    this.touchFallbackPointerId = pointerId;
    this.touchFallbackIdentifier = Number(touch.identifier);
    this.touchFallbackClientX = Number(touch.clientX);
    this.touchFallbackClientY = Number(touch.clientY);
    this.handlePointerDown(this.syntheticTouchEvent("pointerdown", touch));
    if (this.sampler.activePointerId !== pointerId && this.deferredPointer?.pointerId !== pointerId) {
      this.touchFallbackPointerId = null;
      this.touchFallbackIdentifier = null;
      this.touchFallbackClientX = null;
      this.touchFallbackClientY = null;
    }
  }

  handleTouchMove(event) {
    if (event.cancelable) event.preventDefault();
    if (this.touchFallbackPointerId === null) return;
    const touch = firstTouch(event, this.touchFallbackIdentifier);
    if (touch) {
      this.touchFallbackClientX = Number(touch.clientX);
      this.touchFallbackClientY = Number(touch.clientY);
      this.handlePointerMove(this.syntheticTouchEvent("pointermove", touch));
    }
  }

  handleTouchEnd(event) {
    if (event.cancelable) event.preventDefault();
    if (this.touchFallbackPointerId === null) return;
    const touch = terminalTouch(event, this.touchFallbackIdentifier, {
      identifier: this.touchFallbackIdentifier,
      clientX: this.touchFallbackClientX,
      clientY: this.touchFallbackClientY,
    });
    if (!touch) return;
    this.touchFallbackClientX = Number(touch.clientX);
    this.touchFallbackClientY = Number(touch.clientY);
    this.handlePointerUp(this.syntheticTouchEvent("pointerup", touch));
    this.touchFallbackPointerId = null;
    this.touchFallbackIdentifier = null;
    this.touchFallbackClientX = null;
    this.touchFallbackClientY = null;
  }

  handleTouchCancel(event) {
    if (event.cancelable) event.preventDefault();
    if (this.touchFallbackPointerId === null) return;
    const touch = terminalTouch(event, this.touchFallbackIdentifier, {
      identifier: this.touchFallbackIdentifier,
      clientX: this.touchFallbackClientX,
      clientY: this.touchFallbackClientY,
    });
    if (!touch) return;
    this.handlePointerCancel(this.syntheticTouchEvent("pointercancel", touch));
    this.touchFallbackPointerId = null;
    this.touchFallbackIdentifier = null;
    this.touchFallbackClientX = null;
    this.touchFallbackClientY = null;
  }

  notify(change = {}) {
    const position = this.position;
    if (this.element.dataset) {
      if (change.type) this.element.dataset.lastPointerChange = String(change.type);
      this.element.dataset.activePointerId = position.pointerId === null ? "" : String(position.pointerId);
      this.element.dataset.pointerPressed = position.pressed ? "true" : "false";
      this.element.dataset.aimX = String(position.aimX);
      this.element.dataset.aimY = String(position.aimY);
      this.element.dataset.fingerX = String(position.fingerX);
      this.element.dataset.fingerY = String(position.fingerY);
      this.element.dataset.pointerCapture = position.pointerId !== null &&
        typeof this.element.hasPointerCapture === "function" &&
        this.element.hasPointerCapture(position.pointerId) ? "true" : "false";
      this.element.dataset.pointerCaptureMode = this.captureMode;
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
    // If Touch Events won the race in a WebKit container, ignore the later
    // compatibility Pointer Event rather than reporting a false second tap.
    if (this.touchFallbackPointerId !== null && event.pointerType === "touch" &&
        event.pointerId !== this.touchFallbackPointerId &&
        this.sampler.activePointerId === this.touchFallbackPointerId) return;
    // Keep a pending release/cancel marker ahead of a new pointerdown so the
    // next fixed tick records the boundary instead of transferring ownership
    // before the previous action has been sampled.
    const pointerId = pointerIdOf(event);
    const ownerPointerId = this.sampler.activePointerId ?? this.deferredPointer?.pointerId ?? null;
    if (ownerPointerId !== null && ownerPointerId !== pointerId) {
      const ignoredCount = Math.max(0, Number(this.element.dataset?.secondaryPointerIgnored) || 0) + 1;
      if (this.element.dataset) this.element.dataset.secondaryPointerIgnored = String(ignoredCount);
      this.notify({
        type: "secondary-pointer-ignored",
        secondaryPointerId: pointerId,
        ownerPointerId,
      });
      return;
    }
    if (this.sampler.marker !== null || this.pendingRelease) {
      const normalized = this.normalizeEvent(event, "pointerdown");
      const point = this.boardPoint(event);
      if (!normalized || !point) {
        this.notify({ type: "pointerdown-ignored-pending-boundary", ignoredPointerId: pointerId });
        return;
      }
      const captured = this.capture(pointerId);
      this.captureMode = captured ? "native" : "fallback";
      // Preserve the unsampled release/cancel as the next fixed-tick frame,
      // but keep a genuinely held second tap ready for the following tick.
      // This removes the narrow dead zone without overwriting replay order.
      this.deferredPointer = {
        pointerId,
        normalized,
        fingerX: point.fingerX,
        fingerY: point.fingerY,
      };
      this.notify({ type: "pointerdown-queued-after-boundary", pointerId });
      return;
    }
    const normalized = this.normalizeEvent(event, "pointerdown");
    if (!normalized) return;
    const accepted = updatePointerSampler(this.sampler, normalized);
    if (!accepted) return;
    this.pendingRelease = false;
    const point = this.boardPoint(event);
    this.fingerX = point.fingerX;
    this.fingerY = point.fingerY;
    const captured = this.capture(pointerId);
    this.captureMode = captured ? "native" : "fallback";
    this.notify({ type: "pointerdown", pointerId, pointerCapture: this.captureMode });
  }

  handlePointerMove(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (this.deferredPointer?.pointerId === pointerId) {
      if (!this.isInputAllowed()) {
        this.interrupt("input-disabled");
        return;
      }
      const normalized = this.normalizeEvent(event, "pointerdown");
      const point = this.boardPoint(event);
      if (!normalized || !point) {
        this.interrupt("invalid-pointer-geometry");
        return;
      }
      this.deferredPointer = {
        pointerId,
        normalized,
        fingerX: point.fingerX,
        fingerY: point.fingerY,
      };
      this.notify({ type: "deferred-pointermove", pointerId });
      return;
    }
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

  handleFallbackPointerEvent(event) {
    const pointerId = pointerIdOf(event);
    const ownedPointerId = this.sampler.activePointerId ?? this.deferredPointer?.pointerId ?? null;
    if (pointerId === null || ownedPointerId !== pointerId) return;
    const eventTarget = event?.target;
    if (eventTarget && (eventTarget === this.element || this.element.contains?.(eventTarget))) return;
    if (event?.type === "pointermove") this.handlePointerMove(event);
    else if (event?.type === "pointerup") this.handlePointerUp(event);
    else if (event?.type === "pointercancel") this.handlePointerCancel(event);
  }

  handlePointerUp(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    if (this.deferredPointer?.pointerId === pointerId) {
      this.deferredPointer = null;
      this.release(pointerId);
      this.captureMode = "none";
      this.notify({ type: "deferred-pointerup", pointerId });
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
    this.captureMode = "none";
    this.notify({ type: "pointerup", pointerId });
  }

  handlePointerCancel(event) {
    if (event.cancelable) event.preventDefault();
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    if (this.deferredPointer?.pointerId === pointerId) {
      this.deferredPointer = null;
      this.release(pointerId);
      this.captureMode = "none";
      this.notify({ type: "deferred-pointercancel", pointerId });
      if (this.onInterrupt) this.onInterrupt("pointercancel");
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
    this.captureMode = "none";
    this.notify({ type: "pointercancel", pointerId });
    if (this.onInterrupt) this.onInterrupt("pointercancel");
  }

  handleLostPointerCapture(event) {
    const pointerId = pointerIdOf(event);
    if (pointerId === null) {
      if (this.sampler.activePointerId !== null) this.interrupt("invalid-pointer-event");
      return;
    }
    if (this.activePointerId === pointerId) this.handleLifecycle("lostpointercapture");
  }

  /** Notify lifecycle owners even when no pointer is currently held. */
  handleLifecycle(reason) {
    if (this.destroyed) return false;
    const interrupted = this.interrupt(reason);
    if (this.onLifecycle) this.onLifecycle(reason, { interrupted, position: this.position });
    return interrupted;
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
    const deferredPointerId = this.deferredPointer?.pointerId ?? null;
    const hadPointer = this.sampler.activePointerId !== null || this.sampler.pressed ||
      this.pendingRelease || deferredPointerId !== null;
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
    if (accepted) this.captureMode = "none";
    if (deferredPointerId !== null) {
      this.deferredPointer = null;
      this.release(deferredPointerId);
    }
    if ((hadPointer || accepted) && !hadMarker) {
      this.notify({ type: "interrupt", reason });
      if (this.onInterrupt) this.onInterrupt(reason);
    }
    return accepted;
  }

  sampleFrame(tick, actionId) {
    const frame = readPointerFrame(this.sampler, tick, actionId);
    this.pendingRelease = false;
    const deferred = this.deferredPointer;
    if (deferred) {
      this.deferredPointer = null;
      const accepted = updatePointerSampler(this.sampler, deferred.normalized);
      if (accepted) {
        this.fingerX = deferred.fingerX;
        this.fingerY = deferred.fingerY;
        this.notify({ type: "pointerdown-activated", pointerId: deferred.pointerId });
      } else {
        this.release(deferred.pointerId);
      }
    }
    return frame;
  }

  get position() {
    const deferred = this.deferredPointer;
    const aimX = deferred?.normalized.x ?? this.sampler.x;
    const aimY = deferred?.normalized.y ?? this.sampler.y;
    return {
      x: clamp(aimX, 0, this.boardWidth),
      y: clamp(aimY, 0, this.boardHeight),
      aimX: clamp(aimX, 0, this.boardWidth),
      aimY: clamp(aimY, 0, this.boardHeight),
      fingerX: clamp(deferred?.fingerX ?? this.fingerX ?? aimX, 0, this.boardWidth),
      fingerY: clamp(deferred?.fingerY ?? this.fingerY ?? aimY, 0, this.boardHeight),
      pressed: deferred !== null || this.sampler.pressed === true,
      pointerId: deferred?.pointerId ?? this.sampler.activePointerId,
    };
  }

  get activePointerId() {
    return this.deferredPointer?.pointerId ?? this.sampler.activePointerId;
  }

  get pressed() {
    return this.deferredPointer !== null || this.sampler.pressed === true;
  }

  clear() {
    this.interrupt("clear");
    this.sampler.x = 0;
    this.sampler.y = 0;
    this.sampler.marker = null;
    this.captureMode = "none";
    this.fingerX = 0;
    this.fingerY = 0;
    this.pendingRelease = false;
    this.deferredPointer = null;
    this.touchFallbackPointerId = null;
    this.touchFallbackIdentifier = null;
    this.touchFallbackClientX = null;
    this.touchFallbackClientY = null;
  }

  destroy() {
    if (this.destroyed) return;
    // Clear while listeners and the sampler are still live so a held pointer
    // cannot survive teardown.  Avoid invoking the session callback during
    // destruction because there will be no next fixed tick to consume it.
    const onInterrupt = this.onInterrupt;
    const onLifecycle = this.onLifecycle;
    this.onInterrupt = null;
    this.onLifecycle = null;
    this.clear();
    this.onInterrupt = onInterrupt;
    this.onLifecycle = onLifecycle;
    this.destroyed = true;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      this.element.removeEventListener(type, this.handlers[type]);
    }
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      this.element.removeEventListener(type, this.handlers[type]);
    }
    this.element.removeEventListener("lostpointercapture", this.handlers.lostpointercapture);
    this.element.removeEventListener("contextmenu", this.handlers.contextmenu);
    document.removeEventListener("visibilitychange", this.handlers.visibilitychange);
    window.removeEventListener("pagehide", this.handlers.pagehide);
    window.removeEventListener("orientationchange", this.handlers.orientationchange);
    for (const type of ["pointermove", "pointerup", "pointercancel"]) {
      window.removeEventListener(type, this.handlers[`fallbackPointer${type === "pointermove" ? "Move" : type === "pointerup" ? "Up" : "Cancel"}`]);
    }
  }
}

export default PointerController;
