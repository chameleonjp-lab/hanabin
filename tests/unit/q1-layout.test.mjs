import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const gameStyles = readFileSync(new URL("../../styles/game.css", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../../styles/base.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const playableE2E = readFileSync(new URL("../e2e/m3-playable.spec.mjs", import.meta.url), "utf8");
const productShellE2E = readFileSync(new URL("../e2e/m6-product-shell.spec.mjs", import.meta.url), "utf8");

test("the document stays fixed while long panels own their own scroll", () => {
  assert.match(baseStyles, /html\s*\{[\s\S]*height:\s*100%[\s\S]*overflow-y:\s*hidden/);
  assert.match(baseStyles, /body\s*\{[\s\S]*height:\s*100%[\s\S]*overflow-y:\s*hidden/);
  assert.match(baseStyles, /\.app-shell\s*\{[\s\S]*height:\s*100%[\s\S]*overflow:\s*hidden/);
  assert.match(gameStyles, /\.screen--home,[\s\S]*\.screen--result\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(gameStyles, /\.screen--practice\s*\{[\s\S]*overflow-y:\s*auto/);
});

test("mobile play and practice layouts reserve visible action space", () => {
  const practiceActionIndex = html.indexOf('<div class="practice-actions">');
  const practiceBoardIndex = html.indexOf('id="practice-board"');
  const resultActionIndex = html.indexOf('<div class="result-actions">');
  const resultBreakdownIndex = html.indexOf('class="result-breakdown"');
  assert.ok(practiceActionIndex >= 0 && practiceBoardIndex >= 0 && practiceActionIndex > practiceBoardIndex);
  assert.match(gameStyles, /grid-template-areas:[\s\S]*"actions"[\s\S]*"kicker"[\s\S]*"title"[\s\S]*"stage"[\s\S]*"message"[\s\S]*"value"[\s\S]*"board"[\s\S]*"steps"/);
  assert.ok(resultActionIndex >= 0 && resultActionIndex < resultBreakdownIndex);
  assert.match(gameStyles, /grid-template-areas:[\s\S]*"score time combo"[\s\S]*"selection selection selection"[\s\S]*"blast blast choices"[\s\S]*"forecast forecast forecast"/);
  assert.match(gameStyles, /#practice-start,[\s\S]*#practice-continue\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
});

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
