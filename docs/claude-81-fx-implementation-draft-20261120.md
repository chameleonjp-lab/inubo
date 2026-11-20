# イヌボー｜Claude向け81種類の空中・着地演出 実装計画（初版）
作成日：2026-11-20／対象：chameleonjp-lab/inubo／基準main：32f35ab11b6d5ebdfd335e991882e5c49c444483

> 本書は敵対的検証前の初版。実装時は後続の「final」文書を参照すること。

## 0. 目的と完成条件
- 正本は docs/2026-11-20-81-trick-visual-spec.md。81件＝3対象×（派手さF10＋空中軌跡A7＋着地L10）。10×7×10の掛け算ではない。
- 両方B、人のみH、犬のみDの各27件を、名称だけでなく、実画面に明確に異なる動きとして実装する。Fは空中強調、Aは実回転に追従する線、Lは着地1回に伴う演出。 FとAは同時適用、Lは接地時。
- 既存の回転操作の即時切替／慣性／採点／150技名／切替ボーナス／自己ベスト／ランキング／30段階の総合結果／60称号は変更しない。
- スマホ Safari 縦402×700、横700×402を優先。光の弱い設定、動作低減設定、消音／停止／再開に対応する。
- このPRは仕様・計画書だけ。Claudeによる実装コードは別PRで提案し、mainへ直接pushしない。

## 1. 最新コードの確定事実
- PR #27 は main へマージ済み。ホーム不要5項目は既に削除。今回戻さない。
- src/view/trick-fx.ts に旧 TRICK_FX_100、chooseTrickFx、trickFxTier が残る。
- src/view/scene.ts の GameView.frame() は約90msごとに scoreFreeMotion() を呼び、5種類の位置に粒子を出す。着地は sparks/rings/paws/stars。
- src/view/free-scene.ts の FreeScene.draw(pose,fx) は操作確認版の球モデルを描く。
- src/view/models.ts の Rig は現在 nose、paw（犬の中心の点）、shoulder は持つが四足個別・手首・靴底の測定用目印を持たない。
- src/view/effects.ts の cueForEvent('land') は trickTier（既存5段階）と trickPoints／trickBase／switchBonus／switchCount を受け、CenterText に文字情報を渡す。
- src/ui/trick-landing.ts/.css は旧5段階・5軌跡・4着地の組み合わせをDOMに表示する。TRICK_LANDINGは効果音5種類の配列。
- src/game/free-score.ts は実際の回転履歴をscoreFreeMotion()で採点する。src/game/run.ts→src/game/scoring.tsで1ジャンプ1着地の出来事を確定する。
- src/view/replay.ts の保存済み再生は位置・姿勢のframe値が中心で、81演出に必要な種別／段階は保持されていない。

## 2. データ設計（純粋関数と描画の分離）
- src/view/trick-fx-81.ts を新設し、81件のIDごとに target(B/H/D)、kind(F/A/L)、level、name、anchor、recipe、timing、parametersを宣言する。IDはB-F01…B-F10、B-A01…B-A07、B-L01…B-L10、H・Dも同じ規則。無関係な100種の積は削除。
- src/view/trick-fx.ts を81専用の選択APIに置き換える。選択ロジックはDOM、Three.js、時刻、乱数に依存させない。
- 選択する派手さFは閾値［1,80,160,260,400,550,700,950,1250,1650］、軌跡Aは［1,160,400,700,950,1250,1650］、着地LはFと同じ10段階。境界は以上（>=）、0点の扱いは別ルール。途中のF/Aはジャンプ内で段階下降させない。
- 空中の対象は、そのスワイプが実際に動かした部位で判定。着地は有効回転が犬と人の両方にあればB、犬のみD、人のみH。最後に押した選択ボタンだけで決めない。
- 開始／空中／着地／終了の状態を jumpId と runId で管理し、同一ジャンプのLを二重発火させない。
- 見た目のデータ（FxVisualState）は採点状態に書き戻さず、音・衝突・スコア算出にも影響を与えない。

## 3. 3Dモデルの計測点
- src/view/models.tsのRigに4足先、鼻、両耳、しっぽ先、頭、両肩、左右手先、腰、左右靴底の目印（Object3D）を追加する。描画専用であり物理衝突形状は変更しない。
- 犬種3種類の体格に合わせた親子座標を使い、getWorldPosition()を呼ぶ前にupdateMatrixWorld(true)する。
- src/game/free-geometry.ts のfreePartsが返すdog-nose、dog-ear-*, dog-tail、paw-0…3、head、helmet、arm-*-2、shoe-*を操作確認版の代替計測点として対応付ける。
- 見た目のマーカーを増やしても犬や人の形状・高さ・ライディングモーションは変更しない。

## 4. 描画の実装
- src/view/scene.tsで視覚専用の実行器を呼ぶ。Fは色と輪・残像・光帯、Aは実際の位置をサンプルした線、Lは床の接触位置から発生する波紋・肉球・粒・文字を描く。
- F／A／Lの81件すべてに独立したrecipeとparamを割り当て、同じ見た目の色違いだけで済ませない。動作と消え方は正本の各行を採用。
- 同じジャンプで異なる対象に切替した際は旧軌跡を0.2～0.4秒で消し、次の回転から新対象の線に変更する。Bは犬橙＋人青、Hは人青、Dは犬橙。
- 既存Particles上限600、着地追加72、空中更新目安90msを超えない。生成する材質・幾何形状は再利用し、1フレームごとのnewを増やさない。
- src/view/free-scene.tsも共通81選択関数を使い、球モデルの各パーツ座標からF/Aを描く。見た目は簡略化しても、対象・段階・IDの一致は必須。

## 5. 着地時の情報・文字・音
- src/view/effects.ts／src/view/trick-landing.ts／src/ui/trick-landing.ts／.css を81選択関数につなぐ。元の技名、別行の連携ボーナス、満点の条件、区間採点済みは維持する。
- 着地イベントから正しいB/H/DとL01…L10を確定し、同じ jumpId に1回だけエフェクトを発火する。結果画面の30段階・60称号は変更しない。
- src/audio/sound.tsは既存の音量・消音・一時停止・同時発音の考え方を維持し、着地10段階の音の違いを実装する。多数の追加音源ファイルは使わない。

## 6. 対象ファイル
| 役割 | 主なファイル |
|---|---|
| 81件定義・選択 | src/view/trick-fx-81.ts（新規）、src/view/trick-fx.ts |
| 立体描画 | src/view/models.ts、src/view/scene.ts、src/view/free-scene.ts、src/game/free-geometry.ts（確認のみ） |
| 着地と文字 | src/view/effects.ts、src/view/trick-landing.ts、src/ui/trick-landing.ts、src/ui/trick-landing.css、src/ui/free-review.ts |
| 必要なイベント情報 | src/game/run.ts、src/game/scoring.ts、src/game/tricks.ts（追加の読取情報だけ） |
| 音 | src/audio/sound.ts |
| 検証 | tests/trick-fx.test.ts、tests/trick-visual-spec.test.ts、tests/effects.test.ts、tests/course-freestyle.spec.ts、tests/free-review.spec.ts、tests/ui.spec.ts |

## 7. 実装順
1. 旧100方式の使用箇所を調べ、81件の型と選択関数を先に導入。
2. 実際の部位を測る計測点を増設し、B/H/Dの空中切替で誤った対象に軌跡が残らないことを確認。
3. F10・A7を3対象すべての実描画へ実装。画面の描画がゲーム判定に干渉しないことを試験。
4. L10を3対象すべての着地に適用し、技名／切替点／音を対応させる。
5. 操作確認版を同期し、旧100方式の描画と旧テストを81方式へ差し替える。
6. 81件の一覧証跡、縦横画面確認、描画負荷、回帰テストを完了し、Claude実装PRとして提出。マージと公開はユーザー側で行う。

## 8. 受入テスト
- 各B/H/DでF10・A7・L10のIDが実装レジストリに全81件存在し、別の形・動き・消え方が登録される。
- 各段階の境界値の前後でF/A/L選択が合う。スコアの算出とランキング送信内容は差分なし。
- 犬のみで人の回転用軌跡が出ず、人のみで犬の回転用軌跡が出ない。両方は2本の独立軌跡が見える。
- 区間が採点済みでもLのレベルが技の難しさで決まり、点数には区間採点済みと表示する。
- 連続ジャンプ・着地・衝突・一時停止・画面回転で同じエフェクトを再発火させない。
- iPhone想定402×700、700×402の縦横で文字・操作ボタン・犬と人・障害物を隠さない。
- TypeScript検査、単体テスト、ブラウザテスト、操作確認版テストが成功する。

## 9. 実装範囲の制限
- 現行コースの地形、アイテム、スコア算出・判定閾値、ルールバージョン、公開ランキング、Supabase、記録・再生の保存キー、ホーム入口は変更しない。
- 元の81件仕様から独断で描写案を削除・統合しない。実機の処理負荷への対策は画質・密度を下げる方向で検討し、動きの意味を変えない。
