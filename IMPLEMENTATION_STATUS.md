# HANABIN 実装進捗

- 更新日: 2026年8月11日
- MVP進捗: **4/7**（M1〜M4が`main`へマージ済み、M5をDraft Pull Request向けに検証中）
- 現在地: M1〜M4はPull Request [#4](https://github.com/chameleonjp-lab/hanabin/pull/4)、[#5](https://github.com/chameleonjp-lab/hanabin/pull/5)、[#6](https://github.com/chameleonjp-lab/hanabin/pull/6)、[#7](https://github.com/chameleonjp-lab/hanabin/pull/7)、[#8](https://github.com/chameleonjp-lab/hanabin/pull/8)で`main`へマージ済み。M5の独自花火表現と品質別描画を作業ブランチで検証中
- 実装コード: M1〜M4が`main`へマージ済み。M5は未マージのため工程数へ加えない

## MVP工程

| 工程 | 内容 | 状態 | Pull Request |
|---|---|---|---|
| M1 | 静的基盤と自動試験 | 完了（`main`へマージ済み） | [#4](https://github.com/chameleonjp-lab/hanabin/pull/4) |
| M2 | 決定的ゲーム判定と簡易シミュレーター | 完了（独立レビュー補修を含め`main`へマージ済み） | [#5](https://github.com/chameleonjp-lab/hanabin/pull/5) / [#6](https://github.com/chameleonjp-lab/hanabin/pull/6) |
| M3 | 円表示で遊べるブラウザ版 | 完了（`main`へマージ済み） | [#7](https://github.com/chameleonjp-lab/hanabin/pull/7) |
| M4 | 抜け道対策とゲーム設計審査 | 完了（`main`へマージ済み） | [#8](https://github.com/chameleonjp-lab/hanabin/pull/8) |
| M5 | 本作独自の花火表現と性能対策 | 実装・自動検査中（Draft Pull Request準備中） | — |
| M6 | 製品画面、初回練習、保存、結果、音 | 未開始 | — |
| M7 | 総合検証とMVP公開 | 未開始 | — |

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
- M7で初見外部試遊が未完了の場合: `6/7・公開試験中`と記録し、MVP完成とは扱わない。

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

## 次の作業

M5をDraft Pull Requestへ登録し、GitHub ActionsのNode 22/24、全量シミュレーション、Chromiumブラウザ試験を確認する。実機確認はM7の公開候補検証へまとめ、工程ごとの確認は行わない。Ready化とマージはユーザー本人の明示指示まで行わない。
