# HANABIN

同色の花火を選び、起爆位置と時刻を考えて連鎖を伸ばす、スマートフォン向け60秒スコアアタックゲームです。

M1〜M7（決定的判定、Canvas版、ゲームプレイ硬化、独自花火表現、製品導線、公開候補の自動検証）は`main`へマージ済みです。現在はM7の公開確認中で、実機・初見試遊・Pages公開後のURL確認を残しています。ランキングはまだ実装していません。

## 実装を進める文書

- [`IMPLEMENTATION_EXECUTION_PLAN.md`](./IMPLEMENTATION_EXECUTION_PLAN.md)  
  実装する順番、Pull Requestの単位、主なファイル、自動試験、完了条件を定めます。
- [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md)  
  MVP全7工程の現在地を記録します。
- [`IMPLEMENTATION_ORGANIZATION.md`](./IMPLEMENTATION_ORGANIZATION.md)  
  企画、実装、検査、重大判断、公開前レビューの担当と承認条件を定めます。
- [`docs/M1_FOUNDATION.md`](./docs/M1_FOUNDATION.md)  
  M1の実装範囲、依存関係、自動試験、次工程との境界を記録します。
- [`docs/GAMEPLAY_GATE_1.md`](./docs/GAMEPLAY_GATE_1.md)  
  M2の決定的ルール、再生契約、安全試験、M3へ渡す境界を記録します。
- [`docs/M3_PLAYABLE_CANVAS.md`](./docs/M3_PLAYABLE_CANVAS.md)
  M3のブラウザ入力、固定tick、Canvas表示、再生確認、実機確認の境界を記録します。
- [`docs/GAMEPLAY_GATE_2.md`](./docs/GAMEPLAY_GATE_2.md)
  M4の予告波、得点補正、抜け道対策、全量戦略比較、安全検査を記録します。
- [`docs/PERFORMANCE_REPORT.md`](./docs/PERFORMANCE_REPORT.md)
  M5の装飾品質、光粒の上限、結果不変試験、未確認の端末性能を記録します。
- [`docs/M6_PRODUCT_SHELL.md`](./docs/M6_PRODUCT_SHELL.md)
  M6の初回練習、保存、結果、共有、音、中断復帰の境界と検査を記録します。
- [`docs/MVP_RELEASE_REPORT.md`](./docs/MVP_RELEASE_REPORT.md)
  M7の自動検査、公開版固定情報、GitHub Pages、実機検査、初見試遊の結果を記録します。

## ゲームの挙動を決める文書

ゲームルールや挙動は次の順で参照します。

1. [`ADVERSARIAL_REVIEW.md`](./ADVERSARIAL_REVIEW.md)  
   抜け道、単純な最適行動、端末差、不正送信、処理異常を防ぐための必須修正です。
2. [`GAME_CREATOR_REVIEW.md`](./GAME_CREATOR_REVIEW.md)  
   60秒の体験、上達、連鎖の狙いやすさ、成功時の反応を補強します。
3. [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)  
   基本ルール、技術構成、試験、MVP完成条件を定めます。

ゲームの挙動が競合する場合は上の文書を優先し、実装順序は`IMPLEMENTATION_EXECUTION_PLAN.md`を基準にします。

## 実装前半で証明すること

- 画面全体を雑になぞる行動が有利にならない。
- 3個を確保したまま長時間待てない。
- 前半を放置して終盤だけ狙う行動が有利にならない。
- 3個即起爆と多数選択のどちらか一方だけが最適にならない。
- 起爆位置と時刻を考えるほど連鎖と得点が伸びる。
- 同じ乱数初期値と入力なら、端末比率や表示品質が違っても結果が一致する。

## 開発方針

- MVPは7つの大きな工程で進めます。
- `main`へ実装を直接追加しません。
- 作業用ブランチとDraft Pull Requestを使います。
- 一つのPull Requestは、ブラウザまたは試験結果で確認できるまとまりにします。
- ゲーム設計審査を通過するまで、豪華な花火演出を優先しません。
- ランキングは、MVPの得点式と競技条件を固定した後に追加します。

## 現在の状態

- OSS調査: 完了
- 基本実装計画: 作成済み
- ゲームクリエイター・レビュー: 反映済み
- 敵対的検証: 反映済み
- 実装実行計画: 確認済み
- M1実装: Pull Request [#4](https://github.com/chameleonjp-lab/hanabin/pull/4)を`main`へマージ済み
- M2実装: Pull Request [#5](https://github.com/chameleonjp-lab/hanabin/pull/5)と独立レビュー補修 [#6](https://github.com/chameleonjp-lab/hanabin/pull/6)を`main`へマージ済み。Node契約試験、10,000 seed・20万波安全検査、1,000 seed×7戦略比較、7戦略再生監査が成功
- M3実装: Pull Request [#7](https://github.com/chameleonjp-lab/hanabin/pull/7)を`main`へマージ済み
- M4実装: Pull Request [#8](https://github.com/chameleonjp-lab/hanabin/pull/8)を`main`へマージ済み
- M5実装: Pull Request [#9](https://github.com/chameleonjp-lab/hanabin/pull/9)を`main`へマージ済み。選択線を保護した独自花火表現、光粒プール、品質別描画を確認済み
- M6実装: Pull Request [#10](https://github.com/chameleonjp-lab/hanabin/pull/10)を`main`へマージ済み。初回練習、端末内プロフィール、結果ヒント・共有、音設定を確認済み
- M7実装: Pull Request [#11](https://github.com/chameleonjp-lab/hanabin/pull/11)を`main`へマージ済み。公開版固定情報、最終自動検証、GitHub Pages準備を確認済み
- MVP実装: 6/7（自動検証は完了。実機・初見試遊・Pages公開後のURL確認が残るため未完成）
