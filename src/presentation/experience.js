export const PRESENTATION_VARIANTS = Object.freeze(["touch", "desktop"]);

export const PRESENTATION_MEDIA_QUERIES = Object.freeze({
  desktop: "(hover: hover) and (pointer: fine)",
  coarsePointer: "(pointer: coarse)",
  anyCoarsePointer: "(any-pointer: coarse)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
});

const safeMatch = (matchMedia, query) => {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia(query)?.matches === true;
  } catch {
    return false;
  }
};

const defaultMatchMedia = (query) => {
  if (typeof globalThis.matchMedia !== "function") return null;
  return globalThis.matchMedia(query);
};

export const normalizePresentationVariant = (value, fallback = "touch") =>
  PRESENTATION_VARIANTS.includes(value)
    ? value
    : (PRESENTATION_VARIANTS.includes(fallback) ? fallback : "touch");

/**
 * Detect presentation capabilities without user-agent sniffing. A rich
 * desktop presentation is enabled only when the primary pointer is both fine
 * and hover-capable; every ambiguous device gets the touch-safe variant.
 */
export const detectPresentationExperience = ({
  matchMedia = defaultMatchMedia,
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0,
  variant = null,
  reducedMotion = null,
} = {}) => {
  const desktopCapable = safeMatch(matchMedia, PRESENTATION_MEDIA_QUERIES.desktop);
  const coarsePointer = safeMatch(matchMedia, PRESENTATION_MEDIA_QUERIES.coarsePointer) ||
    safeMatch(matchMedia, PRESENTATION_MEDIA_QUERIES.anyCoarsePointer) ||
    Number(maxTouchPoints) > 0;
  const resolvedVariant = PRESENTATION_VARIANTS.includes(variant)
    ? variant
    : (desktopCapable ? "desktop" : "touch");
  const resolvedReducedMotion = typeof reducedMotion === "boolean"
    ? reducedMotion
    : safeMatch(matchMedia, PRESENTATION_MEDIA_QUERIES.reducedMotion);

  return Object.freeze({
    variant: resolvedVariant,
    reducedMotion: resolvedReducedMotion,
    desktopCapable,
    coarsePointer,
    maxTouchPoints: Math.max(0, Math.trunc(Number(maxTouchPoints) || 0)),
  });
};

export default detectPresentationExperience;
