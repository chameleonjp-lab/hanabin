import {
  COLORS,
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
} from "../config/rules.js";

export const DISPLAY_COLORS = Object.freeze({
  red: "#ff718f",
  blue: "#6ea8ff",
  green: "#72e5ba",
  yellow: "#ffd166",
});

export const DISPLAY_SYMBOLS = Object.freeze(["●", "◆", "▲", "■"]);
export const DISPLAY_SHAPES = Object.freeze(["circle", "diamond", "triangle", "square"]);

export const colorName = (color) => {
  if (typeof color === "string" && COLORS.includes(color)) return color;
  return COLORS[color] ?? "unknown";
};
export const colorValue = (color) => DISPLAY_COLORS[colorName(color)] ?? "#d9e2ff";
export const colorSymbol = (color) => {
  const index = typeof color === "string" ? COLORS.indexOf(color) : color;
  return DISPLAY_SYMBOLS[index] ?? "✦";
};
export const colorShape = (color) => {
  const index = typeof color === "string" ? COLORS.indexOf(color) : color;
  return DISPLAY_SHAPES[index] ?? "circle";
};

export const isForecastBridgeForNextWave = (entity, state) => {
  const nextWaveIndex = state?.upcomingWaves?.[0]?.waveIndex;
  return Number.isInteger(nextWaveIndex) &&
    Number.isInteger(entity?.forecastForWaveIndex) &&
    entity.forecastForWaveIndex === nextWaveIndex;
};

export const displayEntityRadius = (scale, rules = DEFAULT_RULES) =>
  Math.max(10, rules.entityRadius * Math.max(0, Number(scale) || 0) * 1.2);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Return an on-board reticle position with direction changing at the edges. */
export const getEdgeAwareReticlePosition = (
  x,
  y,
  width,
  height,
  { edgeThreshold = 0.2, offset = null, margin = 13 } = {},
) => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const pointerX = clamp(Number(x) || 0, 0, safeWidth);
  const pointerY = clamp(Number(y) || 0, 0, safeHeight);
  const normalizedX = pointerX / safeWidth;
  const normalizedY = pointerY / safeHeight;
  const safeOffset = Math.max(
    1,
    offset === null ? Math.min(safeWidth, safeHeight) * 0.1 : Number(offset) || 1,
  );
  let offsetX = 0;
  let offsetY = -safeOffset;
  // Aim above the finger by default. At the top edge, use the board's
  // interior side instead; at the bottom edge, keep the upward direction.
  if (pointerY - safeOffset < margin || normalizedY < edgeThreshold / 2) {
    offsetY = 0;
    offsetX = normalizedX <= 0.5 ? safeOffset : -safeOffset;
  }
  if (normalizedY > 1 - edgeThreshold / 2) offsetY = -safeOffset;
  return {
    pointerX,
    pointerY,
    x: clamp(pointerX + offsetX, margin, safeWidth - margin),
    y: clamp(pointerY + offsetY, margin, safeHeight - margin),
    offsetX,
    offsetY,
  };
};

export const boardToCanvas = (x, y, width, height, boardWidth, boardHeight) => ({
  x: (Number(x) || 0) * width / boardWidth,
  y: (Number(y) || 0) * height / boardHeight,
});

const drawLine = (ctx, from, to, style, width = 1) => {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
};

/** Draw the color-independent outline used to identify an active target. */
export const drawDisplayShape = (ctx, {
  shape = "circle",
  x = 0,
  y = 0,
  radius = 0,
} = {}) => {
  if (!ctx) return;
  const safeRadius = Math.max(0, Number(radius) || 0);
  ctx.beginPath();
  if (shape === "diamond") {
    ctx.moveTo(x, y - safeRadius);
    ctx.lineTo(x + safeRadius, y);
    ctx.lineTo(x, y + safeRadius);
    ctx.lineTo(x - safeRadius, y);
  } else if (shape === "triangle") {
    const top = y - safeRadius;
    const bottom = y + safeRadius * 0.82;
    ctx.moveTo(x, top);
    ctx.lineTo(x + safeRadius * 0.92, bottom);
    ctx.lineTo(x - safeRadius * 0.92, bottom);
  } else if (shape === "square") {
    ctx.moveTo(x - safeRadius, y - safeRadius);
    ctx.lineTo(x + safeRadius, y - safeRadius);
    ctx.lineTo(x + safeRadius, y + safeRadius);
    ctx.lineTo(x - safeRadius, y + safeRadius);
  } else {
    ctx.arc(x, y, safeRadius, 0, Math.PI * 2);
  }
  ctx.closePath();
};

const drawPetalHalo = (ctx, x, y, radius, color, active) => {
  ctx.save();
  ctx.globalAlpha = active ? 0.82 : 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, radius * 0.07);
  for (let index = 0; index < 8; index += 1) {
    const angle = Math.PI * 2 * index / 8;
    const inner = radius * 0.74;
    const outer = radius * 1.1;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
};

export const drawCompetitiveLayer = (ctx, {
  state,
  width,
  height,
  boardWidth = 16_000,
  boardHeight = 9_000,
  pointer = null,
  rules = DEFAULT_RULES,
  alpha = 1,
} = {}) => {
  if (!ctx || !state) return;
  const toCanvas = (x, y) => boardToCanvas(x, y, width, height, boardWidth, boardHeight);
  const selectedIds = new Set((state.selectedIds ?? []).map(String));
  const selectedRecords = [...(state.selectionRecords ?? [])];
  const recordsById = new Map(selectedRecords.map((record) => [String(record.id), record]));
  const entitiesById = new Map((state.fireworks ?? []).map((entity) => [String(entity.id), entity]));
  const selectedPath = [...(state.selectedIds ?? [])].map((id) => {
    const entity = entitiesById.get(String(id));
    if (entity && entity.status === "active") return entity;
    return recordsById.get(String(id));
  }).filter(Boolean);
  const scale = Math.min(width / boardWidth, height / boardHeight);
  const entityRadius = displayEntityRadius(scale, rules);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Selection lines are the primary competitive affordance; they are drawn
  // independently from decorative particles and retain exact entity order.
  if (selectedPath.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(121, 230, 255, 0.8)";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "rgba(121, 230, 255, 0.86)";
    ctx.lineWidth = Math.max(1.5, width / 800);
    ctx.beginPath();
    selectedPath.forEach((record, index) => {
      const point = toCanvas(record.x, record.y);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // These restrained geometry overlays expose the exact competitive values
  // used by the core: the next candidate must remain inside the link radius,
  // while the current selection count determines the direct blast radius.
  if (selectedPath.length) {
    const linkOrigin = toCanvas(
      selectedPath.at(-1).x,
      selectedPath.at(-1).y,
    );
    const selectionLinkRadius = rules.selectionLinkDistance * scale;
    const directRadius = directExplosionRadiusForSelection(selectedIds.size, rules) * scale;
    ctx.save();
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = Math.max(1, width / 1600);
    ctx.strokeStyle = "rgba(121, 230, 255, 0.28)";
    ctx.beginPath();
    ctx.arc(linkOrigin.x, linkOrigin.y, selectionLinkRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 209, 102, 0.22)";
    for (const record of selectedPath) {
      const point = toCanvas(record.x, record.y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, directRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (ctx.canvas?.dataset) {
      ctx.canvas.dataset.selectionLinkDistance = String(rules.selectionLinkDistance);
      ctx.canvas.dataset.directExplosionRadius = String(
        directExplosionRadiusForSelection(selectedIds.size, rules),
      );
      ctx.canvas.dataset.selectionCount = String(selectedIds.size);
    }
  } else if (ctx.canvas?.dataset) {
    ctx.canvas.dataset.selectionLinkDistance = "";
    ctx.canvas.dataset.directExplosionRadius = "";
    ctx.canvas.dataset.selectionCount = "0";
  }

  const candidates = [...(state.fireworks ?? [])]
    .filter((entity) => entity.status === "active" && entity.visible !== false)
    .sort((left, right) => Number(left.depth ?? 0) - Number(right.depth ?? 0));
  const forecastBridgeCount = candidates
    .filter((entity) => isForecastBridgeForNextWave(entity, state)).length;
  if (ctx.canvas?.dataset) {
    ctx.canvas.dataset.forecastBridgeCount = String(forecastBridgeCount);
    ctx.canvas.dataset.forecastWaveIndex = Number.isInteger(state.upcomingWaves?.[0]?.waveIndex)
      ? String(state.upcomingWaves[0].waveIndex)
      : "";
    ctx.canvas.dataset.displayEntityRadius = String(entityRadius);
  }
  for (const entity of candidates) {
    const point = toCanvas(entity.x, entity.y);
    const color = colorValue(entity.color);
    const selected = selectedIds.has(String(entity.id));
    const hovered = String(state.hoverCandidateId) === String(entity.id);
    const forecastBridge = isForecastBridgeForNextWave(entity, state);
    const activeTarget = selected || hovered;
    const shape = colorShape(entity.color);
    const depthScale = 0.82 + Math.min(0.32, Math.max(0, Number(entity.depth ?? 0)) / 4000);
    const radius = entityRadius * depthScale;
    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.88;
    ctx.shadowColor = color;
    ctx.shadowBlur = activeTarget ? radius * 2.8 : radius * 1.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.3, radius * 0.12);
    drawDisplayShape(ctx, {
      shape,
      x: point.x,
      y: point.y,
      radius: radius * 0.98,
    });
    ctx.stroke();
    drawPetalHalo(ctx, point.x, point.y, radius, color, activeTarget);
    if (activeTarget) {
      ctx.fillStyle = "rgba(4, 9, 23, 0.86)";
      ctx.font = `${Math.max(8, radius * 1.05)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(colorSymbol(entity.color), point.x, point.y + 0.5);
    }
    // The forecast bonus requires at least three of the five selected
    // targets to be linked to the next wave.  Keep that competitive fact
    // visible at every quality level with a gold double ring.
    if (forecastBridge) {
      ctx.strokeStyle = "rgba(255, 209, 102, 0.96)";
      ctx.lineWidth = Math.max(1.2, radius * 0.11);
      for (const multiplier of [1.48, 1.78]) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * multiplier, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (selected) {
      ctx.strokeStyle = "#f8fcff";
      ctx.lineWidth = Math.max(1.3, radius * 0.14);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 1.55, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hovered) {
      const progress = clamp(
        Math.max(0, Number(state.hoverTicks) || 0) / Math.max(1, Number(rules.minHoldTicks) || 1),
        0,
        1,
      );
      ctx.lineWidth = Math.max(1.3, radius * 0.14);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 1.46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        radius * 1.46,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * progress,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Explosion rings are deterministic state output, not particle effects.
  for (const explosion of state.activeExplosions ?? []) {
    const point = toCanvas(explosion.originX ?? explosion.x, explosion.originY ?? explosion.y);
    const radius = Math.max(2, (Number(explosion.radius) || 0) * scale);
    const remaining = Math.max(0, (Number(explosion.endTick) || state.tick) - state.tick);
    const duration = Math.max(1, Number(explosion.durationTicks) || 1);
    const ringAlpha = Math.min(0.86, 0.2 + remaining / duration * 0.66);
    const color = colorValue(explosion.sourceColor ?? explosion.targetColor);
    ctx.save();
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = Math.max(1.6, width / 620);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (pointer && (pointer.pressed || pointer.pointerId !== null || pointer.showReticle)) {
    const fingerPoint = toCanvas(pointer.fingerX ?? pointer.x, pointer.fingerY ?? pointer.y);
    const aimPoint = toCanvas(
      pointer.aimX ?? pointer.x ?? pointer.fingerX,
      pointer.aimY ?? pointer.y ?? pointer.fingerY,
    );
    // PointerController has already applied the input-mode-specific aim:
    // touch stays under the finger while mouse keeps its edge-aware offset.
    // Drawing that exact point keeps the visible reticle and fixed-tick hit
    // test identical without putting presentation fields in the replay.
    drawLine(ctx, fingerPoint, aimPoint, "rgba(222, 243, 255, 0.7)", Math.max(1, width / 1300));
    ctx.save();
    ctx.strokeStyle = pointer.pressed ? "#f8fcff" : "rgba(121, 230, 255, 0.76)";
    ctx.shadowColor = "rgba(121, 230, 255, 0.8)";
    ctx.shadowBlur = 10;
    ctx.lineWidth = Math.max(1.4, width / 720);
    ctx.beginPath();
    ctx.arc(aimPoint.x, aimPoint.y, Math.max(10, width / 75), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(aimPoint.x - 5, aimPoint.y);
    ctx.lineTo(aimPoint.x + 5, aimPoint.y);
    ctx.moveTo(aimPoint.x, aimPoint.y - 5);
    ctx.lineTo(aimPoint.x, aimPoint.y + 5);
    ctx.stroke();
    ctx.restore();
    if (ctx.canvas?.dataset) {
      ctx.canvas.dataset.reticleX = String(Math.round(aimPoint.x));
      ctx.canvas.dataset.reticleY = String(Math.round(aimPoint.y));
      ctx.canvas.dataset.pointerX = String(Math.round(fingerPoint.x));
      ctx.canvas.dataset.pointerY = String(Math.round(fingerPoint.y));
    }
  }
  ctx.restore();
};

export default drawCompetitiveLayer;
