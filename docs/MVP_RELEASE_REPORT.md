# HANABIN MVP公開候補レポート

- 作成日: 2026年8月12日
- 最終更新日: 2026年8月26日
- 対象リポジトリ: `chameleonjp-lab/hanabin`
- 対象: 公開中の`main`（MVPリリース候補`0.1.0`）
- 実装状態: M1〜M7をマージ済み
- MVP受入: **6/7・未完了**

> 2026年8月26日注記: 操作・演出・得点バランスを更新した`m4-gameplay-2`は、
> Pull Request [#34](https://github.com/chameleonjp-lab/hanabin/pull/34)で`main`へマージされ、GitHub Pagesへ公開済みである。
> マージ後の自動検査と公開検査は成功したが、iPhone 17 Pro / Safari実機と初見5人の試遊は未確認である。

## 1. 現在の判定

公開URLは表示でき、設定変更後の公開URL専用自動検査も成功している。2026年8月16日（日本時間）にGitHub Pages APIを再確認し、公開元がGitHub Actionsへ切り替わったことを確認した。

- 現在の公開方式: `workflow`
- 現在の公開元: `.github/workflows/pages.yml`が作る限定artifact
- 公開URL: https://chameleonjp-lab.github.io/hanabin/
- Deploy GitHub Pages: 成功
- Public Release Smoke: 成功（2テスト）
- iPhone 17 Proの横画面実機確認と初見5人の試遊: 未確認

Pages公開設定と自動検査は合格したが、実機確認と初見試遊が残っているため、M7とMVPは完了扱いにしない。

## 2. 公開版の固定情報

| 項目 | 固定値 |
|---|---|
| MVPリリース版 | `0.1.0` |
| ゲーム版 | `M4` |
| 公開中のルール版 | `m4-gameplay-2` |
| 直前のルール版 | `m4-gameplay-1` |
| 入力記録版 | `m2-input-1` |
| 端末内保存形式 | `v1` |
| 端末内プロフィールキー | `hanabin:profile:v1` |
| 実行時依存 | なし |

固定情報は`src/config/release.js`と`src/config/rules.js`から読み出す。今回、アプリ版はMVP受入前の`0.1.0`に据え置き、競技ルール版だけを更新した。保存ベストはルール版で分離・リセットし、旧ルールと比較しない。

## 3. 自動検査の証跡

### 3.1 直前版`m4-gameplay-1`の履歴

| 検査 | 証跡 | 結果 |
|---|---|---|
| Node 22/24、構文、単体試験 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136) | 成功 |
| 10,000シード安全検査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136) | 10,000/10,000成功 |
| 1,000シード×7戦略比較 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136) | 7,000実行成功 |
| 厳格な再生監査 | [CI Core #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136) | 7/7一致 |
| Chromium E2E | [CI Browser #29](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047138) | 24/24成功 |
| シミュレーション証跡 | [Artifact](https://github.com/chameleonjp-lab/hanabin/actions/runs/31481047136/artifacts/9097408031) | 保存済み |

安全検査では36,000,000更新と200,000波を処理し、異常終了、不変条件違反、再現差分、選択不能波、完全重複、予告不一致、生成規則違反、乱数分離違反は0件だった。

7戦略の平均得点は、予告利用が39,862.35点で首位だった。3個即起爆は28,929.642点、6個待ちは28,277.244点、密集起爆は27,091.7点、全面往復は19,365.098点、前半放置は11,659.062点、無作為は7,394.408点だった。

### 3.2 公開中の`m4-gameplay-2`の再検証

2026年8月23日にローカルで10,000 seed・36,000,000 tick・200,000波を省略せず検査し、fault、不変条件違反、非決定性、選択不能波、完全重複、予告不一致、生成規則違反、攻略用乱数漏れはすべて0だった。1,000 seed×8戦略と8件の保存入力再生も完走し、再生差分は0だった。

予告利用の平均は57,903.830点、中央値58,104点、予告固有点の比率は35.02%。最短5個は36,634.952点、最短3個は28,929.642点、密集起爆は27,098.398点、6個待ちは23,646.010点、全面往復は14,138.004点、前半放置は11,659.062点、無作為は7,436.210点だった。

この結果は内部状態を正確に利用する自動戦略の再現可能な上限確認であり、人間の操作性や理解度の合格証拠ではない。現行公開版では次波へつながる対象を金色の二重リングで表示する。マージ後の[CI Core #78](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500837)と[CI Browser #78](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500846)は成功したが、iPhone 17 Pro / Safariと初見5人の試遊は引き続き未確認である。

### 3.3 公開URL終端検査

設定変更後の[Public Release Smoke #18](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682529443)で、次の2テストが成功した。

1. 公開Pagesのホーム → 初回練習 → スキップ → カウントダウン → 本編 → 実時間60秒 → 結果画面
2. 公開対象外の `package.json`、README、docs、workflow設定がすべて404

結果画面は1回だけ登録され、JavaScriptエラー、4xx以上の応答、失敗リクエストは検出されなかった。これはChromiumによる自動検査であり、iPhone・iPadの実機確認ではない。

## 4. GitHub Pages

### 4.1 計画している公開物

`.github/workflows/pages.yml`は、次だけを公開artifactへ入れる。

- `index.html`
- `styles/`
- `src/`

テスト、文書、GitHub Actions設定、パッケージ管理ファイルは公開しない計画である。

### 4.2 2026年8月16日のAPI確認

| 確認項目 | 値 | 判定 |
|---|---|---|
| 公開状態 | `built` | 確認済み |
| 公開URL | `https://chameleonjp-lab.github.io/hanabin/` | 確認済み |
| HTTPS | 有効 | 確認済み |
| `build_type` | `workflow` | 合格 |
| `source.branch` | `main` | 確認済み |
| `source.path` | `/` | 確認済み |
| Deploy GitHub Pages | 成功 | [run #23](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682500867) |
| Public Release Smoke | 2テスト成功 | [run #18](https://github.com/chameleonjp-lab/hanabin/actions/runs/32682529443) |

現在はGitHub Actionsの限定artifactを公開している。公開対象外URLの404とホームから結果画面までの経路も、上記Smokeで確認した。

### 4.3 修正後の確認結果

Issue #27に沿って公開元をGitHub Actionsへ切り替え、次を確認した。

- Pages APIが`build_type: workflow`を返した。
- `Deploy GitHub Pages`が成功した。
- Public Release Smokeが2テスト成功した。
- `package.json`、`README.md`、`README.html`、`docs/MVP_RELEASE_REPORT.md`、`docs/MVP_RELEASE_REPORT.html`、`.github/workflows/pages.yml`が公開URLで404を返した。
- ホームから結果画面までの経路を維持した。

## 5. 実機検査

記録手順と未確認欄は、[M7手動受入チェックリスト](./M7_MANUAL_ACCEPTANCE_CHECKLIST.md)を正本として使う。作業用ブラウザの結果から実機性能を推測しない。今回のMVP実機受入対象はiPhone 17 Proの横画面のみとする。縦画面は非対応として開始できないことを確認し、iPhone 11 ProとiPad Pro 2018は今回の受入条件から外す。

| 端末 | 必須確認 | 状態 |
|---|---|---|
| iPhone 17 Pro | 横画面、縦画面非対応表示、タップ位置、長押し中の色選択、10回連続、大連鎖、中断復帰、回転、高品質、自動品質、共有、練習の再挑戦・本番進行 | 未実施 |

## 6. 初見5人の試遊

最低5人で次を実測する。人数や結果を推測で埋めない。

- 最初の成功までの中央値が12秒以内。
- 30秒時点で80%以上が「同色を3つ以上つないで離す」と説明できる。
- 2個以下で解除した操作が25%以下。
- 横画面案内から開始できない人が20%未満。
- 3回目までに得点または巻き込み率の中央値が15%以上改善する。
- 半数以上が次の波予告を意図的に使う。

状態は未実施である。

## 7. 完了判定

次のすべてがそろった場合だけM7を合格、MVP受入を7/7とする。

- 自動検査と全E2Eが成功する。
- PagesがGitHub Actionsの限定artifactから公開される。
- 公開対象外URLが404を返す。
- iPhone 17 Proの横画面必須項目が合格する。
- 初見5人の試遊結果が合格する。

文書だけを変更したPull Requestのマージ番号やSHAは、判定が変わらない限り追記しない。GitHubのPull Request履歴を正本とする。
