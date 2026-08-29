# HANABIN 実装進捗

- 更新日: 2026年8月29日
- 実装状態: **7/7**（M1〜M7のコードは`main`へマージ済み）
- MVP受入: **6/7**（M7は不合格のまま）
- 公開URL: [HANABIN](https://chameleonjp-lab.github.io/hanabin/)

> 2026年8月29日追記: 直近の敵対的検証と追加要件を統合した追補を開始した。選択肢保証、一時停止、名前必須、結果画面のホーム／実験場／端末内TOP10、PCマウス操作、縦画面の時計回り論理表示をDraft PR [#36](https://github.com/chameleonjp-lab/hanabin/pull/36)へ実装した。Core全量ゲートの15分制限によるキャンセルを30分へ延長して解消し、CI Core #87とCI Browser #87、全量ゲート、厳格再生fixture生成、artifactアップロードまで成功した。これはまだ`main`へマージしていない作業中の変更であり、実機iPhone 17 Pro、初見5人、公開後確認は未完了である。詳細は[`docs/POST_MVP_HARDENING_PLAN.md`](./docs/POST_MVP_HARDENING_PLAN.md)を正本とする。

> 2026年8月23日のスマホ操作、PC/touch演出、SE、得点表示、予告バランスの後続修正はPull Request [#34](https://github.com/chameleonjp-lab/hanabin/pull/34)で`main`へマージされ、GitHub Pagesへ公開済みである。マージ後のCI Core #78、CI Browser #78、Deploy GitHub Pages #23、Public Release Smoke #18はすべて成功した。iPhone 17 Pro / Safari実機と初見5人の試遊は未確認であり、M7受入は6/7のままとする。

## 現在地

公開URL専用の実時間終端検査は、設定変更後もホームから結果画面まで成功している。2026年8月16日にGitHub Pages APIを確認し、公開元がGitHub Actionsへ切り替わったこと、限定artifact以外のファイルが公開されていないことを確認した。

そのため、既存M7の残件は次の2つである。追加要件の自動検証はDraft PR #36で完了し、現在はDraftレビューと実機確認へ進む段階である。

1. iPhone 17 Proで実機確認する。横画面と、時計回りの論理16:9で対応した縦画面の両方について、タップ位置、長押し中の選択、色選択、練習の再挑戦・本番進行を確認する。
2. 初見5人の試遊結果を記録する。

実機と初見試遊は未確認のまま扱う。R1公式プレイとR2ランキングは、MVP受入完了と利用者の開始指示まで進めない。

## MVP工程

| 工程 | 内容 | 実装 | 受入 | 主なPull Request |
|---|---|---|---|---|
| M1 | 静的基盤と自動試験 | マージ済み | 合格 | [#4](https://github.com/chameleonjp-lab/hanabin/pull/4) |
| M2 | 決定的ゲーム判定とシミュレーター | マージ済み | 合格 | [#5](https://github.com/chameleonjp-lab/hanabin/pull/5) / [#6](https://github.com/chameleonjp-lab/hanabin/pull/6) |
| M3 | Canvasで遊べるブラウザ版 | マージ済み | 合格 | [#7](https://github.com/chameleonjp-lab/hanabin/pull/7) |
| M4 | 抜け道対策とゲーム設計審査 | マージ済み | 合格 | [#8](https://github.com/chameleonjp-lab/hanabin/pull/8) |
| M5 | 花火表現と性能対策 | マージ済み | 合格 | [#9](https://github.com/chameleonjp-lab/hanabin/pull/9) |
| M6 | 練習、保存、結果、共有、音 | マージ済み | 合格 | [#10](https://github.com/chameleonjp-lab/hanabin/pull/10) |
| M7 | 総合検証とMVP公開 | マージ済み | 不合格 | [#11](https://github.com/chameleonjp-lab/hanabin/pull/11) / [#17](https://github.com/chameleonjp-lab/hanabin/pull/17) / [#19](https://github.com/chameleonjp-lab/hanabin/pull/19) / [#34](https://github.com/chameleonjp-lab/hanabin/pull/34) |

## 進捗の数え方

実装と受入を分けて記録する。

- 実装は、対象コードが`main`へマージされた時点で「マージ済み」とする。
- 受入は、工程の完了条件と必要な証跡がそろった時点で「合格」とする。
- MVP進捗は受入合格数を使う。M7実装がマージ済みでも、完了条件が残る間は6/7とする。
- 文書だけを変更したPull Requestの番号やマージSHAは、進捗判定が変わらない限り各文書へ追記しない。GitHubのPull Request履歴を正本とする。

## 実装済みの内容

### M2〜M4: ゲーム判定と遊び

- 4色、整数盤面、60Hz・3,600更新、6種類の波、次の2波予告を実装した。
- 最初の1本指、3更新保持、1更新1取得、選択距離、二段階衝突、連鎖、得点を決定的に計算する。
- 同じ初期値と入力記録から同じ結果を再生し、異常時は`simulationFault`を立てる。
- 10,000シード安全検査、1,000シード×8戦略比較、再生監査を実行できる。
- 予告対象と予告計画ボーナスを追加し、全面なぞり・長時間保持・前半放置を検査する。

### M5〜M6: 表示と製品導線

- 判定表示を守ったまま、高・中・低の装飾品質と固定容量の光粒を実装した。
- 初回練習、名前・最高記録・品質・音の端末内保存、結果ヒント、共有文、中断復帰を実装した。
- 装飾品質を変えても、同じ入力の得点と状態が変わらない試験を追加した。

### M7: 公開候補

- 公開版、ルール版、入力記録版、保存形式版を固定した。
- [CI Core #78](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500837)でNode 22/24、全量シミュレーション、再生監査が成功した。
- [CI Browser #78](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500846)でChromiumとWebKit Touchのブラウザ試験が成功した。
- [Deploy GitHub Pages #23](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500867)で限定artifactの公開に成功した。
- [Public Release Smoke #18](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682529443)で、公開URLの終端経路と公開対象外URLの404検査が成功した。
- 実機・初見試遊の正本は、[M7手動受入チェックリスト](./docs/M7_MANUAL_ACCEPTANCE_CHECKLIST.md)とする。

## GitHub Pagesの判定

2026年8月16日のAPIと公開URL検査で、GitHub Actionsの限定artifact公開を確認した。

| 項目 | 確認値 | 判定 |
|---|---|---|
| 公開状態 | `built` | 確認済み |
| 公開URL | `https://chameleonjp-lab.github.io/hanabin/` | 確認済み |
| HTTPS | 有効 | 確認済み |
| 公開方式 | `workflow` | 合格 |
| 公開元 | `.github/workflows/pages.yml`の限定artifact | 合格 |
| 公開対象外URL | 6種類を404確認 | 合格 |

## MVP後

| 工程 | 内容 | 状態 |
|---|---|---|
| R1 | 公式プレイとサーバー再計算 | 保留 |
| R2 | オンラインランキング画面と運用 | 保留（端末内TOP10は追加対応） |

## 次の作業

1. Draft PR [#36](https://github.com/chameleonjp-lab/hanabin/pull/36)のレビューを行う（Core／Browser CI #85は成功済み）。
2. iPhone 17 Proで横・縦画面、入力境界、停止、結果導線を実機確認する。
3. 初見5人の試遊を記録する。
4. すべて合格した場合だけMVP受入を7/7へ更新する。
