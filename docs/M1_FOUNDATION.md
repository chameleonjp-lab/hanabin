# M1 静的基盤と自動試験

この文書は、M1のDraft Pull Requestに添える実装記録です。M1では、ブラウザがリポジトリ内のファイルを直接読み込める基盤と、自動試験の入口だけを用意します。

## M1で用意するもの

- `index.html`: ビルドなしで開ける静的ページ。読み込み中、読み込み失敗、縦画面案内を表示します。
- `styles/base.css`: iPhoneの安全域、横スクロール防止、667×375の横画面、375×667の縦画面を考慮した基礎スタイルです。
- `src/app.js`: 標準JavaScriptモジュールの読み込み確認と、画面向き案内だけを行います。
- `scripts/serve.mjs`: Node.js標準機能だけで動く静的サーバーです。
- `scripts/check-syntax.mjs`: `src`、`scripts`、`tests`のJavaScript構文を確認します。
- `tests/unit/`: HTML、入口ファイル、依存境界を確認するNode.js標準テストです。
- `tests/e2e/`: Playwrightで読み込み、画面サイズ、横スクロール、読み込み失敗表示を確認します。
- `.github/workflows/ci-core.yml`: 構文確認と単体テストです。
- `.github/workflows/ci-browser.yml`: Chromiumによるブラウザ試験です。

## 依存関係

公開ページの実行時依存はありません。Playwrightだけを開発用依存として固定しています。

| 依存 | 版 | 用途 |
|---|---:|---|
| `@playwright/test` | `1.62.1` | Chromiumでの自動ブラウザ試験 |

この版は2026年8月9日にnpm registryで確認した値です。サポート期間が終了した版を対象に含めないため、Node.jsは22以上とし、CIでは22.xと24.xを確認します。

GitHub Actionsは、供給元のタグだけに依存しないよう、確認済みのコミットへ固定しています。

| Action | 固定値 | 確認したタグ |
|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `v7.0.1` |
| `actions/setup-node` | `a0853c24544627f65ddf259abe73b1d18a591444` | `v5.0.0` |
| `actions/upload-artifact` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | `v7.0.1` |

## M1で実装しないもの

ゲームルール、Canvas描画、花火の出現、連鎖、得点、音、ランキングはM1の対象外です。静的ページの中央領域は、後のゲーム画面を置くための確認用表示にとどめています。

## 確認方法

```text
npm ci
npm run test:syntax
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

Playwrightのブラウザを用意できない環境では、前半3つで構文と単体契約を確認できます。公開時に外部JavaScriptを読み込まないことは、単体テストで検査します。

## 次工程への境界

M1がマージされるまでは、ゲーム判定や得点のファイルを追加しません。M2では、CanvasとDOMから分離した決定的なゲーム判定を追加します。
