import { renderRulesGuide } from './ui/rules-guide.js';
import { t, initLanguageSettings } from './i18n/index.js';
import { GameController } from "./game/controller.js";
import { createOrientationGuide } from "./ui/orientation-guide.js";

const app = document.querySelector("#app");
const status = document.querySelector("#app-status");
const orientationGuide = document.querySelector("#orientation-guide");
const errorPanel = document.querySelector("#app-error");
const canvas = document.querySelector("#game-canvas");

if (!app || !status || !orientationGuide || !errorPanel || !canvas) {
  throw new Error("HANABIN gameplay markup is incomplete");
}

try {
  const controller = new GameController({
    root: app,
    canvas,
  });
  initLanguageSettings(document, () => {
    controller.updateQualityLabel();
    controller.updateHomeBest();
    controller.render();
    renderRulesGuide(app);
    if (controller.phase === "home") status.textContent = t("準備できました");
  });
  renderRulesGuide(app);
  createOrientationGuide(orientationGuide, ({ portrait, previousPortrait }) => {
    orientationGuide.dataset.orientation = portrait ? "portrait" : "landscape";
    controller.handleOrientation({ portrait, previousPortrait });
  });

  // Preserve M1's clean-load contract on the home screen. Gameplay phases
  // replace this status with their own short status text.
  status.textContent = t("準備できました");
  app.dataset.state = "home";
  app.dataset.screen = "home";
  errorPanel.hidden = true;
  document.documentElement.dataset.hanabinReady = "true";

  // Explicit, read-only test hooks make fixed-tick browser checks reliable
  // without exposing target IDs or a state mutation API. Keep them behind an
  // opt-in query flag so normal production pages expose only AppReady.
  const isLocalTestHost = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);
  const isE2E = isLocalTestHost &&
    new URLSearchParams(window.location.search).get("e2e") === "1";
  if (isE2E) window.__hanabinTest = controller.testApi();
  window.__hanabinAppReady = true;
} catch (error) {
  window.__hanabinShowError?.(t("ゲームの初期化に失敗しました。"));
  throw error;
}
