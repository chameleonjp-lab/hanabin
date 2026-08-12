# HANABIN 実装進捗

- 更新日: 2026年8月12日
- MVP進捗: **6/7**（公開URL専用の実時間終端検査は成功。実機3端末、初見試遊、Pages設定画面が未確認）
- 現在地: M1〜M7はPull Request [#4](https://github.com/chameleonjp-lab/hanabin/pull/4)、[#5](https://github.com/chameleonjp-lab/hanabin/pull/5)、[#6](https://github.com/chameleonjp-lab/hanabin/pull/6)、[#7](https://github.com/chameleonjp-lab/hanabin/pull/7)、[#8](https://github.com/chameleonjp-lab/hanabin/pull/8)、[#9](https://github.com/chameleonjp-lab/hanabin/pull/9)、[#10](https://github.com/chameleonjp-lab/hanabin/pull/10)、[#11](https://github.com/chameleonjp-lab/hanabin/pull/11)で実装本体を、[#12](https://github.com/chameleonjp-lab/hanabin/pull/12)、[#13](https://github.com/chameleonjp-lab/hanabin/pull/13)、[#14](https://github.com/chameleonjp-lab/hanabin/pull/14)、[#15](https://github.com/chameleonjp-lab/hanabin/pull/15)、[#16](https://github.com/chameleonjp-lab/hanabin/pull/16)、[#17](https://github.com/chameleonjp-lab/hanabin/pull/17)、[#19](https://github.com/chameleonjp-lab/hanabin/pull/19)、[#20](https://github.com/chameleonjp-lab/hanabin/pull/20)でM7公開確認の記録を`main`へマージ済み。MVPは公開確認中
- 実装コード: M1〜M7が`main`へマージ済み。自動検証と公開URL終端検査は完了しているが、実機・初見試遊・Pages設定画面の確認が残るため工程数は6/7とする

## MVP工程

| 工程 | 内容 | 状態 | Pull Request |
|---|---|---|---|
| M1 | 静的基盤と自動試験 | 完了（`main`へマージ済み） | [#4](https://github.com/chameleonjp-lab/hanabin/pull/4) |
| M2 | 決定的ゲーム判定と簡易シミュレーター | 完了（独立レビュー補修を含め`main`へマージ済み） | [#5](https://github.com/chameleonjp-lab/hanabin/pull/5) / [#6](https://github.com/chameleonjp-lab/hanabin/pull/6) |
| M3 | 円表示で遊べるブラウザ版 | 完了（`main`へマージ済み） | [#7](https://github.com/chameleonjp-lab/hanabin/pull/7) |
| M4 | 抜け道対策とゲーム設計審査 | 完了（`main`へマージ済み） | [#8](https://github.com/chameleonjp-lab/hanabin/pull/8) |
| M5 | 本作独自の花火表現と性能対策 | 完了（`main`へマージ済み） | [#9](https://github.com/chameleonjp-lab/hanabin/pull/9) |
| M6 | 製品画面、初回練習、保存、結果、音 | 完了（`main`へマージ済み） | [#10](https://github.com/chameleonjp-lab/hanabin/pull/10) |
| M7 | 総合検証とMVP公開 | 自動検証・Pages準備・公開URLの実時間終端検査は成功。実機・初見試遊・Pages設定画面待ち | [#11](https://github.com/chameleonjp-lab/hanabin/pull/11) / [#12](https://github.com/chameleonjp-lab/hanabin/pull/12) / [#13](https://github.com/chameleonjp-lab/hanabin/pull/13) / [#14](https://github.com/chameleonjp-lab/hanabin/pull/14) / [#15](https://github.com/chameleonjp-lab/hanabin/pull/15) / [#16](https://github.com/chameleonjp-lab/hanabin/pull/16) / [#17](https://github.com/chameleonjp-lab/hanabin/pull/17) / [#19](https://github.com/chameleonjp-lab/hanabin/pull/19) / [#20](https://github.com/chameleonjp-lab/hanabin/pull/20) |

## MVP後

| 工程 | 内容 | 状態 |
|---|---|---|
| R1 | 公式プレイとサーバー再計算 | 保留 |
| R2 | ランキング画面と運用 | 保留 |

ランキング工程はMVP完成後、利用者が開始を明示した場合だけ進める。

## 進捗の数え方

- Draft Pull Request作成中: 工程数へ加えない。
- 利用者確認済み・マージ前: 工程数へ加えない。
- `main`へマージ済み: 1工程完了として加える。
- M7で実機、初見外部試遊、Pages設定画面の確認が未完了の場合: `6/7・公開試験中`と記録し、MVP完成とは扱わない。

## M2の確認結果

- `src/config`と`src/core`にDOM・Canvas・壁時計・環境乱数へ依存しない決定的判定層を追加。
- 4色、整数盤面、60Hz/3600tick、6波、次の2波予告、最初の指、3tick保持・1tick1取得、選択リンク、二段階衝突、持続中の爆発連鎖、重複防止、仮得点式を実装。
- 独立レビューで見つかった直接半径の早すぎる減衰、指位置への爆発中心ずれ、cooldown中の取得、取消時の誤起爆、2個以下の選択残留、連鎖actionIdの1ずれを補修。
- seed、ルール版、入力スキーマ版、全判定値のルール指紋、3600フレームを含む厳格な入力再生と`simulationFault`を実装。
- 10,000 seed・20万波の安全検査はfault、不変条件違反、再現差分、選択不能波、完全重なり、予告不一致、攻略用乱数混入がすべて0。
- 1,000 seed×7戦略は全戦略fault・不変条件違反0で、保存入力の最終状態も7/7一致。
- `docs/GAMEPLAY_GATE_1.md`へ補修後の全量分布と、6個待ちが首位である未解決のバランス課題を記録。

## M3の確認状況

- M2の純粋な判定層へ、固定tickを維持したブラウザセッション、Pointer Events、Canvas円表示、HUD、画面遷移を接続。
- CSS表示座標を整数盤面へ変換し、Canvasの画素密度や表示サイズを再生入力へ混入させない。
- 最初のPointerだけを所有し、Pointer Capture、取消、capture喪失、非表示、ページ遷移、回転を一回の中断入力として扱う。
- 3600固定フレーム後に入力を拒否し、最終連鎖、結果、厳格な同一入力再生までを接続。
- Node契約試験とブラウザ試験を追加。ローカル環境にはChromium実体がないため、Playwright実行結果はDraft Pull RequestのGitHub Actionsで確認する。

## M4の確認状況

- 各波に次波の主要色を持つ5個の予告対象を追加し、HUDへ次の2波の色・位置・順番・到着までの秒数を表示する。
- 予告対象を5個選んだ起爆には予告計画ボーナスを付け、予告を見て準備する操作を得点へ反映する。
- 直接爆発半径と選択リンク距離を、コア判定と同じルール値からCanvasへ弱く表示する。
- M4のNode試験、10,000 seed安全検査、1,000 seed×7戦略比較、Chromium試験はPull Request #8で成功し、`main`へマージ済み。

## M5の確認状況

- 競技表示層を装飾層の前面に残し、対象、選択線、爆発半径、HUDに必要な情報を品質変更で削除しない構成へ変更する。
- 高・中・低の3品質、固定容量の光粒プール、連鎖世代ごとの輪・残像・大連鎖反応、品質別のCanvas解像度倍率を追加する。
- 装飾品質を変えても、同じシードと固定更新入力の結果が一致するブラウザ試験を追加する。
- 実機の持続フレームレートはこの工程で断定せず、`docs/PERFORMANCE_REPORT.md`へ自動検査結果と未確認項目を分けて記録する。

## M6の確認状況

- Pull Request [#10](https://github.com/chameleonjp-lab/hanabin/pull/10)を`main`へマージ済み。
- 初回12秒練習、スキップ、名前・最高記録・品質・音設定の端末内保存を追加。
- 壊れた保存JSON、保存不可環境、制御文字を安全に処理し、結果画面は文字列表示で固定した。
- 結果ヒント、末尾URL付き共有文、効果音、画面中断後の再開表示を追加した。
- Node 22/24、Browser 23/23、全量シミュレーション、再生監査はPR検査で成功した。

## M7の確認状況

- Pull Request [#11](https://github.com/chameleonjp-lab/hanabin/pull/11)を`main`へマージ済み。マージコミットは`942a28441549305f4e1d8c57535f9c87de695db7`。
- M7公開確認の文書記録は、Pull Request [#13](https://github.com/chameleonjp-lab/hanabin/pull/13)（マージコミット `09a29d6d94781fe12a37c930a78e0bff36f3c85a`）で`main`へ反映済み。
- Pull Request [#14](https://github.com/chameleonjp-lab/hanabin/pull/14)（マージコミット `a9441c65b6900fd2b18b7a9fc10bd7499062885c`）で、PR #13のマージ後記録を`main`へ同期済み。
- Pull Request [#15](https://github.com/chameleonjp-lab/hanabin/pull/15)（マージコミット `f01c821da804a29aeec5507ba033d259376b6061`）で、PR #14のマージ後確認と公開URLのHTTP 200確認を`main`へ同期済み。
- PR #15の[CI Core #37](https://github.com/chameleonjp-lab/hanabin/actions/runs/31520797668)と[CI Browser #37](https://github.com/chameleonjp-lab/hanabin/actions/runs/31520797666)は成功した。
- Pull Request [#16](https://github.com/chameleonjp-lab/hanabin/pull/16)はマージコミット `15a7c808cf230908383bf6357ae36e22267ee180`で`main`へ反映済み。PR #16のCI Core #39とCI Browser #39も成功した。
- Pull Request [#17](https://github.com/chameleonjp-lab/hanabin/pull/17)はマージコミット `cd854f2c08e7f986ee97c7bd43fca0ee82b21dec`で`main`へ反映済み。
- [Deploy GitHub Pages #7](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540518416)はPR #17のマージコミットを公開し、成功した。[Public Release Smoke #1](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540556019)も成功し、公開URLで結果画面までの実時間終端経路を確認した。
- Pull Request [#19](https://github.com/chameleonjp-lab/hanabin/pull/19)はマージコミット `ce9101673126671001dd8350dc729733e4e2209c`で`main`へ反映済み。M7手動受入チェックリストを追加し、実機3端末・初見5人・Pages設定画面の確認を未確認のまま記録できるようにした。
- Pull Request [#20](https://github.com/chameleonjp-lab/hanabin/pull/20)はマージコミット `25c0fc7e35292098c2c09a0878760944591e27a4`で`main`へ反映済み。計画書・進捗・README・公開候補レポートの4文書へPR #20のマージ結果を同期した。
- PR #20の[CI Core #47](https://github.com/chameleonjp-lab/hanabin/actions/runs/31549096595)と[CI Browser #47](https://github.com/chameleonjp-lab/hanabin/actions/runs/31549096537)は成功した。ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していない。
- PR #19の[CI Core #45](https://github.com/chameleonjp-lab/hanabin/actions/runs/31547650607)と[CI Browser #45](https://github.com/chameleonjp-lab/hanabin/actions/runs/31547650595)は成功した。ゲームコード、ゲームルール、得点、保存形式、公開artifactは変更していない。
- 既存のBrowser CIはローカル静的サーバーを対象にする。PR #17で追加した公開URL専用ActionsはPagesデプロイ後に実行され、公開URLの実時間終端検査に成功した。
- 公開版のリリース版、ルール版、入力版、保存形式版を`src/config/release.js`へ固定した。
- [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136)はNode 22、Node 24、全量シミュレーションが成功した。
- [CI Browser #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047138)はChromium E2E 24/24が成功した。
- シミュレーション証跡の`m2-simulation-report`は[Artifact](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136/artifacts/9097408031)へ保存済み。
- PR #13のCI Core [#33](https://github.com/chameleonjp-lab/hanabin/actions/runs/31517134941)とCI Browser [#33](https://github.com/chameleonjp-lab/hanabin/actions/runs/31517134931)も成功し、文書変更後の既存検査を確認済み。
- PR #14のCI Core [#35](https://github.com/chameleonjp-lab/hanabin/actions/runs/31518762135)とCI Browser [#35](https://github.com/chameleonjp-lab/hanabin/actions/runs/31518762120)も成功した。
- GitHub Pagesは`main`へのマージ後だけ、`index.html`、`styles/`、`src/`を公開するworkflowである。
- 2026年8月12日、公開URLでホーム→初回練習→スキップ→カウントダウン→本編Canvas/HUDまで到達した。
- 2026年8月12日、公開URLの静的エントリーへ直接アクセスし、HTTP 200、`HANABIN`のHTML、`src/config/release.js`の公開版固定情報を確認した。
- 2026年8月12日、Public Release Smoke #1で公開URLのホーム→初回練習→スキップ→カウントダウン→本編→実時間60秒→結果画面を確認した。結果画面は1回だけ登録され、JavaScriptエラー、4xx以上の応答、失敗リクエストは検出されなかった。
- 実機3端末、初見5人、Pages設定画面は未確認であり、MVP完成とは扱わない。

## 次の作業

PR #20のマージ後に、計画書・進捗・README・公開候補レポートへの記録同期も完了した。PR #17のマージ後に実行された[Deploy GitHub Pages #7](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540518416)と[Public Release Smoke #1](https://github.com/chameleonjp-lab/hanabin/actions/runs/31540556019)は成功した。公開URL専用Actionsは、公開URLでホーム→初回練習→スキップ→カウントダウン→本編→実時間60秒→結果画面へ到達し、結果画面の二重登録、JavaScriptエラー、4xx以上の読み込み失敗がないことを確認した。

次は、[M7手動受入チェックリスト](./docs/M7_MANUAL_ACCEPTANCE_CHECKLIST.md)に沿って、iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018の実機確認、初見5人の試遊、Pages設定画面の公開元確認を実際の証跡で記録する。チェックリストの未確認欄が残る間はMVP進捗を6/7のまま維持し、R1公式プレイとR2ランキングは保留する。