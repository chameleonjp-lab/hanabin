# HANABIN MVP公開候補レポート

- 作成日: 2026年8月12日
- 対象リポジトリ: `chameleonjp-lab/hanabin`
- 対象ブランチ: `main`（M7実装マージコミット `942a28441549305f4e1d8c57535f9c87de695db7`、公開確認記録マージコミット `09a29d6d94781fe12a37c930a78e0bff36f3c85a`、PR #14同期マージコミット `a9441c65b6900fd2b18b7a9fc10bd7499062885c`、PR #15同期マージコミット `f01c821da804a29aeec5507ba033d259376b6061`、PR #16同期マージコミット `15a7c808cf230908383bf6357ae36e22267ee180`、PR #17公開URL終端検査マージコミット `cd854f2c08e7f986ee97c7bd43fca0ee82b21dec`、PR #19手動受入チェックリスト同期マージコミット `ce9101673126671001dd8350dc729733e4e2209c`、PR #20記録同期マージコミット `25c0fc7e35292098c2c09a0878760944591e27a4`、PR #21記録同期マージコミット `f52325024cd0bb2601684550b3953f676afab627`、PR #22記録同期マージコミット `5d18a02ca23c793aef6a7b50484bad1cc80de1ce`、PR #23記録同期マージコミット `aea8eeb2425a2f4bcf82e9aafd2401ff1bc55e84`、PR #24記録同期マージコミット `47597d9c0d5141d68dbc89c275e725cd5cb52dfc`、PR #25記録同期マージコミット `2cf71713c4ec5175e73381ab209bdc9a95d5edbc`）
- 状態: M7マージ済み・公開確認中
- MVP判定: **未完了**。実機3端末、初見外部試遊、Pages設定画面の確認が未実施のため、公開候補として記録する。

## 1. 公開版の固定情報

| 項目 | 固定値 |
|---|---|
| MVPリリース版 | `0.1.0` |
| ゲーム版 | `M4` |
| ルール版 | `m4-gameplay-1` |
| 入力記録版 | `m2-input-1` |
| 端末内保存形式 | `v1` |
| 端末内プロフィールキー | `hanabin:profile:v1` |
| 実行時依存 | なし |

これらは`src/config/release.js`から読み出す。ゲーム判定のルール版と公開版を混同しない。ゲームルールを変更した場合は、ルール版と本レポートを同じPull Requestで更新する。

## 2. 自動検査

### 2.1 ローカルで確認した項目

| 検査 | 結果 |
|---|---|
| JavaScript構文 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)のNode 22/24で成功 |
| 公開版固定情報 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)の単体試験で成功 |
| M7公開契約単体検査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)の単体試験で成功 |
| M1〜M6既存単体検査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)のNode 22/24で成功 |
| 10,000シード安全検査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)の全量シミュレーションで成功 |
| 1,000シード×7戦略比較 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)の全量シミュレーションで成功 |
| 厳格な再生監査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)で7/7成功 |
| Chromium全E2E | [CI Browser #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047138)で24/24成功 |

ローカルのフルゲートはNode.js 24.14.0で実行した。安全検査は10,000/10,000シード、36,000,000 tick、生成波200,000件を処理し、fault、不変条件違反、非決定性、選択不能波、完全重複、予告不一致、生成規則違反、乱数分離違反はすべて0件だった。処理時間は安全検査約60.1秒、戦略比較約518.9秒、全体約580.3秒だった。

戦略比較は7,000実行すべてが成功し、平均得点の首位は`forecast`（39,862.35点）だった。`shortest-three`は28,929.642点、`wait-six`は28,277.244点、`full-sweep`は19,365.098点、`idle-first-half`は11,659.062点、`dense-detonation`は27,091.7点、`random`は7,394.408点だった。マージ後のActions証跡は[CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)と[CI Browser #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047138)で確認できる。シミュレーション証跡は[m2-simulation-report Artifact](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136/artifacts/9097408031)へ保存されている。

PlaywrightはGitHub Actions Browser #29で24テストを実行し、24/24成功した。作業環境にはChromium実体がなかったため、ここではGitHub Actionsの実行結果を正式なブラウザ証跡とする。

### 2.2 最終自動条件

- 10,000シードで`simulationFault`、不変条件違反、生成不能、完全重複、予告不一致、乱数分離違反が0件。
- 7戦略すべてでfaultと不変条件違反が0件。
- 同じ入力記録の再生結果が元の最終状態と一致する。
- Canvas品質を変えても、同じ入力の得点と状態が一致する。
- 3,600 tick後に新しい入力を受け付けず、結果画面を二重に登録しない。
- `/hanabin/`の相対パスからホーム、ゲーム、結果まで読み込める。

### 2.3 M7マージ後の自動検証証跡

- Pull Request [#11](https://github.com/chameleonjp-lab/hanabin/pull/11)は、マージコミット `942a28441549305f4e1d8c57535f9c87de695db7`で`main`へ反映済み。
- [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)は、Node 22、Node 24、10,000シード安全検査、1,000シード×7戦略比較、厳格な再生監査がすべて成功。
- [CI Browser #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047138)は、24/24テストが成功。
- [m2-simulation-report Artifact](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136/artifacts/9097408031)を保存済み。

### 2.4 PR #13のマージ後検証

- [PR #13](https://github.com/chameleonjp-lab/hanabin/pull/13)はマージコミット `09a29d6d94781fe12a37c930a78e0bff36f3c85a`で`main`へ反映済みです。
- PR #13の[CI Core #33](https://github.com/chameleonjp-lab/hanabin/actions/runs/31517134941)と[CI Browser #33](https://github.com/chameleonjp-lab/hanabin/actions/runs/31517134931)は成功しました。
- PR #13は計画書・進捗・README・公開候補レポートの文書変更だけで、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 公開URLの確認範囲はホーム→初回練習→スキップ→カウントダウン→本編Canvas/HUDまでです。結果画面、実機3端末、初見5人、Pages設定画面は未確認のままです。

### 2.5 PR #14のマージ後検証

- [PR #14](https://github.com/chameleonjp-lab/hanabin/pull/14)はマージコミット `a9441c65b6900fd2b18b7a9fc10bd7499062885c`で`main`へ反映済みです。
- PR #14の[CI Core #35](https://github.com/chameleonjp-lab/hanabin/actions/runs/31518762135)と[CI Browser #35](https://github.com/chameleonjp-lab/hanabin/actions/runs/31518762120)は成功しました。
- PR #14は文書変更だけで、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 公開URLの静的エントリーへ直接アクセスし、HTTP 200、`HANABIN`のHTML、`src/config/release.js`の公開版固定情報を確認しました。これは公開URL上のクリック操作や結果画面到達を証明するものではありません。

### 2.6 PR #15のマージ後検証

- [PR #15](https://github.com/chameleonjp-lab/hanabin/pull/15)はマージコミット `f01c821da804a29aeec5507ba033d259376b6061`で`main`へ反映済みです。
- PR #15は、PR #14のマージコミット、CI Core #35、CI Browser #35、公開URLの静的エントリーがHTTP 200で配信されることを文書へ同期しました。
- PR #15の[CI Core #37](https://github.com/chameleonjp-lab/hanabin/actions/runs/31520797668)と[CI Browser #37](https://github.com/chameleonjp-lab/hanabin/actions/runs/31520797666)は成功しました。
- PR #15は計画書・進捗・README・公開候補レポートだけの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 結果画面、実機3端末、初見5人、Pages設定画面は未確認のままであり、MVP進捗は6/7を維持します。
### 2.7 公開URL終端検査（PR #17マージ後）

- PR #17はマージコミット `cd854f2c08e7f986ee97c7bd43fca0ee82b21dec`で`main`へ反映済みです。
- [Deploy GitHub Pages #7](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540518416)はPR #17のマージコミットを公開し、成功しました。
- [Public Release Smoke #1](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540556019)も成功しました。実行対象はPR #17のマージコミットで、ジョブは[Published Pages terminal flow](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540556019/job/93941744736)です。
- 公開URLでホーム→初回練習→スキップ→カウントダウン→本編→実時間60秒→結果画面まで到達しました。
- 結果画面は1回だけ登録され、JavaScriptエラー、4xx以上の応答、失敗リクエストは検出されませんでした。
- これは公開URLの自動終端検査の成功記録です。iPhone・iPadの実機確認、初見5人の試遊、Pages設定画面の確認は別条件として未確認のまま残します。

### 2.8 PR #19マージ後の手動受入記録

- Pull Request [#19](https://github.com/chameleonjp-lab/hanabin/pull/19)はマージコミット `ce9101673126671001dd8350dc729733e4e2209c`で`main`へ反映済みです。
- `docs/M7_MANUAL_ACCEPTANCE_CHECKLIST.md`を追加し、計画書・進捗・README・本レポートから参照できるようにしました。
- PR #19の[CI Core #45](https://github.com/chameleonjp-lab/hanabin/actions/runs/31547650607)と[CI Browser #45](https://github.com/chameleonjp-lab/hanabin/actions/runs/31547650595)は成功しました。
- PR #19は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。


### 2.9 PR #20マージ後の記録同期

- Pull Request [#20](https://github.com/chameleonjp-lab/hanabin/pull/20)はマージコミット `25c0fc7e35292098c2c09a0878760944591e27a4`で`main`へ反映済みです。
- PR #20は、計画書・進捗・README・公開候補レポートの4文書だけを変更しました。
- PR #20の[CI Core #47](https://github.com/chameleonjp-lab/hanabin/actions/runs/31549096595)と[CI Browser #47](https://github.com/chameleonjp-lab/hanabin/actions/runs/31549096537)は成功しました。
- ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。

### 2.10 PR #21マージ後の記録同期

- Pull Request [#21](https://github.com/chameleonjp-lab/hanabin/pull/21)はマージコミット `f52325024cd0bb2601684550b3953f676afab627`で`main`へ反映済みです。
- PR #21は、PR #20のマージ後記録を計画書・進捗・README・公開候補レポートの4文書へ同期しました。
- PR #21の[CI Core #49](https://github.com/chameleonjp-lab/hanabin/actions/runs/31551055627)と[CI Browser #49](https://github.com/chameleonjp-lab/hanabin/actions/runs/31551055613)は成功しました。
- PR #21は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。


### 2.11 PR #22マージ後の記録同期

- Pull Request [#22](https://github.com/chameleonjp-lab/hanabin/pull/22)はマージコミット `5d18a02ca23c793aef6a7b50484bad1cc80de1ce`で`main`へ反映済みです。
- PR #22は、PR #21のマージ後記録を計画書・進捗・README・公開候補レポートの4文書へ同期しました。
- PR #22の[CI Core #51](https://github.com/chameleonjp-lab/hanabin/actions/runs/31553411376)と[CI Browser #51](https://github.com/chameleonjp-lab/hanabin/actions/runs/31553411462)は成功しました。
- PR #22は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。


### 2.12 PR #23マージ後の記録同期

- Pull Request [#23](https://github.com/chameleonjp-lab/hanabin/pull/23)はマージコミット `aea8eeb2425a2f4bcf82e9aafd2401ff1bc55e84`で`main`へ反映済みです。
- PR #23は、PR #22のマージ後記録を計画書・進捗・README・公開候補レポートの4文書へ同期しました。
- PR #23の[CI Core #53](https://github.com/chameleonjp-lab/hanabin/actions/runs/31554230532)と[CI Browser #53](https://github.com/chameleonjp-lab/hanabin/actions/runs/31554230533)は成功しました。
- PR #23は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。

### 2.13 PR #24マージ後の記録同期

- Pull Request [#24](https://github.com/chameleonjp-lab/hanabin/pull/24)はマージコミット `47597d9c0d5141d68dbc89c275e725cd5cb52dfc`で`main`へ反映済みです。
- PR #24は、PR #23のマージ後記録を計画書・進捗・README・公開候補レポートの4文書へ同期しました。
- PR #24の[CI Core #55](https://github.com/chameleonjp-lab/hanabin/actions/runs/31560129137)と[CI Browser #55](https://github.com/chameleonjp-lab/hanabin/actions/runs/31560129132)は成功しました。
- PR #24は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。

### 2.14 PR #25マージ後の記録同期

- Pull Request [#25](https://github.com/chameleonjp-lab/hanabin/pull/25)はマージコミット `2cf71713c4ec5175e73381ab209bdc9a95d5edbc`で`main`へ反映済みです。
- PR #25は、PR #24のマージ後記録を計画書・進捗・README・公開候補レポートの4文書へ同期しました。
- PR #25の[CI Core #57](https://github.com/chameleonjp-lab/hanabin/actions/runs/31560963728)と[CI Browser #57](https://github.com/chameleonjp-lab/hanabin/actions/runs/31560963806)は成功しました。
- PR #25は文書のみの変更で、ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していません。
- 実機3端末、初見5人、Pages設定画面は未確認のままなので、MVP 6/7とR1/R2保留を維持します。

## 3. GitHub Pages

`.github/workflows/pages.yml`を追加した。`main`へのpush、または手動実行を対象に、次の3つだけをartifactへ入れる。

- `index.html`
- `styles/`
- `src/`

テスト、文書、GitHub Actionsの設定、パッケージ管理ファイルは公開artifactへ入れない。Pull RequestではPagesをデプロイせず、`main`へマージされた後だけデプロイする。M7のマージでこのworkflowの公開対象になった。公開URLのホーム→ゲーム→結果は専用Actionsで確認済みだが、Pages設定画面の公開元確認は未実施である。Pagesの設定画面で公開元をGitHub Actionsにする操作は、リポジトリ管理者が確認する。

### 3.1 公開URLの到達確認（2026年8月12日）

確認URL: [HANABIN公開ページ](https://chameleonjp-lab.github.io/hanabin/)

画面遷移の確認は公開確認用のCloud Browserで行い、今回の静的配信確認はHTTP取得で行った。いずれもiPhone・iPadの実機確認ではない。

| 確認項目 | 結果 |
|---|---|
| URLへ直接アクセスしてホームを表示 | 確認 |
| 公開URLの静的エントリーがHTTP 200を返す | 確認 |
| `src/config/release.js`の公開版固定情報を読み込める | 確認 |
| 「ゲームを開始」から初回練習を表示 | 確認 |
| 練習をスキップしてカウントダウンへ進む | 確認 |
| 本編Canvas、残り時間、得点、連鎖、次の2波予告を表示 | 確認 |
| 公開URL上で本編から結果画面まで到達 | 確認（公開URL専用Actions #1） |
| 公開URL専用の自動検査で本編から結果画面まで到達 | 確認（Public Release Smoke #1） |
| iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018 | 未確認 |
| 初見5人の試遊 | 未確認 |

この確認だけではM7完了・MVP完成とは判定しない。実機3端末、初見5人、Pages設定画面の確認を続ける。

## 4. 実機検査

記録手順と未確認欄は、[M7手動受入チェックリスト](./M7_MANUAL_ACCEPTANCE_CHECKLIST.md)を正本として使う。

この工程では、作業環境のブラウザ検査だけで実機結果を断定しない。次の項目を実機で確認する。

| 端末 | 必須確認 | 状態 |
|---|---|---|
| iPhone 17 Pro | 10回連続、大連鎖、通知・アプリ切替復帰、回転、高品質、自動品質、共有 | 未実施 |
| iPhone 11 Pro | 中・低品質、入力遅延、大連鎖停止、10回連続 | 未実施 |
| iPad Pro 2018 | 中央配置、安全領域、花火密度、指移動距離 | 未実施 |

## 5. 初見試遊

最低5人で、次を記録する。人数や結果を推測で埋めず、実際に確認した値だけを書く。

- 最初の成功までの中央値が12秒以内。
- 30秒時点で80%以上が「同色を3つ以上つないで離す」と説明できる。
- 2個以下で解除した操作が25%以下。
- 横画面案内から開始できない人が20%未満。
- 3回目までに得点または巻き込み率の中央値が15%以上改善する。
- 半数以上が次の波の予告を意図的に使う。

状態: 未実施。したがって、現在は`MVP完成`と記録しない。

## 6. 公開前の利用者向け説明

- 同じ色の花火を3つ以上、線でつなぎ、指を離して起爆する。
- 60秒の得点を競う。次の波の予告を見ると、連鎖を準備できる。
- 音は初期状態で無効。必要な人だけ設定から有効にできる。
- 最高得点と最大連鎖は端末内だけに保存する。アカウント登録とオンラインランキングはまだ行わない。
- 対応確認は横画面を基本とし、縦画面では開始前に案内を表示する。

## 7. 完了判定

自動検査、全E2E、実機3端末、初見試遊、Pages設定画面の確認がそろうまで、M7は完了にしない。完了後にこのレポートへ根拠を追記し、`IMPLEMENTATION_STATUS.md`を7/7へ更新する。
