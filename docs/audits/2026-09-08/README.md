# 2026年9月8日の監査証跡

対象製品コミット: `5dca48f5a8c389c9fe591033ecd203c222672ee2`。ルール版: `m4-gameplay-3`。実行環境: Node.js 24.19.0。

結論と実装の順序は [監査・改善計画](../../ASTRA_QUALITY_AUDIT_PLAN_2026-09-08.md) を参照する。

## 資料の意味

| ファイル | 確認内容 |
|---|---|
| `gameplay-probes.mjs` / `.json` | 中心マウス入力、練習の失敗後の残存状態、seed 1〜20×3戦略の60走、補充由来の対象イベント点、終端予告、波時刻 |
| `gameplay-cue-probes.mjs` / `.json` | seed 1で自然に発生した状態を複製して誤った連鎖案内を検査。終端外の予告準備。練習対象の距離・移動量 |
| `gameplay-curves.mjs` / `.json` | seed 1〜20×既存2戦略の40走。各帯の平均点/秒、起爆/秒、連鎖/秒 |
| `presentation-storage-repro.mjs` / `.txt` | 共有保存先の古いタブ、将来のルール版変更、再生不一致を作った異常系、AudioContextのinterruptedを作った分岐 |
| `verification.json` | ローカル既存検査、公開Chromeでの観察範囲と画面右上の実測、未検証事項 |

これらは**監査時点の挙動を再現する調査用スクリプト**である。製品の正しい期待値を定める自動テストではない。修正後に旧結果と一致することを要求しない。実装時は、正しい挙動を期待する回帰テストへ該当条件を移す。

60走と40走は別々に実行した。seedが一部重なっており、独立した100人分の試遊や100種類の盤面を意味しない。追加の4個戦略はこの監査だけの戦略で、製品の8戦略には追加していない。

`gameplay-probes.json`の`reserveScore`は補充対象IDへ帰属する`scoreEvents.amount`だけの合計で、準備ボーナスを含まない。`gameplay-curves.json`の`score`は20走平均、`detonations`と`chainTargets`は20走合計、`*PerSecond`は20走平均を帯の秒数で割った値である。終端後処理の点は既存の計測規則どおり最後の帯へ含む。

## 再現方法

製品が監査対象コミットと同じ状態の作業コピーで、リポジトリのルートから実行する。各スクリプトは外部サービスへ書き込まず、ゲームコードを変更しない。最初の3本は同じディレクトリのJSONを再生成する。

```sh
node docs/audits/2026-09-08/gameplay-probes.mjs
node docs/audits/2026-09-08/gameplay-cue-probes.mjs
node docs/audits/2026-09-08/gameplay-curves.mjs
node docs/audits/2026-09-08/presentation-storage-repro.mjs
```

監査スクリプトをこの場所へ移した際は、import先と出力先だけを相対パスへ変更した。元の作業場所で3本のゲーム検査を実行して結果を保存し、移動後は構文を確認した。保存・音の再現はこの配置から再実行して成功した。

## 検証の限界

iPhone 17 Pro Safari、音の聴感、発熱、初見5人は未確認。公開Chromeの中心なぞりは操作速度・時間制限も影響するため、マウス問題の主根拠は座標変換のNode再現とする。縦画面の比率問題はコードと数式で確認しており、該当サイズの実ブラウザ確認は修正PRで行う。

同時タブの保存は2つのstore/controllerで同一storageを共有する再現であり、実ブラウザの2タブを操作した試験ではない。再生不一致と音のinterruptedは検査用に作った状態であり、自然なプレイで発生したという記録ではない。
