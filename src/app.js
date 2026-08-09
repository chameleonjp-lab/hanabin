const app = document.querySelector("#app");
const status = document.querySelector("#app-status");
const orientationGuide = document.querySelector("#orientation-guide");
const errorPanel = document.querySelector("#app-error");

if (!app || !status || !orientationGuide || !errorPanel) {
  throw new Error("HANABIN foundation markup is incomplete");
}

const updateOrientationGuide = () => {
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  orientationGuide.hidden = !isPortrait;
};

status.textContent = "静的ページの読み込みが完了しました";
app.dataset.state = "ready";
errorPanel.hidden = true;
document.documentElement.dataset.hanabinReady = "true";
window.__hanabinAppReady = true;

updateOrientationGuide();
window.addEventListener("resize", updateOrientationGuide, { passive: true });
window.addEventListener("orientationchange", updateOrientationGuide, { passive: true });
