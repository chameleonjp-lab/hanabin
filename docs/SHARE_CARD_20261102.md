# 固定SNSカードとX共有

対象: HANABIN（ハナビン）。正式URL https://chameleonjp-lab.github.io/hanabin/ 。固定タグは本人指定の `#ハナビン #ゲーム制作` を全言語で維持。

## 画像を先に確認
既存のOG/twitter画像meta・利用可能な固定画像はなかった。既ゲームrendererを匿名/外部通信遮断のローカルCIで動かし、canvas実ピクセルを等比cropし、紹介用のゲーム名/60秒の題字と並べたPNGを採用。名前欄/得点HUD/架空の成績は含めない。実際の青い菱形・赤い輪・予告の黄色い輪を示す。製品rendererは変更せず、右下の開発表示はcrop範囲外にした。盤面のオブジェクトを描き足していない。

- 画像: `src/assets/social-card.png`、1200×630px、296964 bytes。
- SHA-256: `9ede69db3949b743104eb35e0b539a1153ef733e2d780dd266f2e50c5d20697d`。
- 出典: branch head `c5ce05e03243528894266a748cdcc6720b39ff13`、CI Browser run `41400521615`、artifact `13121425850` Chromium紹介カード。
- seed7、advanceTicks120、実tick119、active10、bright pixels4607、遮断境界へ達した外部通信0。
- 最初の素材はresize後に空canvasとなっていたため不採用・保全。layout確定後に既rendererを再描画し、pixel検査と実見を両方行ってから採用した。ゲーム描画・ルール自体は変えていない。

## 設定と文言
og/twitterの絶対画像URL、寸法、alt、正式URLと紹介を追加。画像は既Pages公開対象src以下なので公開設定の変更なし。ホームはゲーム紹介、結果は今回確定スコア/最大連鎖を維持し、プレイヤー名を載せない。15言語本文の翻訳を保ち末尾タグだけ共通化。

X weighted長は公式twitter/twitter-text config/v3.json（2026-11-02確認、URL23/上限280）に基づき固定本文を検査。最大score2147483647/chain99999でhome最大125、result最大113。絵文字clusterを含まない現テンプレートを対象とする。将来文面変更は同検査を通す。

## 検査と適用
画像取得→実見→meta/tag設定→15言語縦とja/en/de横のhome/result可視・X intent配線・黒白・44px・中心hit・祖先opacity・touchタップ・結果保持の順。X popupはstub、ゲームはローカル、外部はdeny。iPhone実機、実際のXカード再取得/キャッシュ反映は本人マージ・公開後に確認する。現時点で公開済みとは報告しない。

PR67（公開smokeの非送信化）は別単位であり本差分に複製しない。本PRをマージする前にPR67の安全化をマージする順序を推奨する（既存のmain公開smokeには名前付き本番通信の懸念が残る）。マージは本人のみ。本番smokeの手動再run、DB操作、記録削除は実施しない。今回branch限定の画像取得用pushtriggerはDraft作成前に元へ戻す。最終通常PR検査を重複起動しない。

戻す場合はこの画像/meta/tag差分のみrevertし、採点/保存キー/既存スコア/PR67安全化は保持する。素材削除は今行っていない。

本人の後続指定「Xがあれば独立した共有文コピーボタンは不要」について、既HTMLはhome/resultともXのみで独立copy UIなし。controllerのcopyはXを開けない場合だけの代替なので維持し、独立copyボタンが増えない回帰を追加した。
