# イヌボー（犬のスケボー）

人が犬の背に乗り、犬そのものをスケートボードに見立てて街を滑るブラウザゲームです。1回の走行から「総合スコアの自己最高」と「完走タイムの自己最速」を別々に残します。仕様は[要件仕様書](docs/game-requirements.md)、作業と検収の手順は[実装計画書](docs/implementation-plan.md)にあります。

## 遊び方の要点

犬は自動で前へ進みます。地面で左右に払うと横へ動き、上へ払うと跳びます。空中では新しい指で円を描くと犬だけが回り、直線を引いて離すと人と犬が一緒に回ります。円と線を重ねると複合技になります。コースは公園・商店街・川沿いの3本、犬は柴犬・コーギー・ウィペットの3種で、最初からすべて選べます。

## 動かし方

Node.js 22 で動かします。

```bash
npm ci                 # 依存ライブラリを入れる（版は package.json で固定）
npm run dev            # 開発用サーバー
npm test               # 計算の試験（Vitest、V01〜V18 を含む）
npm run build          # 型検査と本番用のビルド（dist/）
npm run test:e2e       # 画面の通し試験（Playwright、ビルドして配信してから確かめる）
npm run report         # 自動再生の記録を docs/autoplay-report.md に書き出す
```

`.npmrc` で `legacy-peer-deps=true` にしています。Vitest の任意の相手依存（ブラウザ試験用の追加部品など）を npm が自動で解決しようとして、npm 本体の内部エラーで止まったためです。必要な依存は package.json にすべて書いてあります。

### 検査用の URL パラメーター

`npm run build:e2e` で作った試験用の `dist-e2e/` だけで使えます。本番は `npm run build` で作る `dist/` を配信します。試験用の自己ベスト、スタンプ、送信待ちは試験用のキーで保存します。

| パラメーター | 働き |
|---|---|
| `?debug=1` | 入力の長さ・軌跡・判定名と、走行の状態を画面に出す（試験時だけ） |
| `?autoplay=safe\|short\|trick&speed=8` | コースに書いた手順で自動操縦する（通し試験と自動再生用） |
| `?ranking=mock` | 公開順位を試験用の接続先（端末内の模擬サーバー）で動かす |

### 公開するときの設定

1. GitHub の **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
2. `main` にマージすると自動検査が始まり、成功後に GitHub Pages へ配信される。配信先の URL を使って、ホームと結果の共有文を作る。
3. ゲーム内ランキングを有効にするときは、イヌボー専用の Supabase に `supabase/migrations/` の SQL を適用し、以下の GitHub Actions のリポジトリ変数を設定して再配信する。変数がなければ端末内の記録で遊べる。

| 設定 | 働き |
|---|---|
| `INUBO_SUPABASE_URL` | 専用 Supabase の Project URL |
| `INUBO_SUPABASE_PUBLISHABLE_KEY` | 専用 Supabase の公開用キー（`sb_publishable_` で始まるもの） |

最初のゲーム内ランキングは公園の総合点・最速タイムを各上位30人まで表示します。名前を入れて開始した走行のみを対象にし、実験場とは別に運用します。商店街と川沿いは実測して採点基準を固定してから順位を有効にします。サーバーは同一走行の再送、完走までの経過時間、得点の範囲と合計を確認します。

## 作りの概要

計算（入力・接触・採点）を画面の描画から切り離しています。走行は 5ms の一定の刻みで進み、時刻は整数マイクロ秒で扱います。描画の回数や間隔が変わっても、同じ入力なら同じ結果になります（V02 で確認）。

| 場所 | 中身 |
|---|---|
| `src/game/` | 走行時計と進行役（`run.ts`）、動き（`motion.ts`）、接触（`contacts.ts`）、技（`tricks.ts`）、手すり（`rails.ts`）、採点（`scoring.ts`）、アイテム（`items.ts`）、道の組み立て（`track.ts`）、自動操縦（`autopilot.ts`） |
| `src/input/gestures.ts` | 指の軌跡の認識（画面の短辺に対する比率で判定） |
| `src/content/` | 犬種（`dogs.ts`）と3コース＋練習広場のデータ（`courses/`） |
| `src/view/` | Three.js の描画（`scene.ts`・`models.ts`・`camera.ts`）、演出の割り当て E01〜E24（`effects.ts`）、最速の走りの再生（`replay.ts`） |
| `src/audio/sound.ts` | 音の判断（重なり・消音・復帰）と、Web Audio による音の合成 |
| `src/ui/` | 画面の流れ（`screens.ts`）、結果（`results.ts`）、練習広場（`practice.ts`）、共有（`share.ts`） |
| `src/storage/records.ts` | 端末内の記録（版ごとの最高点・最速と再生、スタンプ、設定） |
| `src/ranking/` | 公開順位の送受信（`client.ts`）と試験用の接続先（`mockServer.ts`） |
| `tests/` | 計算の試験（`*.test.ts`）と画面の通し試験（`ui.spec.ts`） |

## 進み具合

P09 の iPhone 17 Pro による操作・効果音・配点の測定は、[実機受入の記録](docs/acceptance-record.md)に残します。プルリクエストの自動検査を通ると、配信可能な実機確認用の成果物も取得できます。
