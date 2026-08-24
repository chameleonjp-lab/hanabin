import { setOrientationGuide } from "./screens.js";

export const isPortraitViewport = () => typeof window !== "undefined" &&
  typeof window.matchMedia === "function" && window.matchMedia("(orientation: portrait)").matches;

export const createOrientationGuide = (element, onRotate = null) => {
  if (!element) return () => {};
  let previousPortrait = null;
  const update = ({ notifySame = false } = {}) => {
    const portrait = isPortraitViewport();
    setOrientationGuide(element, { isPortrait: portrait });
    // Mobile Safari resizes the visual viewport when its browser chrome is
    // shown or hidden.  That is not an orientation transition and must not
    // pause a landscape game or open the resume gate.
    if ((portrait !== previousPortrait || notifySame) && typeof onRotate === "function") {
      onRotate({ portrait, previousPortrait });
    }
    previousPortrait = portrait;
  };
  update();
  const handleResize = () => update();
  // A device can rotate between landscape-primary and landscape-secondary
  // without changing the portrait media query. PointerController still
  // interrupts that physical transition, so always notify here to resume it.
  const handleOrientationChange = () => update({ notifySame: true });
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("orientationchange", handleOrientationChange, { passive: true });
  return () => {
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("orientationchange", handleOrientationChange);
  };
};

export default createOrientationGuide;
