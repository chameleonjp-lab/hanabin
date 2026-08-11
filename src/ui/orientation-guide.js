import { setOrientationGuide } from "./screens.js";

export const isPortraitViewport = () => typeof window !== "undefined" &&
  typeof window.matchMedia === "function" && window.matchMedia("(orientation: portrait)").matches;

export const createOrientationGuide = (element, onRotate = null) => {
  if (!element) return () => {};
  const update = () => {
    const portrait = isPortraitViewport();
    setOrientationGuide(element, { isPortrait: portrait });
    if (typeof onRotate === "function") onRotate({ portrait });
  };
  update();
  window.addEventListener("resize", update, { passive: true });
  window.addEventListener("orientationchange", update, { passive: true });
  return () => {
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
  };
};

export default createOrientationGuide;
