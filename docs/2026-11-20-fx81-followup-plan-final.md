# イヌボー｜PR #29マージ後の不備解消・品質検証 実装計画書【完成版】

- 作成日：2026-11-20
- リポジトリ：chameleonjp-lab/inubo
- 基準：main の e8d6839bf8915678d3e60ff81294b550cb8ad4e4（PR #29マージ済み）
- 担当：Claude（実装と見た目、テスト、証拠の作成）
- 作成手順：初版 → 敵対的検証30件 → レビュー反映した本完成版
- このPRは**資料のみ**。実装はClaudeが新しいブランチの別PRで行う。
- 正本：docs/2026-11-20-81-trick-visual-spec.md（81件の描写）、docs/claude-81-fx-implementation-final-20261120.md（元計画）、docs/claude-81-fx-implementation-record-20261120.md（実装記録）
- レビュー：docs/2026-11-20-fx81-followup-adversarial-review.md（R01〜R30）

## 1. 作業目的と決定済みの範囲

PR #29で81種類の演出プログラムと表示処理は実装済み。しかし、**空中最高段階の到達性・着地後の固定・高速回転の描画・ジャンプ間の回転残留・一時停止中の粒・ゴーストの着地位置**に問題がある。また、iPhone Safari実機の速度、30種類の着地音の聞き分け、81件の個別描写、弱い演出の視認性は検証が残る。

本書では、修正6要件（F01〜F06）と、検証4要件（V01〜V04）を**すべて実装・検証対象**とする。CIの成功だけで実機・聴感・全81件の品質を完了と判定しない。

**守る既存仕様：**
- B（両方）、H（人のみ）、D（犬のみ）、各 F01〜F10／A01〜A07／L01〜L10、計81件。ID・名前・形・動き・終了条件を削除・統合しない。
- F/Lの閾値 [1,80,160,260,400,550,700,950,1250,1650]、Aの閾値 [1,160,400,700,950,1250,1650] は変更禁止。
- 本来のゲーム得点、半回転判定、技名150件、切替連携加点、走行速度、物理挙動、サウンド設定、ルールバージョン、実験場ランキング、Supabase通信、プレイ回数、自己ベスト、識別値、旧録画の保存キーを変更しない。
- 総合結果30段階／称号60件と、旧ルールの音を維持。PR #27で削除したホーム5項目は復活させない。
- mainへの直接push・自動マージ・本番公開・外部従量課金機能の無断使用は禁止。実装結果はPRで提出。

## 2. 最新コードの問題の根拠

| ID | 優先 | 確認した場所 | 具体的な欠陥 |
|---|---|---|---|
| F01 | 高 | src/view/trick-fx-timeline.ts:199〜220、src/view/trick-fx.ts:21〜36 | 空中の provisional 基礎点を最大999に制限。999×1.65を丸めても1648で、1650以上のF10/A07は連携なしでは到達不可。さらに分母2×3600度/秒に対して単独チャンネル上限は3600度/秒なので、単に999→1000でも不十分。 |
| F02 | 高 | src/view/trick-fx-ops-land.ts の onGround/prints/ring/collect/fall/petals/silhouette/descend、src/view/trick-fx-engine.ts:282〜293 | Lは接地後も現在のbody anchorを読む。床へ残すべき足跡・輪・光が走行後の犬・人を追いかける。 |
| F03 | 高 | src/view/trick-fx-engine.ts:176〜202 | 連続した姿勢のQuaternion差の短い方を使う。180度/描画間隔を超える高速回転では速度・軸が別方向になり得る。例：合成角速度7200度/秒、30fpsなら240度/描画間隔。 |
| F04 | 中 | src/view/trick-fx-engine.ts:66、84〜90、197、305 | 回転の累積turnedがジャンプ単位で初期化されず、次のジャンプの円弧／らせん／輪の方向へ持ち越される。clearでもturnedは0へ戻していない。 |
| F05 | 中 | src/view/scene.ts:744〜915 | FX本体は一時停止で時計を止めるが、既存のParticles.update(dt)は止まらず、粒子が動いて消える。 |
| F06 | 中 | src/view/scene.ts:937〜951、src/view/replay.ts:59〜94 | ゴーストはvisualEventsの旧時刻分を処理する際、現在のgp座標を着地位置にしている。描画間引き・早送りで過去の着地の光が現在位置へずれる。 |

**実装記録が明示した残検証：** iPhone 17 Pro Safari実機・フレーム間隔、30効果音の聴感、代表27件以外の54件、明るい背景のF/A/L低段階。特に tests/free-review.spec.ts はF/A54件を自動表示、Lは代表9件のみであり、L30全件のブラウザ試験がまだない。

## 3. P0：ゲームと表示の境界を先に固定

最初にsrc/view/trick-fx-context.ts、src/view/trick-fx-timeline.ts、src/view/trick-fx-engine.ts、src/view/scene.ts間の**読み取り専用情報の型**を整理する。後続工程を個別に行っても同じ情報を使えるようにする。

- FxSpinSample: { atUs, jumpId, dogOmegaWorld, riderOmegaWorld, dogAccumRad, riderAccumRad } に相当する表示専用データを用意。角速度はsrc/game/free-motion.ts の motion.omega.common＋dog、common＋riderの合成から求め、単位はラジアン/秒、方向はゲーム計算と同じ座標系に統一。累積角はFreeSpan履歴の積分（rotationTime）から算出。現行の得点用historyやomega自体は変更しない。
- FxLandingSnapshot: { runId, jumpId, atUs, contact, yaw, anchors } に相当する**不変の着地情報**。anchorsはL描画に必要な身体の各部位名→接地時の世界座標。接地位置は既存のSimEventのpathId/sMm/x/y/atUsと走行コースの変換を正本とする。計測点が現在のフレームでずれていればイベント時点へ変換してから固定する。
- FxFrameFlagsはpaused/reduced/weak/heading/groundYを維持し、新しい読取情報はoptionalで追加する。古いリプレイと操作確認版でも型が壊れないこと。
- 表示専用の関数でscoreFreeMotionのpoints/basePoints、対象の選択、既存のserver送信、localStorage書込みを変更しない。更新が必要なのはViewへの情報の受け渡しだけ。ゲーム状態を書き換えず、見た目の修正がゲームの判定に作用しない構造とする。
- 81件レジストリと既存形状の描画部品はできるだけ再利用。専用の別物のエンジンを新規作成して二重描画しない。

**P0受入：** 操作用のボタン反応時間・切替連携得点・同一区間の得点処理・旧記録が変わらないことを回帰テストで示す。改修後も既存の型検査・単体テストを成功させる。

## 4. P1：F01 空中の最高段階を現実的な入力から表示する

### 4-1. 誤判定を起こす条件
既存の\`FxTimeline.provisional()\`は、半回転以上の角度を測定した後、\`ceiling=2×FREE_MAX_DEG_PER_SEC×predictedAirUs\`、\`base=min(999, floor(980×scored×variety/ceiling))\`としている。これは単独回転が理論上最高速度でも「見た目の1000」を作れない設計。最高段階を実際に使えるようにしつつ、跳んだ瞬間にF10を乱発する修正は不可。

### 4-2. 採用する表示専用の計算
既存の暫定角度の集計と、確定した切替連携の判定は維持するが、表示用の暫定基礎点だけ次の方式に変更する。

1. elapsedUs＝tickUs−takeoffUs（上限はpredictedAirUs）。predictionは踏切時に決定済みで、0.45〜1.8秒の表示用予測。sampleは従来どおり走行時計の90ms刻み。
2. dog/riderの方向別実回転を積分し、**少なくとも1つの方向で180度を成立した身体**から qualifiedDegrees＝max(dogQualified,riderQualified) を求める。技未成立なら暫定base＝0。
3. elapsedSeconds＝elapsedUs/1e6。maxRate＝FREE_MAX_DEG_PER_SEC（現行3600度/秒）。高い水準を継続した操作として扱う基準率は maxRate×0.90。角速度から求めたeffort＝min(1,qualifiedDegrees/(elapsedSeconds×maxRate×0.90))。共通+個別の複合回転が3600を超えてもeffort上限は1。
4. 成熟度＝min(1,elapsedUs/(predictedAirUs×0.80))。暫定base＝floor(1000×effort×成熟度)。これに既存のscoreTargetSwitchesで**成立済み**のbonusを加え、既存visualDifficultyPoints(base,base+bonus)へ渡す。
5. 誤最高防止：elapsedUs が predictedAirUs×0.80 より小さい間は、どれほど速い複合回転でも**表示用難度値を最大1649**とする。80%以降で条件を満たした場合だけ難度1650へ到達できる。F/A段階は同じジャンプ内では下降させず、最大10/7。表示用値だけの条件で、公式スコアには一切影響させない。
6. 上記の0.90・0.80は見た目専用の固定値。magic numberを散らさず単一の命名済み定数にする。F/L・Aの既存閾値表は変更しない。段階10を実測できる範囲をテストする。

### 4-3. 必須テスト
B（共通チャンネル）、D（犬の専用チャンネル）、H（人の専用チャンネル）の各パターンで、現行のFreeMotion入力・3600度/秒の物理上限と減衰ルール内で回転を継続し、**少なくともF10とA07を実際の空中イベントとして生成**できること。疑似的にstage=10を直接指定する試験だけでは不合格。各F01〜F10/A01〜A07の到達可能性、連携なしでの最高到達、90ms時点の非最高、途中の段階非下降、着地前のF/Aと着地確定後Lが異なってよいことを検証。

実際のゲームで物理上限が予想より低く、上記で単独F10へ到達できなかった場合は、描画だけでなく積分した身体角度の原因を示し、**ゲームの速度や得点を変えず**表示用の定数を一箇所だけ調整して試験を再実行する。元の公式点数の補正・閾値改変で帳尻合わせは禁止。

## 5. P2：F02＋F04 着地座標とジャンプ間の状態を分ける

### 5-1. Lの位置を着地時に固定
src/view/trick-fx-engine.tsのL instance生成時、program.recipe内の全AnchorKeyを収集し、接地点のworldContact、進行方向yaw、身体計測点（犬の四足・耳・しっぽ、人の手・靴・腰・肩）を**1度だけ取得**したsnapshotへ格納する。着地時刻を別のsimulation tickで処理済みなら、その事実を検出し、landイベントの位置と姿勢に基づく正しい位置へ変換する。位置取得に失敗したら推測で(0,0,0)に描かず、その部品だけ抑止して調査ログを出す（本番のプレイを止めない）。

Lのdraw中は\`ctx.pos(key)\`がsnapshotを優先して返し、\`onGround()/ring()/prints()/collect()/fall()/silhouette()/petals()/descend()\`のすべてが**着地後に移動しない**。ただし演出自身が「空中の光が接地点へ収束する」「輪が床へ降りる」などの時系列アニメーションは正常に進める。着地した床面の高さはイベントのcontactYに固定し、レール上面と斜面・通常地面を区別する。

衝突、失敗・0点のplain landingでは成功Lを起動しない。採点済区間では新しい点は付与せず、難度に応じた演出だけ行い「区間採点済み」を維持。同一runId+jumpIdの成功Lと音は一度限り。

### 5-2. 新しいジャンプ開始時の回転状態を初期化
\`FxEngine\`へ表示専用のcurrentJumpIdを明示し、最初のFイベントを受けて**新ジャンプの回転累積turned、直前姿勢prev、角速度推定、軌跡履歴を初期化**する。ただし**直前ジャンプのL instanceは寿命まで床に残す**ため、FxEngine.clear()で丸ごと消してはいけない。現在のjumpIdが古いF/Aだけをフェードさせ、現ジャンプのF/Aと直前のLを別個に管理する。

既存clear()/resetEffects()/setGhost()/retire/再挑戦は全ての表示用内部値（turned、omega、prev、lastPivot、comboAtMs、対象、旧ringバッファ）を0/初期値に戻し、使い回すメモリを初期化して混入を防ぐ。

### 5-3. 必須テスト
着地直後から1〜2秒走行、急カーブ、斜面、レール上、連続ジャンプ、早送りの複数sim tickをテスト。L01/L05/L10をB/H/D各対象で接地点から動かないことを数値座標で確認。Lが消える直前に次のジャンプを開始しても、旧Lは不変、新F/Aの累積角度は0から、過去の軌跡は規定0.2〜0.4秒で消えることを確認。

