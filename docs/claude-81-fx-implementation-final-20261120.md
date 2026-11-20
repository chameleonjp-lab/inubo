# イヌボー｜Claude向け81種類の演出 実装計画書【完成版】
版 v1.0／作成・検証 2026-11-20／対象 chameleonjp-lab/inubo
基準main: 32f35ab11b6d5ebdfd335e991882e5c49c444483（PR #26・#27マージ後）

> 本文が実装手順の正本。描写の名前・ID・起点・動き・消え方は docs/2026-11-20-81-trick-visual-spec.md、レビュー25件は docs/claude-81-fx-adversarial-review-20261120.md。初版より本完成版を優先する。

## 0. 作業の目的と変更してはいけないもの

**81件＝B（両方）27件＋H（人のみ）27件＋D（犬のみ）27件。それぞれF（派手さ）10段階＋A（空中軌跡）7段階＋L（着地）10段階。** 81件の個別の形・動き・起点・終了条件を実画面で再現する。10×7×10を掛け合わせた「100通り」式は完全廃止し、同じ色違いだけを別項目として数えない。

Claudeの担当は3D描画／操作確認版／着地のUI／音の実装と、そのための読み取り専用イベント情報追加。物理回転、半回転判定、技名150種、切替連携加点、採点・ルールバージョン、総合結果30段階と称号60件、順位・送信・Supabase、保存された自己ベスト・旧リプレイ・スタンプ・服装は変更・初期化禁止。PR #27で削除されたホームの5項目を戻さない。

Claudeは独立した作業ブランチでコードPRを作り、mainへ直接push・自動マージ・勝手な本番公開をしない。外部の従量課金・追加費用の機能を無断利用しない。失敗した自動テストは解消してからPRを完成扱いにする。

## 1. 2026-11-20時点のコード・問題箇所

| 現在のコード | 行うこと |
|---|---|
| src/view/trick-fx.ts: TRICK_FX_100／chooseTrickFx／trickFxTier（5×5×4） | 81-IDのレジストリと10/7/10の決定関数で置換 |
| src/view/scene.ts: 約90msごとのscoreFreeMotion再計算、5種類の光、着地4種 | 空中専用の難度見積り、実部位に追従する81描画、着地1回実行 |
| src/view/models.ts: Rig.pawは四足ではなく犬の中心 | 実際の四足・耳・しっぽ先・手首・靴底等の非表示計測点を追加 |
| src/view/free-scene.ts: 球モデル上で8粒／旧5軌跡 | 同一の81選択器と球モデル用計測点アダプターを使用 |
| src/view/effects.ts、src/view/trick-landing.ts、src/ui/trick-landing.ts/.css | 技名・区間採点済み・連携点を保持しB/H/DとL10を表示 |
| src/audio/sound.ts: 着地音5種類 | 段階ごとに区別できる着地音10種類×B/H/Dの音色 |
| tests/trick-fx.test.ts: 100種類前提 | 81件の実装存在・境界・描画・音の試験へ差替 |

重要：run.ts の closeAirborneJump はfreeFlightをnullにしてから着地を確定する。着地描画時に履歴を参照しても正しい分類を取り戻せない。過去のreplay.tsには81 IDが記録されていない。さらにscene.tsの途中scoreFreeMotionは経過時間が短いと理論上限扱いで早く1000点になる危険がある。以上を設計上の前提とする。

## 2. 81件を必ず実装するためのデータ構造（P0）

新設 src/view/trick-fx-81.ts に静的な81件の定義を置き、src/view/trick-fx.tsを81選択関数へ置き換える。実行中のブラウザにMarkdown原稿を読み込ませない。正本の81行と照合するテストを置く。

型の要件：
- Target＝'B'|'H'|'D'。Kind＝'F'|'A'|'L'。
- FxIdは B-F01〜B-F10／B-A01〜B-A07／B-L01〜B-L10 とH・Dの対応する文字列の**限定された81-ID集合**。余分なIDを許さない。
- FxProgram＝{ id, name, target, kind, level, anchors, recipe, trigger, lifetimeMs, opacityMax, sizeMax, params }。全フィールドを実装し、nameを正本から転記。空のrecipeは禁止。
- Anchors＝dogNose, dogEarL/R, dogTail, dogPawFL/FR/BL/BR, dogBack, dogBelly, riderHead, riderHelmet, riderShoulderL/R, riderHandL/R, riderWaist, riderShoeL/R, pivot, contact。実際の身体モデルから座標を取得し、静止したテクスチャを貼って済ませない。
- recipeは点／輪郭／円弧／二重リング／らせん／楕円8の字／扇／残像／足印／肉球／星／紋章の再利用可能な基本部品を時系列で組み合わせる。81件は別々の演出シーケンスを定義する。1件を描くための新しい外部画像やネットワーク読み込みは不要。
- レジストリのID、レベル、名称とレシピを自動検証し、各IDの効果が段階の色違いだけにならないことを描画コマンド列でも比較する。

## 3. 段階・対象・状態の決定（P0）

### 3-1. 段階の閾値（必ず以上で判定）
F／Lの10段階＝[1,80,160,260,400,550,700,950,1250,1650]。
Aの7段階＝[1,160,400,700,950,1250,1650]。
各境界とその前後、0点、最大値、NaN、負値を単体テストで検証。Aは実際の回転が始まるまで非表示、0点の離陸だけは選択された対象のF01を小さく出す。技不成立の0点着地は通常のplain landでありL成功演出は出さない。

**上位段階が犬だけ／人だけでも実際に選べるようにする。** 現行の基礎回転点上限1000に対して段階10の閾値は1650なので、以下の**見た目専用難度値**を導入する。

~~~ts
function visualDifficultyPoints(basePoints: number, actualTrickPoints: number): number {
  const base = Math.max(0, Math.min(1000, Math.floor(Number.isFinite(basePoints) ? basePoints : 0)));
  const actual = Math.max(0, Math.min(2050, Math.floor(Number.isFinite(actualTrickPoints) ? actualTrickPoints : 0)));
  return Math.min(2050, Math.max(actual, Math.round(base * 1.65)));
}
~~~

段階に渡すのはこの値だけで、表示する得点・ゲーム中の実加点・ランキング・記録は既存のactualTrickPointsのまま。純粋に難しい単独回転の基礎点1000なら見た目の最高段階10になり得る。連携による高実得点も評価する。この決定は敵対的レビューR02/R25に基づく「難易度または得点に応じて豪華にする」ための実装上の補足で、ゲームの点数変更ではない。

### 3-2. 飛行中と着地は別々に計算
飛行中に scoreFreeMotion(history, 現時点までの短いairtimeUs) のpointsをそのまま使うことは禁止（R23）。フライト開始時にジャンプ種類・上向き初速・重力から予測全滞空時間を1回だけ計算する。平地・踏切台は約 2×上向き初速÷重力、高低差不明の落下は最低0.45秒として、予測値を0.45〜1.8秒に収める。これは**表示だけの基準**であり、着地位置・接触時刻・スコアへ渡さない。

固定した走行時計を基準として約90msごとに、累積した半回転単位の実回転量・方向数・実際に成立済みの切替連携を使って暫定base（0〜999）と暫定bonusを計算する。予測全滞空時間の理論回転角を分母とし、**途中のnearLimit満点化は使わない**。暫定値を上記のvisualDifficultyPointsへ渡す。同じジャンプ中のF/Aは一度上がった段階を下げない。描画fpsやperformance.now()の差で選択段階を変えない。

着地時にはじめて既存のscoreFreeMotionが確定したbasePointsとpointsを用い、L段階を決定する。仮の計算値を実得点として保存・表示しない。連携成立マークは既存のscoreTargetSwitchesで**実際に連携数が増えた時**だけ出す。段階6や10だからといって「連携成功」を偽装しない。

### 3-3. B/H/Dの主体と切替
空中の主役は最後に**受理されたfreeRotate入力のtarget**を優先。離陸直後まだ入力がなければ画面で選んでいる対象（初期B）をF01の主役にする。切り替えボタンを押した時点で表示は即変わるが、軌跡の新規描画は次の受理済み回転から移る。従前の軌跡は0.2〜0.4秒で薄く消す。

実際に動いた身体はomega.common＋omega.dog（犬）／omega.common＋omega.rider（人）で判定。片方が逆回転で相殺されれば、動いていない側の回転軌跡は出さない。Bでも実際に回っている各身体にだけ線を引く。

着地のB/H/Dは**ジャンプ全体の有効回転**から判定し、ボタンの最後の選択を使わない。既存free-score.tsにある「方向ごとに180度以上」の成立値を再利用。犬・人ともに成立B、犬のみD、人のみH、いずれも不成立なら成功演出なし。新規に合計角度だけで判定し直さない。

src/game/free-score.tsの戻り値へreadonly scoredTarget（'common'|'dog'|'rider'|null）を追加して、既存の技名判定と同じ結果を外へ出す。points、basePoints、switchBonus、switchCount、tier、labelの計算は変更しない。src/game/run.tsではfreeFlight消去前にこれを取得し、src/game/tricks.tsのJumpScore（任意フィールド）→src/game/scoring.tsのland通知→src/view/effects.tsのCueへ伝える。旧ルールのlandは新FX対象外。

### 3-4. 実行時の状態
src/view/trick-fx-controller.ts（新規）はrunId＋jumpIdごとに takeoff→air→land または interrupt→dispose を管理する。状態は{selectedTarget, acceptedTarget, FLevel, ALevel, lastInputUs, lastFxTickUs, emittedLanding, trailBuffers, visualTimeline}のような表示専用構成とする。landの二重通知、手すり接地、連続ジャンプ、停止後の再開で同じLを2回鳴らさない。停止／タブ非表示／画面回転の間は新規生成を停止し、時間を埋め合わせて大量発生させない。

## 4. 81 IDごとの描画コマンド対応表（P1）
下表の「起点・レシピ」はClaudeが実際に実装するコマンド。IDごとの詳しい動きと消滅条件は81件の正本に必ず一致させる。

<!-- INSERT-81-MAP -->

