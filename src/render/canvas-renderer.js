import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEFAULT_RULES,
} from "../config/rules.js";
import {
  boardToCanvas,
  drawCompetitiveLayer,
} from "./competitive-layer.js";
import { DecorativeLayer } from "./decorative-layer.js";
import { QualityController, qualityProfileFor } from "./quality-controller.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const nowMs = () => typeof performance !== "undefined" && Number.isFinite(performance.now())
  ? performance.now()
  : 0;

/** Canvas adapter. It never changes a game state and never feeds dimensions
 * back into the deterministic core. */
export class CanvasRenderer {
  constructor(canvas, {
    boardWidth = BOARD_WIDTH,
    boardHeight = BOARD_HEIGHT,
    maxDevicePixelRatio = 2,
    quality = "high",
    autoQuality = true,
    variant = "touch",
    reducedMotion = false,
    orientation = "landscape",
  } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("CanvasRenderer requires a 2D canvas");
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!this.ctx) throw new Error("Canvas 2D context is unavailable");
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
    this.orientation = orientation === "portrait" ? "portrait" : "landscape";
    this.maxDevicePixelRatio = maxDevicePixelRatio;
    this.qualityController = new QualityController({
      initial: quality,
      auto: autoQuality,
      variant,
      reducedMotion,
    });
    this.decorativeLayer = new DecorativeLayer({
      qualityController: this.qualityController,
      // Allocate the global ceiling once so quality changes and a later
      // touch ↔ desktop capability change cannot strand a smaller pool.
      capacity: Math.max(
        qualityProfileFor("high", { variant: "touch" }).particleCapacity,
        qualityProfileFor("high", { variant: "desktop" }).particleCapacity,
      ),
    });
    this.width = 1600;
    this.height = 900;
    this.devicePixelRatio = 1;
    this.lastAnimationFrameMs = null;
    this.resizeObserver = null;
    this.resize();
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect?.();
    const width = Math.max(1, Math.round(rect?.width || 1600));
    const height = Math.max(1, Math.round(rect?.height || width * 9 / 16));
    const qualityScale = this.qualityController.profile.resolutionScale;
    const devicePixelRatio = typeof window === "undefined"
      ? 1
      : clamp(
        clamp(Number(window.devicePixelRatio) || 1, 1, this.maxDevicePixelRatio) * qualityScale,
        1,
        this.maxDevicePixelRatio,
      );
    this.width = width;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    this.canvas.dataset.cssWidth = String(width);
    this.canvas.dataset.cssHeight = String(height);
    this.canvas.dataset.devicePixelRatio = String(devicePixelRatio);
    this.canvas.dataset.renderQuality = this.qualityController.level;
    this.canvas.dataset.renderResolutionScale = String(qualityScale);
    this.canvas.dataset.renderParticleBudget = String(this.qualityController.profile.particleCapacity);
    this.canvas.dataset.presentationVariant = this.qualityController.variant;
    this.canvas.dataset.reducedMotion = this.qualityController.reducedMotion ? "true" : "false";
    this.canvas.dataset.orientation = this.orientation;
    this.canvas.dataset.competitiveLayer = "protected";
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return { width, height, devicePixelRatio };
  }

  setOrientation(orientation = "landscape") {
    const next = orientation === "portrait" ? "portrait" : "landscape";
    const changed = this.orientation !== next;
    this.orientation = next;
    this.canvas.dataset.orientation = next;
    return changed;
  }

  logicalDimensions() {
    return this.orientation === "portrait"
      ? { width: this.height, height: this.width }
      : { width: this.width, height: this.height };
  }

  applyDisplayTransform() {
    const { ctx } = this;
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    if (this.orientation === "portrait") {
      // Logical top -> screen right; logical bottom -> screen left.
      ctx.translate(this.width, 0);
      ctx.rotate(Math.PI / 2);
    }
  }

  boardPoint(x, y) {
    const { width, height } = this.logicalDimensions();
    const point = boardToCanvas(x, y, width, height, this.boardWidth, this.boardHeight);
    return this.orientation === "portrait"
      ? { x: this.width - point.y, y: point.x }
      : point;
  }

  setQuality(level) {
    const changed = this.qualityController.setQuality(level);
    if (changed) this.resize();
    return this.qualityController.snapshot();
  }

  setAutoQuality(enabled) {
    const next = enabled === true;
    const changed = this.qualityController.auto !== next;
    this.qualityController.auto = next;
    this.qualityController.resetSamples();
    return changed;
  }

  setExperience(experience = {}) {
    const changed = this.qualityController.setExperience(experience);
    if (changed) this.resize();
    return this.qualityController.snapshot();
  }

  /** Observe one requestAnimationFrame boundary, never an individual render call. */
  observeAnimationFrame(timestampMs) {
    const timestamp = Number(timestampMs);
    if (!Number.isFinite(timestamp)) return false;
    const previous = this.lastAnimationFrameMs;
    this.lastAnimationFrameMs = timestamp;
    if (previous === null || timestamp <= previous) return false;
    const changed = this.qualityController.observeFrameInterval(timestamp - previous);
    if (changed) this.resize();
    return changed;
  }

  resetFrameObservation() {
    this.lastAnimationFrameMs = null;
    this.qualityController.resetSamples();
  }

  drawBackground(state, width = this.width, height = this.height) {
    const { ctx } = this;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07132c");
    gradient.addColorStop(0.48, "#080b1c");
    gradient.addColorStop(1, "#120b28");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#8ca6e8";
    ctx.lineWidth = 1;
    const gridStepX = width / 8;
    const gridStepY = height / 5;
    for (let x = gridStepX; x < width; x += gridStepX) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = gridStepY; y < height; y += gridStepY) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    if (state?.upcomingWaves?.length) {
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = "#79e6ff";
      ctx.font = `${Math.max(9, width / 100)}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("FIXED 60Hz / 16:9", width - 12, height - 10);
      ctx.restore();
    }
  }

  render(state, {
    pointer = null,
    phase = "playing",
    rules = DEFAULT_RULES,
  } = {}) {
    const startedAt = nowMs();
    const { width, height } = this;
    const logical = this.logicalDimensions();
    this.applyDisplayTransform();
    if (!state) {
      this.drawBackground(null, logical.width, logical.height);
      this.decorativeLayer.render(null);
      this.canvas.dataset.renderQuality = this.qualityController.level;
      return;
    }
    const { ctx } = this;
    this.drawBackground(state, logical.width, logical.height);

    // Decorative visuals are intentionally rendered before the competitive
    // layer. Targets, selection count, forecast, reticle and exact geometry
    // remain readable at every quality level.
    this.decorativeLayer.render(ctx, {
      state,
      width: logical.width,
      height: logical.height,
      boardWidth: this.boardWidth,
      boardHeight: this.boardHeight,
      nowMs: startedAt,
    });

    // Competitive target labels remain visible independently from the M5
    // decorative quality layer.
    drawCompetitiveLayer(ctx, {
      state,
      width: logical.width,
      height: logical.height,
      boardWidth: this.boardWidth,
      boardHeight: this.boardHeight,
      pointer,
      rules,
    });

    // Keep the diagnostic geometry on the DOM element itself. The browser's
    // 2D context exposes the canvas in Chromium, but that is not part of the
    // rendering contract and can differ across adapters.
    if (pointer && this.canvas.dataset) {
      const fingerPoint = this.boardPoint(
        pointer.fingerX ?? pointer.x,
        pointer.fingerY ?? pointer.y,
      );
      const reticle = this.boardPoint(
        pointer.aimX ?? pointer.x,
        pointer.aimY ?? pointer.y,
      );
      this.canvas.dataset.reticleX = String(Math.round(reticle.x));
      this.canvas.dataset.reticleY = String(Math.round(reticle.y));
      this.canvas.dataset.pointerX = String(Math.round(fingerPoint.x));
      this.canvas.dataset.pointerY = String(Math.round(fingerPoint.y));
    }

    if (phase === "finalizing") {
      ctx.save();
      ctx.fillStyle = "rgba(3, 7, 19, 0.22)";
      ctx.fillRect(0, 0, logical.width, logical.height);
      ctx.restore();
    }
    this.canvas.dataset.renderQuality = this.qualityController.level;
    this.canvas.dataset.renderResolutionScale = String(this.qualityController.profile.resolutionScale);
    this.canvas.dataset.renderParticleBudget = String(this.qualityController.profile.particleCapacity);
    this.canvas.dataset.presentationVariant = this.qualityController.variant;
    this.canvas.dataset.reducedMotion = this.qualityController.reducedMotion ? "true" : "false";
    this.canvas.dataset.orientation = this.orientation;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.decorativeLayer.reset();
  }
}

export default CanvasRenderer;
