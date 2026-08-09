# HANABIN 実装進捗

- 更新日: 2026年8月9日
- MVP進捗: **1/7**
- 現在地: M2 決定的コアと簡易シミュレーターのDraft Pull Request [#5](https://github.com/chameleonjp-lab/hanabin/pull/5)を確認中
- 実装コード: M1が`main`へマージ済み。M2は全量Node検査成功、承認・マージ前

## MVP工程

| 工程 | 内容 | 状態 | Pull Request |
|---|---|---|---|
| M1 | 静的基盤と自動試験 | 完了（`main`へマージ済み） | [#4](https://github.com/chameleonjp-lab/hanabin/pull/4) |
| M2 | 決定的ゲーム判定と簡易シミュレーター | Draft・全量Node検査成功（承認・マージ前） | [#5](https://github.com/chameleonjp-lab/hanabin/pull/5) |
| M3 | 円表示で遊べるブラウザ版 | 未開始 | — |
| M4 | 抜け道対策とゲーム設計審査 | 未開始 | — |
| M5 | 本作独自の花火表現と性能対策 | 未開始 | — |
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
- 4色、整数盤面、60Hz/3600tick、6波、次の2波予告、最初の指、3tick保持・1tick1取得、選択リンク、画面外解除、二段階衝突、爆発連鎖、重複防止、仮得点式を実装。
- seed、ルール版、入力スキーマ版、全判定値のルール指紋、3600フレームを含む厳格な入力再生と`simulationFault`を実装。
- 10,000 seed安全検査はfault・不変条件違反・再現差分0。1,000 seed×7戦略も全戦略fault・不変条件違反0。
- `docs/GAMEPLAY_GATE_1.md`へ全量分布と、最短3個が首位である未解決のバランス課題を記録。

## 次の作業

Draft Pull Request [#5](https://github.com/chameleonjp-lab/hanabin/pull/5)でGitHub ActionsのNode 22/24、全量シミュレーション、既存ブラウザ回帰を確認する。Ready化とマージはユーザー本人の明示指示まで行わない。M3ではこの純粋なコアへブラウザ入力と表示を接続する。
