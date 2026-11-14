# イヌボー 自由操作への変更実装計画

> **実装担当へ:** [設計](freestyle-control-design.md)を先に読み、下記を工程ごとに実装する。文書を追加しただけでゲームの操作が変わったと扱わない。

**目的:** スワイプの途中から自由に姿勢を動かし、着地までの実際の履歴から技名と得点を決める。競技・自由練習・任意の38技ガイドで同じ自由操作を使う。

**構成:** 生の入力→連続した姿勢と接触→着地履歴の固定→動作量の採点→既知名の照合、の依存方向にする。技名の照合処理から入力や姿勢を変更する呼出しを作らない。

**使用環境:** 現行のTypeScript・Three.js・Vite・Vitest・Playwright・GitHub Actions／Pagesを使う。新しい物理ライブラリや有料サービスは必要条件にしない。

2026年11月14日。基準は`222ed247f84eb4b6f6150eff62974b43e06994df`。入力・採点の変更を別ルール`rules-freestyle-1`へ分け、`park-2`の地形、旧データ、旧送信待ちを保つ。各数値は[設計の初期案](freestyle-control-design.md)として実装し、調整時は値と検査例を更新する。

## 1. 上書きする旧条件

| 旧条件 | 新しい扱い |
|---|---|
| 円／直線の判定後に、固定時間の回転を開始する | 新ルールでは使わない。入力中の軌跡をそのまま姿勢へ反映する。 |
| 8方向・360°・最大2枠 | 新ルールの動作に使わない。角度・向き・回転順・操作回数を技の一覧で制限しない。 |
| `LabSetup`の回転目標を達成して成功する | 回転の指定欄をなくし、実際の姿勢と着地を先に評価する。 |
| 38技と一致しない試行を失敗にする | 自由練習では成立として採点する。見本との一致は別の目標判定とする。 |
| `rules-1`と同じ9走の得点を新ゲームにも要求する | 旧処理・旧保存値の保全確認に限定する。自由操作版には新しい基準入力と期待値を用意する。 |
| 定型回転の残り角で着地失敗を決める | 新ルールは接触・姿勢で決める。半回転・未知の組合せだけを理由に失敗にしない。 |

## 2. 先に確かめる条件

| 反例 | 合格条件 | 担当 |
|---|---|---|
| 指を離すまで動かない | pointermoveの途中から姿勢が変わる。 | G01・G02 |
| 見本を別の技へ替えると同じ入力が別の動きになる | 目標IDを計算入力に使わず、姿勢・着地・点が同じ。 | G03・G05 |
| 0°・360°・720°を同じ状態として採点する | 四元数とは別の回転履歴で区別する。 | G02・G04 |
| 指の取消・画面回転後も回転入力が残る | 入力世代と指IDを閉じ、新しい操作だけを受ける。 | G01・G06 |
| 新点を旧順位へ送る／古い再送を新ルールに変更する | 版を固定し、旧データを改変せず新旧を別に扱う。 | G00・G07 |

## 3. G00 — 新旧の契約と基準を固定する

**変更:** `src/game/types.ts`、`src/game/rules.ts`、`src/app-options.ts`、`src/storage/records.ts`、既存の後続計画F00・F07。**作成:** `tests/freestyle-contract.test.ts`、`tests/fixtures/freestyle-baseline.json`。

**入出力:** `MovementRules = 'rules-1' | 'rules-freestyle-1'`を識別し、走行開始時のルールを最後まで固定する。新しい通常プレイと練習は自由操作。旧処理は旧記録の読込・旧再送・旧方式の比較に必要な範囲で残し、URL引数で新旧の配点を混ぜない。

- [ ] 旧`park-1/park-2, rules-1`の生の保存文字列と送信待ちを使い、読込前後で内容が変わらない試験を作る。識別値・プロフィール・設定の再生成をしない。
- [ ] `FreeInput`、`FreePoseState`、`AppliedRotation`、`LandingSnapshot`、`FreeScore`、`LessonCheck`の型を分ける。計算入力に`lessonId`・`trickId`・`targetDegrees`を必須項目として含めない。
- [ ] `npm test -- tests/freestyle-contract.test.ts tests/records.test.ts tests/ranking.test.ts`と型検査を通し、契約と旧データの基準をコミットする。

## 4. G01 — 生の軌跡を空中入力へ送る

**作成:** `src/input/free-pointer.ts`、`tests/free-pointer.test.ts`。**変更:** `src/input/gestures.ts`、`src/game/types.ts`、`src/ui/screens.ts`、`src/ui/trick-lab.ts`。

**入出力:** `FreePointerController`が`down/move/up/cancel`から`FreeInput`を作る。入力は`{jumpId, pointerId, seq, sourceAtUs, effectiveAtUs, target, phase, point, controlFrameId}`。`target`は犬・人・一緒、`point`は操作面に対する正規化座標。`controlFrame`と操作面寸法は踏切時に固定し、画面回転時には停止して指を取り直す。

- [ ] 未完の円、曲線、短い線、行き戻り、斜めの入力を先に試験にし、moveごとに記録されることを確認する。円完成・指離し・最小技サイズを空中動作の開始条件にしない。
- [ ] `getCoalescedEvents`が利用できる場合は中間点を採取し、使えない場合は通常のmoveを使う。順序は有効時刻→seqで固定し、重複点を1回だけ処理する。描画フレームごとに最後の点だけへ間引かない。
- [ ] 既に処理した時間より古い点は`effectiveAtUs`を未処理の最初の境界へそろえ、元の時刻も記録する。過去を黙って巻き戻さず、再生は保存した有効時刻を使う。未来の点で既に描いた姿勢を補正しない。
- [ ] 踏切の指の使い切り、指ごとの対象保持、対象の所有権、取消後にpointerupが来ない場合を試す。自由操作版の空中入力が旧`Candidate`・`makeRotation`へ流れないことを接続試験で確認する。
- [ ] `npm test -- tests/free-pointer.test.ts tests/gestures.test.ts`を通してコミットする。旧地上移動・踏切の認識は壊さない。

## 5. G02 — 入力中に姿勢を連続して動かす

**作成:** `src/game/free-rotation.ts`、`src/game/free-motion.ts`、`tests/free-rotation.test.ts`、`tests/free-motion.test.ts`。**変更:** `src/game/math.ts`、`src/game/run.ts`、`src/game/trick-lab.ts`、`src/view/scene.ts`、`src/view/trick-lab.ts`、後続F01の共通姿勢。

**入出力:** `projectControlPoint(point, surface): Vec3`、`rotationSpanFromPath(input): RotationSpan[]`、`applyFreeInput(state, input): AppliedRotation[]`、`sampleFreePose(state, atUs): FreePose`を定義する。`FreePose`は犬と人の世界姿勢と手足・支持点を持つ。`AppliedRotation`は`{jumpId, atUs, targetBody, axisInTakeoffFrame, signedAngleRad, actualFrom, actualTo}`とし、要求値ではなく実際に適用した小区間を記録する。

- [ ] 半端な17°、225°、途中の逆向き、360°・720°、指を置き直した続きが入力中から見える試験を作る。上限2枠、方向丸め、周回の自動完了、指離し後の固定アニメーションを使わない。
- [ ] 設計の球への投影と最大15°の区間分割を実装する。向きを`normalize(deltaWorld × currentWorld)`で更新する。反対点をまたぐ区間は中間の投影点で分け、途中経路のない180°軸を推測しない。無変位・ゼロ長ベクトル・同時刻の点で非数を作らない。
- [ ] 犬だけ／人だけ／一緒の回転を同じ計算へ通し、描画の親子関係による二重回転を防ぐ。持ち手が届かなくなった解除と接触を履歴へ残す。保持の見た目だけを続けない。
- [ ] 同じ有効時刻付き入力を8・16・33ミリ秒の描画間隔へ再生し、姿勢・適用履歴・結果を一致させる。元の区間へ同一直線上の中間点を足した場合も角度誤差0.5°以内にする。実際に失われた曲線を復元できるとは主張しない。
- [ ] `npm test -- tests/free-rotation.test.ts tests/free-motion.test.ts`、型検査、代表姿勢の表示を確認してコミットする。

## 6. G03 — 接地で履歴を閉じ、任意の動きで着地する

**作成:** `src/game/free-landing.ts`、`tests/free-landing.test.ts`。**変更:** `src/game/scoring.ts`、`src/game/run.ts`、`src/game/trick-lab.ts`、F02の姿勢・接触処理。

**入出力:** `freezeLanding(state, contact): LandingSnapshot`が`jumpId`・`cutoffUs`・実際の姿勢・適用履歴・支持面・手足の接触を固定する。`validateFreeLanding(snapshot, contacts): LandingValidation`は`pending/stable/crash`を返す。確定済みのsnapshotを後の入力で書き換えない。

- [ ] 接地直前／同時／直後1マイクロ秒の入力を試し、cutoffより前の分だけを採点元に含める。同じ着地の重複通知で2回加点しない。失敗と接地が同時なら失敗にする。
- [ ] 犬と人が225°同じ向きで着地する等、既知の技名に一致しない安全な着地を通す。上方向・支持・手足の条件は使い、定型回転の残り角を着地倍率へ入れない。水平の向きを0°・180°に吸着させない。
- [ ] 接触40ミリ秒、安定150ミリ秒・0.2mを検査し、確認中の予定値と確定値を分ける。確認中の回転・手の操作を閉じた空中技へ加えない。ゴール直前・レール・途中退出も別に試す。
- [ ] `npm test -- tests/free-landing.test.ts tests/scoring.test.ts tests/rails.test.ts`を通してコミットする。

## 7. G04 — 動作を採点し、その後で名前を付ける

**作成:** `src/game/free-analysis.ts`、`src/game/free-score.ts`、`src/content/trick-signatures.ts`、`tests/free-analysis.test.ts`、`tests/free-score.test.ts`。**変更:** `src/game/scoring.ts`、`src/game/types.ts`、`src/ui/results.ts`、`src/view/effects.ts`。

**入出力:** `summarizeFreeMotion(snapshot): MotionSummary`、`scoreFreeMotion(summary, landing): FreeScore`、`identifyKnownTricks(summary, contacts, signatures): TrickMatch[]`。`MotionSummary`に犬・人×3軸の符号付き積算・最小・最大・有効角度、保持時間を持つ。`FreeScore`は回転・保持・着地倍率・小計・実際に採用した点を持つ。名前照合は読み取り専用で、点の引数にしない。

- [ ] 360°と720°、往復、未登録の225°同士の組合せ、45°未満、45°・15°刻みの境界を設計の式で試す。名前辞典を空にしても得点が変わらないことを確認する。
- [ ] 任意の既知名を後から足したり消したりしても、姿勢・成立・得点が変わらないことを試す。複数の名前が付いても同じ回転・同じ保持へ名前の数だけ加点しない。
- [ ] 犬360°100点、720°200点、犬＋人225°156点を倍率前の基準にし、倍率後の切捨て、グラブ120ミリ秒50点1回、失敗0点、総合上限を確認する。未知の動きの表示は翻訳キーと実測の値で組み立てる。
- [ ] `npm test -- tests/free-analysis.test.ts tests/free-score.test.ts tests/scoring.test.ts`を通してコミットする。

## 8. G05 — 競技と練習を同じ自由操作へ接続する

**変更:** `src/ui/screens.ts`、`src/ui/trick-lab.ts`、`src/ui/practice.ts`、`src/content/trick-lab.ts`、`src/game/trick-lab.ts`、既存38技の画面試験。**作成:** `tests/freestyle-flow.spec.ts`、`tests/freestyle-lessons.spec.ts`。

- [ ] 最初に競技と自由練習の両方で、同じ短い入力列から同じ姿勢・同じ着地分析を得る一巡を作る。競技だけ旧入力へ戻る実装を合格にしない。練習の点はその場に表示し、個人記録・ランキングへ送らない。
- [ ] 回転目標・角度・自動脱出の準備欄を除き、対象の切替、半速／通常、つかむ等を残す。自由練習は見本の選択なしで始められる。既知の技を選ぶとその見本だけが変わり、プレイヤーの動作は変わらない。
- [ ] `LessonCheck={targetLessonId, matched, missingConditions}`を実際の結果に対して返す。別の技や未知の動きで安全に着いた場合も、失敗表示にせず、着地成功と目標未達を分ける。
- [ ] 手本は新しい生入力ログを同じエンジンへ送り、`setup`で完成角や成功を注入しない。最初は01／16／28／34と、未定義の自由入力を確認する。38技は操作で到達できる参考例として追加し、一覧が操作可能範囲の上限にならないようにする。
- [ ] 後続F03・F05の38技・88組は、新しい自由入力で通す検査に置き換える。126試行の分割・試行ID・実入力経路・旧成功表示の使い回し禁止は引き継ぐ。元の練習5番も、新しい自由操作を教える内容と入力へ作り直し、旧一筆の判定器を必須にしない。
- [ ] `npm run test:e2e -- tests/freestyle-flow.spec.ts tests/freestyle-lessons.spec.ts tests/practice-demo.spec.ts`を通してコミットする。

## 9. G06 — 途中操作・再生・15言語をつなぐ

**変更:** `src/view/replay.ts`、`src/view/scene.ts`、`src/view/trick-lab.ts`、`src/ui/share.ts`、F04の中断処理、F06の翻訳。**作成:** `tests/free-replay.test.ts`、`tests/freestyle-input.spec.ts`。

- [ ] 新リプレイへ`motionVersion: 'freestyle-1'`、実際の犬と人の姿勢、適用入力の版情報を追加する。旧形式のフレームはそのまま読めるようにし、旧記録を新エンジンへ再入力して作り直さない。
- [ ] 取消・捕捉解除・アプリ切替・画面回転・再試行で指の所有権と保留入力を閉じ、止まった試行へ遅れた回転が入らないことを確認する。元の後続F04の再開条件を使う。
- [ ] 「一緒／犬／人」「着地確認中」「フリースタイル」「着地成功・別の動き」と実測角度・得点内訳を15言語へ加える。画面とX共有は今回の確定値を使い、未知の技の日本語を固定で埋め込まない。
- [ ] 縦402×700・横700×402、音オフ、演出弱で、入力面・対象切替・操作ボタン・着地点が重ならないことを確認する。
- [ ] `npm test -- tests/free-replay.test.ts tests/records.test.ts tests/i18n.test.ts`と`npm run test:e2e -- tests/freestyle-input.spec.ts tests/i18n.spec.ts`を通してコミットする。

## 10. G07 — 新ルールの記録と受付を別に用意する

**変更:** `src/game/rules.ts`、`src/ranking/client.ts`、`src/ranking/production.ts`、`src/storage/records.ts`、順位画面。**作成:** `supabase/migrations/20261114_inubo_freestyle_rules.sql`、`tests/freestyle-ranking.test.ts`。

- [ ] 既存の`inubo_ranking_private.versions`に`park/park-2/rules-freestyle-1`を追加する。既存ルールの行・成績は変更しない。初期の満点・0点基準と得点上限は設計に合わせる。適用順は隔離環境で検証→受付追加→本番ビルド切替とする。
- [ ] 送信待ちに保存された元のルール・氏名・ID・点を維持する。新規プレイのルール変更で古い送信待ちの値を変換しない。表示中の新旧順位も問い合わせるルールを固定する。
- [ ] 新ルールが未受付の場合は新規送信を保留し、旧ルールとして送り直さない。試験は本番へ試験値を送らず、模擬通信と隔離したデータベースで行う。初期のサーバー検査は版・開始・範囲・合計の検算であり、ブラウザだけの履歴から不正を完全に防げるとは扱わない。
- [ ] `npm test -- tests/freestyle-ranking.test.ts tests/ranking.test.ts tests/ranking-production.test.ts tests/records.test.ts`を通してコミットする。データベース適用・通常配信は計画書の作成だけでは実行しない。

## 11. G08 — 自由操作そのものを実機で評価する

後続F08の固定した成果物・隔離した保存領域・本番送信0件の確認版を使う。最初の代表的な一巡はG01〜G05の時点で確認できるようにし、38技を全実装した後に初めて操作感を見る順にはしない。

- [ ] iPhone 17 Pro Safariで、指を離す前に動く、小さく止める、逆へ戻す、別方向へ続ける、指を置き直す、2枠以上の操作をする、未知の形のまま着く、を縦横で試す。基準の動画・入力ログ・姿勢・着地結果を保存する。
- [ ] 同じ自由入力を別の見本選択で試して姿勢と点が変わらないこと、名前が付かなくても成立することを確認する。手本を上手になぞれたことだけを受入にしない。
- [ ] 入力が姿勢へ反映された時刻と表示フレームを記録し、次の表示更新までに反応することを確認する。コマ落ち時の待ちや動きの飛び、同じ入力ログの8／16／33ミリ秒再生の結果差を調べる。
- [ ] 代表一巡が合格後、38技・88組・15言語・旧記録保全・新順位分離の検査をそろえる。全体の型検査・計算試験・ビルド・画面試験は候補版で1回通し、iPhoneの対象コミット・ルール版・結果を残す。

ゲームの実装完了、コードの自動試験合格、実機の合格は別々に記録する。今回の文書PRではこれらを完了へ更新しない。計画の敵対的検証と修正は[自由操作計画の検証記録](freestyle-adversarial-review.md)へ残す。
