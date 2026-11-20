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

### B：両方

| ID | 正本の名称 | 起点（AnchorKey） | 固有の描画・変化 |
|---|---|---|---|
| B-F01 | 同時点灯 | dogPawFL・riderShoulderL | 犬の前足と人の肩を別々に250ms増光→350msで消す2点 |
| B-F02 | 二重輪郭 | dogBack・riderWaist | 犬は橙・人は青の輪郭線を体表に沿わせ、速度低下で消す |
| B-F03 | 呼応する明かり | dogPawFL・riderShoulderL | 犬の足から人の肩へ2つの光を500ms以内に順次送る |
| B-F04 | 対になる円弧 | dogBack・riderWaist | 左右反対に開く2つの円弧を実回転方向へ伸ばす |
| B-F05 | 交差する光帯 | dogBack・riderWaist | 身体の背後で橙と青の帯がX字交差、顔は隠さない |
| B-F06 | 連携の拍動 | dogPawFL・riderShoulderR | 二光点が中央へ集まり600msで解散。連携増加時だけ文字と拍動 |
| B-F07 | 重なる輪郭残像 | dogBack・riderWaist | 両身体の輪郭残像を各最大2枚、回転後方で400ms減衰 |
| B-F08 | 二重の軌道光 | dogBack・riderWaist | 独立した傾きの光環2つを逆軸で回し、交点だけ発光 |
| B-F09 | 天空の交点 | dogPawFL・riderHandR | 二人の軌道交点に小星1個、交差した瞬間のみ点灯 |
| B-F10 | 共鳴の大舞 | dogBack・riderWaist | 二色多層輪が別々の回転を追い、連携確認時だけ合体紋章 |
| B-A01 | 並走する2本線 | dogPawFL・riderShoulderL | 足と肩から異なる2線、直近200msの位置のみ連結 |
| B-A02 | 対称の弧 | dogPawFR・riderShoulderR | 上下に分かれた2本の半円を、実移動方向に開く |
| B-A03 | 二重らせん | dogBack・riderWaist | 犬橙／人青の2本らせん、角速度で巻幅が変化 |
| B-A04 | 交差するXの線 | dogPawFL・riderShoulderR | 双方の実軌跡が近い時だけX交点を光らせる |
| B-A05 | 8の字の共演 | dogPawFL・riderHandL | 上下にずれた二輪の8の字。片方静止なら一輪だけ |
| B-A06 | 交差する2つの軌道 | dogBack・riderWaist | 縦横回転の方向に連動する2つの傾斜楕円 |
| B-A07 | 連携の編み紐 | dogPawFL・riderHandR | 過去の入力対象順に二色線を編み、後方からほどく |
| B-L01 | 同時の足元光 | dogPawFL・riderShoeL・contact | 前足と靴底の接地に沿う2系統の点、300msで消す |
| B-L02 | 2つの着地輪 | dogPawFL・riderShoeL・contact | 橙と青の同心円2組を接地からゆっくり広げる |
| B-L03 | 並ぶ足跡印 | dogPawFL・riderShoeL・contact | 犬の肉球印と人の靴底印を左右へ交互に1組ずつ |
| B-L04 | 二色の砂花 | contact | 橙・青の2方向の粒子扇、低い高さで左右へ散らす |
| B-L05 | 交差する波紋 | contact | 二つの床面波紋を拡大、重なり部分だけ白くする |
| B-L06 | 連携の刻印 | contact | 2波紋を中央で結合、実連携成立時だけ連携刻印700ms |
| B-L07 | 二重の放射光 | dogPawFL・riderShoeL・contact | 二起点から交互に短い放射線を広げ、1000msで消す |
| B-L08 | 二層の冠 | dogBack・riderWaist・contact | 床リング＋人物背後の二層冠、技名には重ねない |
| B-L09 | 空中軌跡の着地回収 | dogPawFL・riderHandR・contact | 実空中二色線を着地点まで戻し二重輪へ変える |
| B-L10 | 共演の大フィナーレ | contact | 床の大きな二色二重輪＋肉球と星の合体紋章、2000ms以内 |

### H：人のみ

| ID | 正本の名称 | 起点（AnchorKey） | 固有の描画・変化 |
|---|---|---|---|
| H-F01 | ヘルメットの光点 | riderHelmet | ヘルメット頂点の青白点を300msで消す |
| H-F02 | 肩の細い縁光 | riderShoulderL・riderShoulderR | 両肩に細い縁光、犬には輪郭を出さない |
| H-F03 | 手先のきらめき | riderHandL・riderHandR | 手先を交互に光らせ、動く方向に250msの短い残光 |
| H-F04 | 上体を包む弧 | riderWaist・riderShoulderL | 胸背に身体軸へ追従する半円を描く |
| H-F05 | 体軸の青い線 | riderHead・riderWaist | 頭と腰を結ぶ回転軸の細線を短く点灯 |
| H-F06 | 腕の扇光 | riderHandL・riderHandR | 腕の外側に扇状の光、移動方向にだけ開く |
| H-F07 | 肩の残像2枚 | riderShoulderL・riderShoulderR | 肩と腕の薄い人体残像2枚を回転後方400ms |
| H-F08 | 空中の青い帯 | riderWaist・riderShoulderL | 上体の回転方向に幅のある青い帯、犬を遮蔽しない |
| H-F09 | 人体の光環 | riderHead・riderWaist | 頭肩腰を包む傾いた青白輪を複数配置 |
| H-F10 | 乗り手の極限演技 | riderHead・riderHandL・riderHandR | 頭肩手の残像＋多層光環を時間差展開、人のみ強調 |
| H-A01 | 頭の一本線 | riderHelmet | 頭が動いた直近200msの細い一本線 |
| H-A02 | 肩の二本線 | riderShoulderL・riderShoulderR | 左右肩の2本線を時間差で引いて捻りを表す |
| H-A03 | 手首の三日月 | riderHandL・riderHandR | 手首が動く方向に三日月形の曲線、逆回転で反転 |
| H-A04 | 体軸のらせん | riderWaist | 腰の周囲に回転軸に合わせた縦長らせん |
| H-A05 | 折れ曲がる矢印軌跡 | riderHandL・riderShoulderR | 回転軸が変わった時点で折れ目のある矢印線 |
| H-A06 | 人型8の字 | riderHead・riderHandL | 頭と手の二輪が成立した時だけ8の字で結ぶ |
| H-A07 | 多層の流星線 | riderHead・riderShoulderL・riderHandL・riderHandR | 頭／肩／両手から最大4本の流星線、速度で尾を変える |
| H-L01 | 靴底の点 | riderShoeL・riderShoeR・contact | 両靴底から青点2つ、300msで消す |
| H-L02 | 足元の半輪 | riderShoeL・contact | 靴底の接地から後ろへ小さい半円を広げる |
| H-L03 | 手のひらの印 | riderHandL・riderHandR・contact | 手のひらを示す細長い印を接地側面に1組 |
| H-L04 | 肩から落ちる光 | riderShoulderL・riderShoulderR・contact | 肩から青粒が着地点へ落下し集まる |
| H-L05 | 靴底の二重波紋 | riderShoeL・riderShoeR・contact | 左右靴底から楕円の二重波紋を広げる |
| H-L06 | 人型の成功印 | riderHead・riderWaist・contact | 乗り手だけの細いシルエットを背後に500ms表示 |
| H-L07 | 腕の弧が閉じる | riderHandL・riderHandR・contact | 腕の空中軌跡を閉じた床輪に変え四方へ光点を飛ばす |
| H-L08 | 青い光の扇 | riderShoulderL・riderShoulderR・contact | 人物両側から青い扇光を左右へ開く |
| H-L09 | 上体の光環が下降 | riderWaist・contact | 空中の青い輪を床へ下ろし靴底で細い円へ変える |
| H-L10 | 乗り手の大成功 | riderHead・riderHandL・riderHandR・contact | 靴底の多層青輪＋頭肩腕の残像、人のみの大成功演出 |

### D：犬のみ

| ID | 正本の名称 | 起点（AnchorKey） | 固有の描画・変化 |
|---|---|---|---|
| D-F01 | 鼻先の光 | dogNose | 鼻先に橙の点を250msだけ点灯 |
| D-F02 | 前足の縁光 | dogPawFL・dogPawFR | 回転する前足のみに細い輪郭光 |
| D-F03 | しっぽの光点 | dogTail | 尾の先に点、実回転の後方へ短い尾を引く |
| D-F04 | 耳のきらめき | dogEarL・dogEarR | 耳の外周へ2点、頭の回転に沿って減衰 |
| D-F05 | 四足の拍動 | dogPawFL・dogPawFR・dogPawBL・dogPawBR | 前足から後足へ点灯を順次移動、点滅禁止 |
| D-F06 | 胴体の帯 | dogBack・dogBelly | 背中から腹側へ橙色の細い帯を1周させる |
| D-F07 | しっぽの扇光 | dogTail | 尾の後ろに実回転方向の扇、速さで幅が増える |
| D-F08 | 肉球の残像 | dogPawFL・dogPawFR・dogPawBL・dogPawBR | 四足の肉球残像を各最大1個、順に400ms消える |
| D-F09 | 犬を包む琥珀の輪 | dogNose・dogBack・dogTail | 鼻背尾を包む傾いた琥珀色の楕円を回す |
| D-F10 | 肉球の極限舞 | dogPawFL・dogPawFR・dogPawBL・dogPawBR・dogTail | 四足と尾の残光から大きな琥珀環を組み立てる |
| D-A01 | しっぽの筆線 | dogTail | 尾が通った道筋の短い筆線を200ms残す |
| D-A02 | 前足の点線 | dogPawFL・dogPawFR | 前足が通った位置を橙の点線で順に結ぶ |
| D-A03 | 鼻先の円弧 | dogNose | 鼻先の実回転方向に細い円弧を伸ばす |
| D-A04 | 肉球のらせん | dogPawFL・dogPawFR・dogPawBL・dogPawBR | 前後足の弧をつなぎ胴体周りをらせんにする |
| D-A05 | 4本の足跡線 | dogPawFL・dogPawFR・dogPawBL・dogPawBR | 前足と後足で色味を変えた4本の独立線 |
| D-A06 | 鼻としっぽの二重輪 | dogNose・dogTail | 鼻と尾の二重楕円、回転軸で縦横の大きさを変更 |
| D-A07 | 肉球の星座 | dogPawFL・dogPawFR・dogPawBL・dogPawBR・dogNose | 四足と鼻先を結ぶ5点の星座線、着地前にほどく |
| D-L01 | 肉球の一押し | dogPawFL・contact | 肉球印を床へ1つ押し300msで消す |
| D-L02 | 4つの足元点 | dogPawFL・dogPawFR・dogPawBL・dogPawBR・contact | 四足直下へ小さな橙の点4つ |
| D-L03 | 短いしっぽの渦 | dogTail・contact | 尾側から一周の渦を描き床へ収束 |
| D-L04 | 小さな肉球の輪 | dogPawFL・contact | 小肉球印から外側へ細い床輪を広げる |
| D-L05 | 四足の波紋 | dogPawFL・dogPawFR・dogPawBL・dogPawBR・contact | 四足の真下から波紋4つを同時に広げる |
| D-L06 | 跳ねる肉球粒 | contact | 床から肉球形の光粒を少数跳ねさせ下へ落とす |
| D-L07 | しっぽの花 | dogTail・contact | 尾の弧から花びら状4線を描き足の光と区別 |
| D-L08 | 琥珀の足跡帯 | contact | 接地点から進行方向へ肉球帯を連続し後ろから1000ms以内で消す |
| D-L09 | 肉球と二重輪 | dogPawFL・contact | 大きな肉球印を中心に橙の二重輪 |
| D-L10 | 犬の大成功 | dogPawFL・dogPawFR・dogPawBL・dogPawBR・dogTail・contact | 四足の放射光＋尾の弧＋琥珀の二重輪＋肉球紋章 |

**アンカー群の明示:** 複数点は各アンカーのgetWorldPositionで別々に取得する。正本の細かなタイミング・向き・消え方は上表に加えて必ず実装する。Bの二色は犬橙・人青、Hは人青、Dは犬橙。強いストロボ・全面白化・コースを隠す演出は禁止。


