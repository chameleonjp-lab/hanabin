import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const gameStyles = readFileSync(new URL("../../styles/game.css", import.meta.url), "utf8");
const playableE2E = readFileSync(new URL("../e2e/m3-playable.spec.mjs", import.meta.url), "utf8");
const productShellE2E = readFileSync(new URL("../e2e/m6-product-shell.spec.mjs", import.meta.url), "utf8");

test("portrait play frame derives its height from one shared aspect-ratio budget", () => {
  const portraitStart = gameStyles.indexOf("@media (orientation: portrait)");
  const landscapeStart = gameStyles.indexOf("@media (orientation: landscape)", portraitStart);
  assert.ok(portraitStart >= 0);
  const portraitStyles = gameStyles.slice(portraitStart, landscapeStart);

  assert.match(portraitStyles, /--portrait-board-height:\s*min\(/);
  assert.match(
    portraitStyles,
    /width:\s*min\(100%, calc\(var\(--portrait-board-height\) \* 9 \/ 16\)\)/,
  );
  assert.match(portraitStyles, /height:\s*auto/);
  assert.doesNotMatch(
    portraitStyles,
    /height:\s*min\(calc\(100dvh - var\(--safe-top\)/,
  );
});

test("HUD layout reserves the pause button's 44px target column", () => {
  const frameStyles = gameStyles.slice(gameStyles.indexOf(".game-frame {"));
  assert.match(frameStyles, /--pause-control-width:\s*clamp\(96px, 10vw, 120px\)/);
  assert.match(
    frameStyles,
    /\.game-hud\s*\{[\s\S]*right:\s*calc\(clamp\(8px, 1\.6vw, 18px\) \+ var\(--pause-control-width\) \+ 8px\)/,
  );
  assert.match(frameStyles, /\.pause-button\s*\{[\s\S]*width:\s*var\(--pause-control-width\)/);
  assert.match(frameStyles, /\.pause-button\s*\{[\s\S]*min-height:\s*44px/);
});

test("browser gesture fixtures use direct target coordinates without inverse offset", () => {
  for (const source of [playableE2E, productShellE2E]) {
    assert.doesNotMatch(source, /mouseAimOffset/);
    assert.doesNotMatch(source, /Math\.min\([^\n]*\)\s*\*\s*0\.1/);
  }
  assert.match(playableE2E, /const y = box\.top \+ target\.y \/ BOARD_HEIGHT \* box\.height;/);
  assert.match(productShellE2E, /y: box\.y \+ y \* box\.height/);
});
