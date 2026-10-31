# 共通仕様対応記録（2026-10-31）

## 対象と維持する契約

HANABIN（ハナビン）は現行実験場DB `public.games` で `game_slug=hanabin`、`is_active=true`。公開URL https://chameleonjp-lab.github.io/hanabin/ のHTTP200と既存ページを確認した。詳細ランキングは https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=hanabin 。このPRの変更は未公開。

基準コミット `84bf952f7daf9bd6e557b8cc4e9233728aee4ae0`、着手時の関連オープンPRなし。既存仕様/監査/CI/Pagesを読み、60秒・選択2.5秒・同色3つ以上・配点・不正記録/リタイア条件・再生検証を変更していない。Supabase `mlpnjgezrnhdxsxolyzj`、game_slug、`start_game_play_v1` / `finish_game_play_v1` / `submit_score_idempotent_v1`、既存client_versionを保持する。

既存profile、自己ベスト、音設定、端末TOP10、legacy rankingを削除/初期化しない。旧pendingキー `hanabin:ranking-pending:v1` を残し、複数の確定結果を上書きしない新しい `hanabin:ranking-pending:v1:queue:v2` を追加して併読する。選択言語は `hanabin.language.v1`。音量は既存profileへ追加し、保存済みsoundEnabled=false/soundVolume=0を有効値として読む。

別originの旧ページのlocalStorageを自動移行する実装ではない。旧データはそのページに残り、同一originの既存保存は継続する。ゲーム/参加者の識別値やサーバースコアはURLと一緒に変更しない。

## 対応表

| 項目 | 状態 | 内容・残件 |
|---|---|---|
| 1 対象 | 既存で対応済み | 現行active登録と公開ページを照合 |
| 2 記録・ルール | 既存維持 | 既存採点・60秒・2.5秒・replay検証・旧保存を保持 |
| 3 正式URL | 既存＋今回実装 | GitHub正式URL、location由来の共有URLを確認済みのcanonical公開ページに固定。移行/登録DB更新不要 |
| 4 多言語 | 今回実装／一部未確認 | 15言語の本文/練習/操作/進行/結果/ランキング/名前/設定/通信/共有。保存優先、ブラウザ言語、英語fallback。母語評価未実施 |
| 5 名前・登録 | 今回実装／一部未完了 | ホーム任意、空白は公開登録せず。開始名/開始ID/確定結果/送信IDを固定、通信を待たず開始、既存冪等RPCで再送。同名/改名の本人識別はDB契約の残件 |
| 6 ランキング | 今回実装 | ホーム/結果の詳細URL、集計済み上位30。ローカル履歴10件は独立した既存表示として保持。登録失敗でもランキング読取を試みる |
| 7 X共有 | 今回実装 | 黒白「Xでシェア」、ホーム紹介/今回結果+正式URL、プレイヤー名を除去、投稿画面とコピー代替 |
| 8 効果音 | 既存＋今回実装 | 既存生成SEを維持、suspendedで音を予約せず、停止・破棄・復帰動作を補正。聴取未実施 |
| 9 音設定 | 今回実装 | 初回ON/音量0.5、保存OFF/0を尊重、音量slider、音声失敗は開始を止めない |
| 10 文言・画面 | 今回実装／一部未確認 | 必須名の説明を任意/公開範囲へ変更、長い翻訳/30件対応。iPhone17Pro Safari実機未確認 |
| 11 自動公開 | 今回実装／本番確認待ち | Pages source workflow確認。既存2つのCIの同一SHA成功を条件に配備。PR由来workflow_runを除外、現行main SHAを配備前に確認 |
| 12 検証 | 実施／一部未確認 | unit/決定的simulation/Chromium/WebKitを実行、最新結果はPR記載。本番スコア書込なし。実機/母語/実音/マージ後本番未確認 |
| 13 PR/記録 | 今回実装 | 本書・既存受入docs・PRへ範囲、SE、依存、受入/戻し方を記録 |

サイノメ main `79b1e5733e725cd1148b10fa5699ba846e2bf57d` を参照し、ja/en/es/pt-BR/zh-Hans/fr/de/ko/ru/it/zh-Hant/id/tr/vi/th を使用。本文271キーとHUD/音量等の補助語を翻訳。日本語固有の言語問題を出すゲームではないため問題置換は対象外。言語変更でrun/時間/得点/送信状態をリセットしない。

## 名前・通信の判断

ホームで名前を変更/消去し、次回の参加だけへ適用する。空白は有効なゲスト。ゲストはstart/finish/submitを呼ばず、後から名前を付けても過去結果を公開しない。旧版に匿名開始記録はないため、それを削除する変更ではない。

名ありはrunに名前とstart UUIDを固定し、通信中でも本編を開始する。確定結果を保存してからfinish/submitする。遅い開始応答を次のプレイに混ぜない。失敗時は元のstart/play/submission IDと同じpayloadで再送し、古いpending単一レコードも残す。リタイア/不正結果は従来どおりランキング対象にしない。旧pendingと新pendingの複数プレイを上書きしない。

サーバー参加者は既存の表示名キーであり、同名別人の分離・改名しても同じ本人であることの保証は未完了。フロントエンドのUUIDで過去のスコア所有者を推定しない。DB参加者契約の移行が必要で、本PRでは本番DBを変更しない。

## SE実装表

既存のWeb Audio合成音を保持。詳しい音色・priority・voice上限は `src/audio/sound.js` と既存 `docs/EXPERIENCE_BALANCE_AUDIT.md` を参照。

| 対象イベント | 役割/条件 | 重複・停止 | 実装 |
|---|---|---|---|
| 押下・なぞり・選択 | 選択の成立を確認 | 既存イベント間隔/priority、外輪など視覚も保持 | tap/trace/selection |
| 起爆・連鎖 | 連鎖の開始と進行を補助 | 既存連鎖イベント単位・voice制限 | detonation/chain |
| 節目・得点 | 確定した加点の補助 | 既存の最小発音間隔/priority | milestone/score |
| 出現・消滅 | 盤面変化を補助 | 視覚表示と同じイベント | spawn/expire |
| 取消 | 3つ未満等の選択取消の確認 | 同じ取消を重ねない | cancel |

ミュート/0、ページ非表示・停止時は古い音を残さず、復帰時にsuspended中の音をまとめて鳴らさない。音がなくても外輪/数値/予告/盤面のフィードバックは維持する。音源を増やす目的でゲームイベントは新設していない。

## 適用順・受入・ロールバック

1. 依存PR/追加DBスキーマ更新なし。Pages source=workflowは確認済み。ユーザーがmainへマージ後、CI CoreとCI Browserが同じ対象SHAで成功した場合のみ既存Pagesを配備する。
2. PR作成/更新は検証のみ。公開前に対象SHAが現行mainと一致することを確認する。index/ranking-manifest/styles/srcを配備し、開発ファイルや秘密情報は含めない。
3. マージ後、Actions/Pagesの対象SHAと正式URLで15言語・任意名説明・音量/上位30を確認する。実施前に公開確認済みとは報告しない。
4. iPhone Safariで縦横/短い画面/操作バー/キーボード、名前の日本語変換確定、空白・変更・消去、OFF/0→再読込、Xから復帰を確認する。Playwright WebKitは実機Safariの代替確認ではない。
5. 通信は既存モックを優先。ゲストRPC0回、名ありの開始/確定1回、失敗/再読込で同じID、複数未送信結果の保持、後の名前が混入しないことを確認する。
6. 問題時はrevert PRをmainへマージし、同じ検証/公開経路で前版へ戻す。既存profile/新旧pending/スコアの削除は不要。

localStorageが拒否/容量不足の場合は同じタブのメモリだけで結果を保持する。保存失敗時の再読み込み後の復元は保証できない。保存拒否自体はゲーム開始/結果表示を止めない。
