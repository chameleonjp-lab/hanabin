# Q5: 合格した変更だけを公開する

基準コミット `5dca48f` のG03（公開条件）を、Q1以降の自然入力検査と並行して実装した。対象は公開工程、release contract、Pages公開用E2E、artifact検査に限定している。

## 公開経路

`.github/workflows/pages.yml` は `main` のpushまたは手動起動で実行する。Pages workflowは同じworkflow内で、ローカルreusable workflowとして `ci-core.yml` と `ci-browser.yml` をそれぞれ呼ぶ。各workflowは呼び出し元の `github.sha` をcheckoutし、checkout後のHEADも同じSHAであることを検査する。Core（Node 22/24とsimulationを含む）とBrowser（Chromium/WebKit Touch）が両方成功した場合だけ、build jobが実行される。

buildは検査が成功したSHAを明示的にcheckoutし、公開対象を次へ限定する。

- `index.html`
- `styles/**`
- `src/**`
- `release.json`（公開物のSHAと内容digestを照合するための最小manifest）
- `.nojekyll`

`scripts/check-public-artifact.mjs` が、トップレベルの許可リスト、manifestのファイル一覧、commit SHA、SHA-256 digestを検査してからartifactをuploadする。deploy jobはbuildの成功結果と `github-pages` artifact名を明示的に要求する。workflowのconcurrencyは新しいmain pushを優先し、古い実行をキャンセルするため、古い成功artifactを新しいheadへ流用しない。

Pages完了後に起動する `public-release.yml` は、成功したPages workflowの `head_sha` を期待SHAとしてcheckoutする。公開URLの `release.json` とmanifestに列挙された全ファイルを取得し、commit SHAおよびdigestを再計算する。Pagesが失敗・中止した場合、public jobの条件を満たさず、公開確認へ進まない。

## 公開Smoke

既存の端末遷移検査に加え、`tests/e2e/m7-public-release.spec.mjs` へ自然なマウス中心操作を追加した。製品の `e2e` test APIや状態変更APIは使わず、公開URLの通常UIから名前入力→練習skip→本番開始を行う。

seed `1` の最初のwaveにある同色3対象を、公開されている固定盤面情報からテストプロセスで再現する。Canvasのbounding boxから各対象の中心へ座標を変換し、マウスの補正量を加えずに押下・保持・移動・離上する。HUDの選択数が1、2、3へ進み、離上後にscoreが0より大きくなることを検査する。対象は最初のwaveの固定位置で、最小寿命と3秒countdownの範囲内に残る。Q1でmouse offsetが修正された後にこの検査が成功する。

## 検査コマンド

```sh
npm run test:syntax
npm run test:release
npm test
node scripts/check-public-artifact.mjs --root site --write-manifest --expected-sha <40-char-sha>
node scripts/check-public-artifact.mjs --root site --expected-sha <40-char-sha>
npm run test:public
```

ローカルのpublic URL検査は、Pagesへ実際に配備されたURLと期待SHAを指定して実行する。

```sh
EXPECTED_RELEASE_SHA=<pages-head-sha> \
PUBLIC_BASE_URL=https://chameleonjp-lab.github.io/hanabin/ \
node scripts/check-public-artifact.mjs
```

ローカル環境ではGitHub ActionsのCore/Browser reusable workflowやPages設定APIの権限までは再現しないため、Actions上の同一SHA gateと公開workflowを最終根拠とする。Q1の入力座標修正、GitHub Pagesの設定変更、外部push・PR・mergeはこの実装に含めない。
