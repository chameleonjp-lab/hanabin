import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEFAULT_RULES,
} from "../config/rules.js";
import {
  boardToCanvas,
  drawCompetitiveLayer,
  getEdgeAwareReticlePosition,
} from "./competitive-layer.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Canvas adapter. It never changes a game state and never feeds dimensions
 * back into the deterministic core. */
export class CanvasRenderer {
  constructor(canvas, {
    boardWidth = BOARD_WIDTH,
    boardHeight = BOARD_HEIGHT,
    maxDevicePixelRatio = 2,
  } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("CanvasRenderer requires a 2D canvas");
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!this.ctx) throw new Error("Canvas 2D context is unavailable");
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
    this.maxDevicePixelRatio = maxDevicePixelRatio;
    this.width = 1600;
    this.height = 900;
    this.devicePixelRatio = 1;
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
    const devicePixelRatio = typeof window === "undefined"
      ? 1
      : clamp(Number(window.devicePixelRatio) || 1, 1, this.maxDevicePixelRatio);
    this.width = width;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    this.canvas.dataset.cssWidth = String(width);
    this.canvas.dataset.cssHeight = String(height);
    this.canvas.dataset.devicePixelRatio = String(devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return { width, height, devicePixelRatio };
  }

  boardPoint(x, y) {
    return boardToCanvas(x, y, this.width, this.height, this.boardWidth, this.boardHeight);
  }

  drawBackground(state) {
    const { ctx, width, height } = this;
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
    if (!state) {
      this.drawBackground(null);
      return;
    }
    const { ctx, width, height } = this;
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    this.drawBackground(state);

    // Low-cost deterministic target labels remain visible even if all
    // decorative quality work is removed in a later M5 pass.
    drawCompetitiveLayer(ctx, {
      state,
      width,
      height,
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
      const reticleOffset = Math.min(width, height) * 0.1;
      const reticle = getEdgeAwareReticlePosition(
        fingerPoint.x,
        fingerPoint.y,
        width,
        height,
        { offset: reticleOffset, margin: Math.max(1, reticleOffset * 0.45) },
      );
      this.canvas.dataset.reticleX = String(Math.round(reticle.x));
      this.canvas.dataset.reticleY = String(Math.round(reticle.y));
      this.canvas.dataset.pointerX = String(Math.round(fingerPoint.x));
      this.canvas.dataset.pointerY = String(Math.round(fingerPoint.y));
    }

    if (phase === "finalizing") {
      ctx.save();
      ctx.fillStyle = "rgba(3, 7, 19, 0.22)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}

export default CanvasRenderer;
