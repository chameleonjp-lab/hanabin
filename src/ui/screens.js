const SCREEN_IDS = Object.freeze([
  "home",
  "practice",
  "countdown",
  "play",
  "finalizing",
  "result",
]);

export class ScreenController {
  constructor(root) {
    if (!root) throw new TypeError("ScreenController requires an app root");
    this.root = root;
    this.screens = new Map();
    for (const id of SCREEN_IDS) {
      const element = root.querySelector(`[data-screen="${id}"]`);
      if (!element) throw new Error(`Missing HANABIN screen: ${id}`);
      this.screens.set(id, element);
    }
    this.phase = "home";
    this.transitions = [];
    this.resultEntries = 0;
    this.root.dataset.resultEntries = "0";
    this.apply("home", null);
  }

  apply(phase, previous = this.phase) {
    const next = SCREEN_IDS.includes(phase) ? phase : "home";
    for (const [id, element] of this.screens) {
      element.hidden = id !== next;
      element.dataset.active = id === next ? "true" : "false";
    }
    this.phase = next;
    this.root.dataset.state = next;
    this.root.dataset.screen = next;
    this.root.dataset.phase = next;
    if (next === "result" && previous !== "result") {
      this.resultEntries += 1;
      this.root.dataset.resultEntries = String(this.resultEntries);
    }
    this.transitions.push({ from: previous, to: next, resultEntries: this.resultEntries });
    return next;
  }

  show(phase, previous = this.phase) {
    if (phase === this.phase) return this.phase;
    return this.apply(phase, previous);
  }

  element(id) {
    return this.screens.get(id) ?? null;
  }

  history() {
    return this.transitions.map((transition) => ({ ...transition }));
  }
}

export const setOrientationGuide = (element, {
  isPortrait = typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(orientation: portrait)").matches,
} = {}) => {
  if (!element) return;
  element.hidden = !isPortrait;
  element.dataset.orientation = isPortrait ? "portrait" : "landscape";
};

export default ScreenController;
