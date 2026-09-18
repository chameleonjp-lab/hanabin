# HANABIN Supabaseランキング連携

- 更新日: 2026年9月18日
- 対象ゲーム: `hanabin`
- 共有ランキング: カメレオンJP実験場の`public.games` / `get_best_score_ranking`
- 公開順: `57`
- 公開状態: コードはランキング連携Draft PR、Supabaseのゲーム行は`is_active=false`で登録済み

## 呼び出し順

1. 本番プレイ開始直前に`start_game_play_v1`を呼ぶ。`start_id`を再送しても同じ`play_id`になり、開始セッションが1プレイとして記録される。
2. 結果画面で`finish_game_play_v1`を呼ぶ。リタイアや通信切断後の離脱は、開始セッションを残したままランキング登録から除外する。
3. 再生確認済みのゲームオーバーだけ`submit_score_idempotent_v1`へ送る。`submission_id`の再送は二重登録にならない。
4. `get_best_score_ranking('hanabin', 10)`の結果を結果画面下部へ表示する。

開始セッション数をランキングのプレイ回数として集計するため、途中離脱を含む。トランザクション検証では、完了1回＋未完了1回で統計・ランキングのプレイ回数が2になり、検証データはロールバックした。

## 公開前ゲート

`is_active`は、Pagesへ新コードが反映されるまで有効化しない。main保護のため、ランキング連携Draft PRとCIの確認までを完了範囲とする。初見5人の受入は対象外。iPhone実機の確認は別途未確認として残す。
