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
- [ ] `MotionEpoch`、`FreeInput`、`FreePoseState`、`AppliedRotation`、`SupportSegment`、`LandingSnapshot`、`FreeScore`、`LessonCheck`の型を分ける。`MotionEpoch`は`{id, kind: 'air' | 'support', jumpId: number | null, controlFrame, startedUs}`を持つ。計算入力に`lessonId`・`trickId`・`targetDegrees`を必須項目として含めない。
- [ ] `npm test -- tests/freestyle-contract.test.ts tests/records.test.ts tests/ranking.test.ts`と型検査を通し、契約と旧データの基準をコミットする。

## 4. G01 — 生の軌跡を空中入力へ送る

**作成:** `src/input/free-pointer.ts`、`tests/free-pointer.test.ts`。**変更:** `src/input/gestures.ts`、`src/game/types.ts`、`src/ui/screens.ts`、`src/ui/trick-lab.ts`。

**入出力:** `FreePointerController`が`down/move/up/cancel`から`FreeInput`を作る。入力は`{epochId, pointerId, seq, sourceAtUs, effectiveAtUs, target, phase, point, controlFrameId}`。`target`は犬・人・一緒、`point`は操作面に対する正規化座標。`controlFrame`は空中では踏切時、支持中では支持区間へ入った時に固定する。操作面寸法は区間開始時に固定し、画面回転時には停止して指を取り直す。空中とレール・曲面上は姿勢操作を受け、通常の地上には「移動／姿勢」のタップ切替を置く。移動中の地上スワイプと姿勢操作を同じ入力として二重適用しない。

- [ ] 未完の円、曲線、短い線、行き戻り、斜めの入力を先に試験にし、moveごとに記録されることを確認する。円完成・指離し・最小技サイズを空中動作の開始条件にしない。
- [ ] `getCoalescedEvents`が利用できる場合は中間点を採取し、使えない場合は通常のmoveを使う。順序は有効時刻→seqで固定し、重複点を1回だけ処理する。描画フレームごとに最後の点だけへ間引かない。
- [ ] 既に処理した時間より古い点は`effectiveAtUs`を未処理の最初の境界へそろえ、元の時刻も記録する。過去を黙って巻き戻さず、再生は保存した有効時刻を使う。未来の点で既に描いた姿勢を補正しない。
- [ ] 踏切の指の使い切り、指ごとの対象保持、対象の所有権、取消後にpointerupが来ない場合を試す。自由操作版の空中入力が旧`Candidate`・`makeRotation`へ流れないことを接続試験で確認する。
- [ ] 支持中の技29で、空中へ移る前から生のmoveを受けて回転できることを確認する。支持解除で次の区間へ移ったら旧区間の指を閉じる。抜ける操作に半回転の角度を埋め込まない。
- [ ] `npm test -- tests/free-pointer.test.ts tests/gestures.test.ts`を通してコミットする。旧地上移動・踏切の認識は壊さない。

## 5. G02 — 入力中に姿勢を連続して動かす

**作成:** `src/game/free-rotation.ts`、`src/game/free-motion.ts`、`src/game/free-contact-adapter.ts`、`tests/free-rotation.test.ts`、`tests/free-motion.test.ts`、`tests/free-contact-adapter.test.ts`。**変更:** `src/game/math.ts`、`src/game/run.ts`、`src/game/trick-lab.ts`、`src/game/contacts.ts`、`src/view/scene.ts`、`src/view/trick-lab.ts`、後続F01・F02の共通姿勢・接触。

**入出力:** `projectControlPoint(point, surface): Vec3`、`rotationSpanFromPath(input): RotationSpan[]`、`applyFreeInput(state, input): AppliedRotation[]`、`sampleFreePose(state, atUs): FreePose`を定義する。`FreePose`は移動基準点、犬の胴体中心と人の腰の世界位置・世界姿勢、手足・支持点を持つ。回転支点は設計第3章に従う。`AppliedRotation`は`{epochId, startUs, endUs, inputSeq, pathRange, targetBody, pivotWorld, signedAngleRad, actualFrom, actualTo}`とし、要求値ではなく実際に適用した経路を記録する。

指の入力では`startUs=endUs=effectiveAtUs`とし、その時刻の空間経路を`poseAtProgress(p)`・`boundsAlongProgress(p0,p1)`で調べる。`p`は0〜1で、最大15°の小区間と各区間内の順序を持つ。F02へ時間差0を割り算させず、`sweepFreeControlPath(provider, path)`で最初の新しい衝突または空中からの荷重支持開始まで進める。既存の合法な支持・足置き・保持の継続は、それだけで経路を止めず接触状態を更新する。自然な移動では`startUs<endUs`の`poseAtTime`を使う。両者とも同じ部位・面の衝突計算を使い、接触結果に`{atUs,inputSeq,pathProgress}`を残す。

### 競技と練習の接続

F01の練習用モデルとF02の練習地形だけでは競技に使えないため、この工程で共通化する。`FreeSurfaceProvider`を`getFaces(bounds, fromUs, toUs)`・`sampleSupport(worldPoint, atUs)`を持つ契約にし、面ID・障害物ID・法線・接線・連続面IDを返す。`createCourseSurfaceProvider(course: CourseRt)`は曲がった道・坂・壁・階段・レール・動くゲートを、`createPracticeSurfaceProvider(fixture)`は練習地形を同じ契約へ変換する。部位の位置・向き・法線・回転軸の世界座標への変換を一か所で行い、競技の道を平面と仮定しない。

新ルールにはF01の共通寸法・到達判定を競技でも使う。旧ルールの再生だけは旧モデルを使い、旧F01の「競技の寸法を変えない」は旧版の保全条件に限定する。現在の足元中心だけの接触を、自由回転中の全身の接触の代わりにしない。進行時計・道の距離・ゴールの基準点は既存の移動基準へ固定する。

- [ ] 半端な17°、225°、途中の逆向き、360°・720°、指を置き直した続きが入力中から見える試験を作る。上限2枠、方向丸め、周回の自動完了、指離し後の固定アニメーションを使わない。
- [ ] 設計の球への投影と最大15°の区間分割を実装する。向きを`normalize(deltaWorld × currentWorld)`で更新する。反対点をまたぐ区間は中間の投影点で分け、途中経路のない180°軸を推測しない。無変位・ゼロ長ベクトル・同時刻の点で非数を作らない。
- [ ] 犬だけ／人だけ／一緒の回転を同じ計算へ通し、描画の親子関係による二重回転を防ぐ。持ち手が届かなくなった解除と接触を履歴へ残す。保持の見た目だけを続けない。
- [ ] 「一緒」の前宙180°で犬と人の中心が共通支点の反対側を通り、表示と衝突位置が一致することを試す。犬だけ・人だけの中心、支持中の支点、足が届かないcatchも検査する。空中で指を離し、入力0のまま200ミリ秒進めても、世界姿勢が自動で地面へ整列しないことを確かめる。
- [ ] 遅れた複数点を同じeffectiveAtUsへ適用し、途中だけレールに触れる例を試す。最初の接触より後の経路を適用せず、時間差0では保持時間を増やさない。競技と練習の同じ形の面で同じ結果になること、曲面・ゲートでも法線と接触順が正しいことを確認する。
- [ ] 技29の既存支持を保ったまま5°回す例を通し、開始点の既存接触で操作が止まらないことを確かめる。同じ面でも支持に使わない胴体が新しく当たる場合は衝突とし、既存支持だからと見逃さない。
- [ ] 同じ有効時刻付き入力を8・16・33ミリ秒の描画間隔へ再生し、姿勢・適用履歴・結果を一致させる。元の区間へ同一直線上の中間点を足した場合も角度誤差0.5°以内にする。実際に失われた曲線を復元できるとは主張しない。
- [ ] `npm test -- tests/free-rotation.test.ts tests/free-motion.test.ts tests/free-contact-adapter.test.ts`、型検査、代表姿勢の表示を確認してコミットする。

## 6. G03 — 接地で履歴を閉じ、任意の動きで着地する

**作成:** `src/game/free-landing.ts`、`tests/free-landing.test.ts`。**変更:** `src/game/scoring.ts`、`src/game/run.ts`、`src/game/trick-lab.ts`、F02の姿勢・接触処理。

**入出力:** `freezeLanding(state, contact): LandingSnapshot`が`jumpId`・`cutoff={atUs,inputSeq,pathProgress}`・実際の姿勢・適用履歴・支持面・手足の接触・`pathId/sectionKey/opp`を固定する。自然な接地は同時刻の入力より前、入力自身が接地を起こした場合はその経路の途中までを含める。`validateFreeLanding(snapshot, contacts): LandingValidation`は`pending/stable/crash`を返す。保留状態はjumpId単位で持ち、後の入力でsnapshotを書き換えない。

支持の履歴は`SupportSegment={epochId,kind,startedUs,endedUs,obstacleId,surfaceId,supportParts,rotationTimeline,contactTimeline,durationUs,distanceMm}`として別に保持する。荷重・支点・支持面が変わる時に区切り、空中→支持→空中の関連IDを残す。地上で始まる05・06・25や、支持が残る間に回す29を空中のjumpIdなしで照合できるようにする。

- [ ] 接地直前／同時／直後1マイクロ秒の入力を試し、cutoffより前の分だけを採点元に含める。同じ着地の重複通知で2回加点しない。失敗と接地が同時なら失敗にする。
- [ ] 犬と人が225°同じ向きで着地する等、既知の技名に一致しない安全な着地を通す。上方向・支持・手足の条件は使い、定型回転の残り角を着地倍率へ入れない。水平の向きを0°・180°に吸着させない。
- [ ] 接触40ミリ秒、安定150ミリ秒・0.2mを検査し、確認中の予定値と確定値を分ける。確認中の回転・手の操作を閉じた空中技へ加えない。ゴール直前・レール・途中退出も別に試す。
- [ ] 採点先はcutoff位置へ固定し、確認中の区間退出はその採点機会だけ保留する。安定条件より前の再ジャンプは直前の保留を0点で閉じてから開始し、次の操作を禁止しない。安定成立→区間退出→ゴール→入力の同時刻順を試す。確認中に次区間へ入る例、早い再ジャンプ、安定とゴールが同時の例、目標名のない0点着地を別に検査する。
- [ ] `npm test -- tests/free-landing.test.ts tests/scoring.test.ts tests/rails.test.ts`を通してコミットする。

## 7. G04 — 動作を採点し、その後で名前を付ける

**作成:** `src/game/free-analysis.ts`、`src/game/free-score.ts`、`src/content/trick-signatures.ts`、`tests/free-analysis.test.ts`、`tests/free-score.test.ts`。**変更:** `src/game/scoring.ts`、`src/game/types.ts`、`src/ui/results.ts`、`src/view/effects.ts`。

**入出力:** `summarizeFreeMotion(snapshot, supportSegments): MotionSummary`、`scoreFreeMotion(summary, landing): FreeScore`、`identifyKnownTricks(summary, timeline, signatures): TrickMatch[]`。`MotionSummary`には対象ごとの基準姿勢・45°到達回数・有効回転C、保持時間を持つ。命名へ渡す`timeline`には読み取り専用の回転・接触・支持の時刻順を残し、技29・31の前後関係も照合する。`FreeScore`は回転・保持・着地倍率・小計・採点対象か・実際に採用した点を持つ。名前照合は点の引数にしない。

- [ ] 設計第6章の姿勢間の角距離と45°の基準更新を使う。区間途中で45°へ達して戻る例、44.999°／45.000°／45.001°、余りを次入力へ持ち越す例を先に試す。最終四元数だけを渡した360°を、履歴付きの1回転と同じにしない。
- [ ] 軸(1,0,0)・(1,1,0)・(1,1,1)・(1,0.01,0)の各360°が100点、720°が200点、360°→逆360°は実動作2回転の200点になることを確認する。X15°→Y15°→合成の正確な逆回転の184反復は0点。Y150°の後にX5°→Y5°→正確な逆回転を200反復して戻す例も、反復なしと同じ点にする。大きな往復も運動として数えるという仕様を維持し、反復不正の完全防止を保証しない。
- [ ] 任意の既知名を後から足したり消したりしても、姿勢・成立・得点が変わらないことを試す。複数の名前が付いても同じ回転・同じ保持へ名前の数だけ加点しない。
- [ ] 犬360°100点、720°200点、犬＋人225°156点を倍率前の基準にし、倍率後の切捨て、グラブ120ミリ秒50点1回、失敗0点、総合上限を確認する。未知の動きの表示は翻訳キーと実測の値で組み立てる。
- [ ] 無操作や小さな動きの0点着地は採点機会を消費せず、連続数も増やさない。0点着地の後に同区間で点のある技を成功させる例と、0点の3着地だけでは連続100点が付かない例を確認する。
- [ ] `npm test -- tests/free-analysis.test.ts tests/free-score.test.ts tests/scoring.test.ts`を通してコミットする。

## 8. G05 — 競技と練習を同じ自由操作へ接続する

**変更:** `src/ui/screens.ts`、`src/ui/trick-lab.ts`、`src/ui/practice.ts`、`src/content/trick-lab.ts`、`src/game/trick-lab.ts`、既存38技の画面試験。**作成:** `tests/freestyle-flow.spec.ts`、`tests/freestyle-lessons.spec.ts`。

- [ ] 最初に競技と自由練習の両方で、同じ短い入力列から同じ姿勢・同じ着地分析を得る一巡を作る。競技だけ旧入力へ戻る実装を合格にしない。練習の点はその場に表示し、個人記録・ランキングへ送らない。
- [ ] 回転目標・角度・自動脱出の準備欄を除き、対象の切替、半速／通常、つかむ等を残す。自由練習は見本の選択なしで始められる。既知の技を選ぶとその見本だけが変わり、プレイヤーの動作は変わらない。
- [ ] `LessonCheck={targetLessonId, matched, missingConditions}`を実際の結果に対して返す。別の技や未知の動きで安全に着いた場合も、失敗表示にせず、着地成功と目標未達を分ける。
- [ ] 手本は新しい生入力ログを同じエンジンへ送り、`setup`で完成角や成功を注入しない。最初は01／16／28／34と、未定義の自由入力を確認する。38技は操作で到達できる参考例として追加し、一覧が操作可能範囲の上限にならないようにする。
- [ ] 地上05・06・25は支持履歴から、29は支持中の生入力による回転とその後の解除から目標を照合する。31は回転→越境→支持の順を保つ。地上技が着地成功として表示されても、名称だけで空中ボーナスを作らない。
- [ ] 後続F03・F05の38技・88組は、新しい自由入力で通す検査に置き換える。126試行の分割・試行ID・実入力経路・旧成功表示の使い回し禁止は引き継ぐ。元の練習5番も、新しい自由操作を教える内容と入力へ作り直し、旧一筆の判定器を必須にしない。
- [ ] `npm run test:e2e -- tests/freestyle-flow.spec.ts tests/freestyle-lessons.spec.ts tests/practice-demo.spec.ts`を通してコミットする。

## 9. G06 — 途中操作・再生・15言語をつなぐ

**変更:** `src/view/replay.ts`、`src/view/scene.ts`、`src/view/trick-lab.ts`、`src/ui/share.ts`、F04の中断処理、F06の翻訳。**作成:** `tests/free-replay.test.ts`、`tests/freestyle-input.spec.ts`。

- [ ] 新リプレイへ`motionVersion: 'freestyle-1'`、移動基準点、犬と人それぞれの世界位置・世界姿勢、適用入力の版情報を追加する。新形式は旧heading・basePitchを重ねない。回転・接触の区切りを保存し、速い回転を最終姿勢だけで省略しない。旧形式のフレームは旧モデルと変換で読み、旧記録を新エンジンへ再入力して作り直さない。
- [ ] 取消・捕捉解除・アプリ切替・画面回転・再試行で指の所有権と保留入力を閉じ、止まった試行へ遅れた回転が入らないことを確認する。元の後続F04の再開条件を使う。
- [ ] 「一緒／犬／人」「着地確認中」「フリースタイル」「着地成功・別の動き」と実測角度・得点内訳を15言語へ加える。画面とX共有は今回の確定値を使い、未知の技の日本語を固定で埋め込まない。
- [ ] 縦402×700・横700×402、音オフ、演出弱で、入力面・対象切替・操作ボタン・着地点が重ならないことを確認する。
- [ ] `npm test -- tests/free-replay.test.ts tests/records.test.ts tests/i18n.test.ts`と`npm run test:e2e -- tests/freestyle-input.spec.ts tests/i18n.spec.ts`を通してコミットする。

## 10. G07 — 新ルールの記録と受付を別に用意する

**変更:** `src/game/rules.ts`、`src/ranking/client.ts`、`src/ranking/production.ts`、`src/storage/records.ts`、順位画面。**作成:** `supabase migration new inubo_freestyle_rules`でCLIが発行する時刻付きSQLファイル、`tests/freestyle-ranking.test.ts`。実装時にCLIの`--help`と出力パスを確認し、計画段階の仮の日時をファイル名として使わない。

- [ ] 既存の`inubo_ranking_private.versions`に`park/park-2/rules-freestyle-1`を追加する。既存ルールの行・成績は変更しない。初期の満点・0点基準と得点上限は設計に合わせる。適用順は隔離環境で検証→受付追加→本番ビルド切替とする。
- [ ] 送信待ちに保存された元のルール・氏名・ID・点を維持する。新規プレイのルール変更で古い送信待ちの値を変換しない。表示中の新旧順位も問い合わせるルールを固定する。
- [ ] 新ルールが未受付の場合は新規送信を保留し、旧ルールとして送り直さない。試験は本番へ試験値を送らず、模擬通信と隔離したデータベースで行う。初期のサーバー検査は版・開始・範囲・合計の検算であり、ブラウザだけの履歴から不正を完全に防げるとは扱わない。
- [ ] `npm test -- tests/freestyle-ranking.test.ts tests/ranking.test.ts tests/ranking-production.test.ts tests/records.test.ts`を通してコミットする。データベース適用・通常配信は計画書の作成だけでは実行しない。

## 11. G08 — 自由操作そのものを実機で評価する

後続F08の固定した成果物・隔離した保存領域・本番送信0件の確認版を使う。最初の代表的な一巡はG01〜G05の時点で確認できるようにし、38技を全実装した後に初めて操作感を見る順にはしない。

確認成果物に`stage: 'interaction' | 'release'`を付ける。interactionはG00の旧記録保全、G01〜G04の対象試験とG05の代表技・未知の動き、型検査・確認用ビルドを必須にし、全38技・15言語を未完了のまま早期確認できる。releaseはG00〜G07、38技・88組、15言語、既存記録と順位分離の全検査を必須にする。両方に本番通信0件・本番保存キーアクセス0件・成果物固定を要求し、interactionを最終合格や本番配信の根拠へ使わない。

- [ ] iPhone 17 Pro Safariで、指を離す前に動く、小さく止める、逆へ戻す、別方向へ続ける、指を置き直す、2枠以上の操作をする、未知の形のまま着く、を縦横で試す。基準の動画・入力ログ・姿勢・着地結果を保存する。
- [ ] 同じ自由入力を別の見本選択で試して姿勢と点が変わらないこと、名前が付かなくても成立することを確認する。手本を上手になぞれたことだけを受入にしない。
- [ ] 入力が姿勢へ反映された時刻と表示フレームを記録し、次の表示更新までに反応することを確認する。コマ落ち時の待ちや動きの飛び、同じ入力ログの8／16／33ミリ秒再生の結果差を調べる。
- [ ] 代表一巡が合格後、38技・88組・15言語・旧記録保全・新順位分離の検査をそろえる。全体の型検査・計算試験・ビルド・画面試験は候補版で1回通し、iPhoneの対象コミット・ルール版・結果を残す。

ゲームの実装完了、コードの自動試験合格、実機の合格は別々に記録する。今回の文書PRではこれらを完了へ更新しない。計画の敵対的検証と修正は[自由操作計画の検証記録](freestyle-adversarial-review.md)へ残す。
