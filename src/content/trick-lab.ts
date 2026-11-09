import type { Hand, Handle, LabAction, LabEventKind, LabSetup, PadId, SupportPart, AngleClass, Tilt } from '../game/trick-lab';
import type { LabFixtureId } from '../game/trick-lab-terrain';

/**
 * 技の練習で扱う38技。番号・日英の名称・難度・動作の区別は調査資料に合わせ、
 * ゲーム内の初期値と操作はイヌボー版として決める（docs/trick-motion-implementation-plan.md）。
 */

export type LabReq =
  | {
      kind: 'air';
      /** 犬の水平回転・裏返り・人の水平回転（度、正がFS・キック）。 */
      dogYaw?: number;
      flip?: number;
      riderYaw?: number;
      /** false なら踏切なしの落下でもよい（既定は踏切が必要）。 */
      pop?: boolean;
      grab?: { hand: Hand; handle: Handle };
      plant?: 'boneless' | 'noComply';
    }
  | { kind: 'manual'; manual: 'back' | 'front' }
  | {
      kind: 'edge';
      edge: {
        /** +1 = つま先側（FS）、-1 = かかと側（BS）。 */
        side: 1 | -1;
        support: SupportPart;
        angle: AngleClass;
        crossed?: PadId | null;
        hang?: { end: 'front' | 'rear'; side: 'entry' | 'far' };
        tilt?: Tilt;
      };
    }
  | {
      kind: 'ramp';
      ramp: {
        start: 'bottom' | 'coping';
        fakie?: boolean;
        lock: SupportPart;
        crossed?: PadId | null;
        descend: 'forward' | 'backward';
        /** 犬の水平回転の合計（度）。 */
        turn?: number;
        minStillUs: number;
      };
    };

export type LabButtonId = 'left' | 'right' | 'pop' | 'catch' | 'grab' | 'plant' | 'loadFront' | 'loadCenter' | 'loadBack' | 'brake' | 'exit' | 'start';
export type LabSetupField = keyof LabSetup;

export interface LabDemoStep {
  /** 試行時刻（マイクロ秒）か、出来事からの遅れ。 */
  at: number | { after: LabEventKind; delayUs: number };
  action: LabAction;
  button: LabButtonId | null;
}

export type LabGroup = 'basic' | 'combo' | 'grind' | 'ramp' | 'hand';

export interface LabLesson {
  id: string;
  ja: string;
  en: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  group: LabGroup;
  fixtureIds: LabFixtureId[];
  req: LabReq;
  /** お手本で使う準備。プレイヤー側には反映しない。 */
  demoSetup: Partial<LabSetup>;
  /** 画面に出す準備の項目。 */
  setupFields: LabSetupField[];
  /** 開始から復帰までの動き。 */
  motion: string;
  /** 合格と代表失敗。 */
  pass: string;
  /** 試行結果の表示名（資料の名称と変える場合）。 */
  successText?: string;
  alias?: string;
}

export const LAB_GROUP_NAMES: Record<LabGroup, string> = {
  basic: '基本ジャンプと片側支持',
  combo: '複合回転',
  grind: '縁石・手すりの滑走',
  ramp: '曲面ランプ',
  hand: '手の保持と前足の一時接地',
};

const ROT: LabSetupField[] = ['dogYaw', 'flip', 'riderYaw'];
const EDGE_FIELDS: LabSetupField[] = ['dogYaw', 'tilt', 'exitMotion'];
const GRAB_FIELDS: LabSetupField[] = ['hand', 'handle'];

function air(id: string, ja: string, en: string, difficulty: LabLesson['difficulty'], group: LabGroup, fixtureIds: LabFixtureId[], r: { dogYaw?: number; flip?: number; riderYaw?: number }, motion: string, pass: string): LabLesson {
  const demoSetup: Partial<LabSetup> = {};
  if (r.dogYaw) demoSetup.dogYaw = r.dogYaw;
  if (r.riderYaw) demoSetup.riderYaw = r.riderYaw;
  if (r.flip) demoSetup.flip = r.flip > 0 ? 'kick' : 'heel';
  return { id, ja, en, difficulty, group, fixtureIds, req: { kind: 'air', ...r }, demoSetup, setupFields: ROT, motion, pass };
}

function edge(id: string, ja: string, en: string, difficulty: LabLesson['difficulty'], fixtureIds: LabFixtureId[], e: (LabReq & { kind: 'edge' })['edge'], demoSetup: Partial<LabSetup>, motion: string, pass: string): LabLesson {
  return { id, ja, en, difficulty, group: 'grind', fixtureIds, req: { kind: 'edge', edge: e }, demoSetup, setupFields: EDGE_FIELDS, motion, pass };
}

function ramp(id: string, ja: string, en: string, difficulty: LabLesson['difficulty'], r: (LabReq & { kind: 'ramp' })['ramp'], demoSetup: Partial<LabSetup>, setupFields: LabSetupField[], motion: string, pass: string): LabLesson {
  return { id, ja, en, difficulty, group: 'ramp', fixtureIds: ['ramp'], req: { kind: 'ramp', ramp: r }, demoSetup, setupFields, motion, pass };
}

function grab(id: string, ja: string, en: string, difficulty: LabLesson['difficulty'], fixtureIds: LabFixtureId[], hand: Hand, handle: Handle, motion: string, pass: string, extra: Partial<LabLesson> = {}): LabLesson {
  return { id, ja, en, difficulty, group: 'hand', fixtureIds, req: { kind: 'air', grab: { hand, handle } }, demoSetup: { hand, handle }, setupFields: GRAB_FIELDS, motion, pass, ...extra };
}

const FS = 1;
const BS = -1;

export const TRICK_LAB_LESSONS: readonly LabLesson[] = [
  air('01', 'オーリー', 'Ollie', 2, 'basic', ['flat', 'stairs', 'kicker'], {},
    '前足を背の中央、後足を後端に置き、両膝を曲げる。後足側で踏切 → 前足を前へ送り犬の先端をそろえる → 両足を戻す → 膝を曲げて走行へ。',
    '跳躍後に両足が戻り、安定して接地。段差から落ちただけ、前後の傾きが大きいまま接地は失敗。'),
  air('02', 'キックフリップ', 'Kickflip', 3, 'basic', ['flat', 'stairs'], { flip: 360 },
    '後足で踏切 → 前足のつま先をかかと側へ抜く → 膝を上げて犬が裏返る空間を作る → 表が戻ってから両足を戻す。',
    '犬の長軸でキック方向に360°。人の水平回転は0°。半回転や逆向き、足の戻りが早ければ失敗。'),
  air('03', 'ヒールフリップ', 'Heelflip', 3, 'basic', ['flat', 'stairs'], { flip: -360 },
    '踏切 → 前足のかかとを使い02と逆へ返す → 膝を上げる → 両足を戻して復帰。',
    '犬の長軸でヒール方向に360°。02の方向、途中接地、足が戻らない場合は失敗。'),
  air('04', 'バックサイド・ポップショービット', 'Backside Pop Shove-It', 2, 'basic', ['flat', 'stairs'], { dogYaw: -180 },
    '後足で弾く動きとすくう動き → 前足を浮かせる → 犬だけBS180° → 新しい足の位置へ戻す。',
    '犬BS180°、犬の裏返りと人の水平回転は0°。人も180°回った場合は失敗。'),
  {
    id: '05', ja: 'マニュアル', en: 'Manual', difficulty: 2, group: 'basic', fixtureIds: ['flat', 'slope'],
    req: { kind: 'manual', manual: 'back' }, demoSetup: {}, setupFields: [],
    motion: '後ろ荷重 → 前足組を上げる → 後足組で進む → 中央荷重で前足組を下ろす。',
    pass: '後足組だけで0.50秒以上かつ1.00 m以上進んだ後、安定走行へ。早い前足組の接地は失敗。',
  },
  {
    id: '06', ja: 'ノーズマニュアル', en: 'Nose Manual', difficulty: 3, group: 'basic', fixtureIds: ['flat', 'slope'],
    req: { kind: 'manual', manual: 'front' }, demoSetup: {}, setupFields: [],
    motion: '前荷重 → 後足組を上げる → 前足組で進む → 後足組を下ろす。',
    pass: '05と支持部位が逆。早い後足組の接地は失敗。',
  },
  air('07', 'バリアル・キックフリップ', 'Varial Kickflip', 3, 'combo', ['flat', 'gap'], { dogYaw: -180, flip: 360 },
    '後足でBSへすくう → 前足でキック方向へ返す → 肩を保って両脚を上げる → 両足で受けて復帰。',
    '犬BS180°とキック360°、人0°。一方の軸だけ終えても失敗。'),
  air('08', 'バリアル・ヒールフリップ', 'Varial Heelflip', 4, 'combo', ['flat', 'gap'], { dogYaw: 180, flip: -360 },
    '後足でFSへ押す → かかとで逆方向へ返す → 両脚を上げる → 両足で受ける。',
    '犬FS180°とヒール360°、人0°。07の向きや早い足戻しは失敗。'),
  air('09', '360フリップ／トレフリップ', '360 Flip / Tre Flip', 4, 'combo', ['flat', 'gap'], { dogYaw: -360, flip: 360 },
    '後足で大きくすくう → 前足でキック方向へ返す → 犬が両軸で回りきる → 受けて着地。',
    '犬BS360°とキック360°、人0°。最終方位が同じ0°、BS270°、裏返り720°は失敗。'),
  air('10', 'ハードフリップ', 'Hardflip', 5, 'combo', ['flat', 'gap'], { dogYaw: 180, flip: 360 },
    '後足で押す → 前足を横へ抜く → 両脚を引き上げる → 犬を足で受ける。',
    '犬FS180°とキック360°、人0°。縦に立っただけでは成立させない。'),
  air('11', 'インワード・ヒールフリップ', 'Inward Heelflip', 5, 'combo', ['flat', 'gap'], { dogYaw: -180, flip: -360 },
    '後足で弾く → かかとで返す → 犬が斜めに通る空間をつくる → 受けて復帰。',
    '犬BS180°とヒール360°、人0°。10と軸の向きが逆。回転不足なら失敗。'),
  air('12', 'バックサイド・ビッグスピン', 'Backside Bigspin', 4, 'combo', ['flat', 'gap'], { dogYaw: -360, riderYaw: -180 },
    '後足ですくって犬を先行させる → 肩と腰を回す → 足で受ける → 逆の足が前に来る姿勢で復帰。',
    '犬BS360°、人BS180°、裏返り0°。両者の回転を足し合わせた値では合格させない。'),
  air('13', 'フロントサイド180キックフリップ', 'FS 180 Kickflip / Frontside Flip', 4, 'combo', ['flat', 'stairs'], { dogYaw: 180, riderYaw: 180, flip: 360 },
    '肩からFSへ回しつつ踏切 → つま先で返す → 両足で受けて人と犬の回転を終える → 走行へ。',
    '人と犬が各FS180°、犬キック360°。着地してから回り足した分は数えない。'),
  air('14', 'バックサイド180キックフリップ', 'BS 180 Kickflip / Backside Flip', 4, 'combo', ['flat', 'stairs'], { dogYaw: -180, riderYaw: -180, flip: 360 },
    '腰と肩をBSへ回しながら踏切 → キック方向へ返す → 上面が戻って受ける → 走行へ。',
    '人と犬が各BS180°、犬キック360°。13と水平の向きだけ逆。人だけ回った場合は失敗。'),
  edge('15', 'フロントサイド50-50グラインド', 'Frontside 50-50 Grind', 2, ['curb', 'rail'], { side: FS, support: 'bothPads', angle: 'parallel', crossed: null }, {},
    'つま先側の縁に沿う。跳んで平行のまま近づく → 前後パッドを乗せる → 中央荷重で滑る → 路面へ抜ける。',
    '前後パッドを同じ縁で支持し1.00 m以上。片側支持は失敗。'),
  edge('16', 'バックサイド・ボードスライド', 'Backside Boardslide', 3, ['rail', 'curb'], { side: BS, support: 'center', angle: 'perpendicular', crossed: 'frontPad' }, { dogYaw: 90, exitMotion: 'revert' },
    'かかと側の縁に進入。跳ぶ → 犬をFS約90°回し前パッドを越す → 中央裏で滑る → 向きを戻す。',
    '前パッドが越えて反対側にある状態で中央裏支持。後パッドだけが越えた場合は失敗。'),
  edge('17', 'バックサイド・ノーズスライド', 'Backside Noseslide', 3, ['curb'], { side: BS, support: 'noseEnd', angle: 'perpendicular', crossed: null }, { dogYaw: 90, exitMotion: 'revert' },
    'かかと側へ進入。跳んでFS約90° → 前端を重ねる → 前荷重で前端裏を滑らせる → 荷重を抜いて降りる。',
    '前端裏支持。前パッドで支えた場合や、1.00 mに達する前に外れた場合は失敗。'),
  edge('18', 'フロントサイド・テールスライド', 'Frontside Tailslide', 4, ['curb'], { side: FS, support: 'tailEnd', angle: 'perpendicular', crossed: null }, { dogYaw: 90, exitMotion: 'revert' },
    'つま先側へ進入。跳んでFS約90° → 後端裏を乗せる → 後ろ荷重で滑る → 犬の向きを戻して降りる。',
    '後端裏支持。後パッド支持だけの場合は失敗。'),
  edge('19', 'フロントサイド・リップスライド', 'Frontside Lipslide', 4, ['rail'], { side: FS, support: 'center', angle: 'perpendicular', crossed: 'rearPad' }, { dogYaw: 90, exitMotion: 'revert' },
    'つま先側の縁へ進入。跳ぶ → 犬をFS約90°回し後パッドを越す → 中央裏で滑る → 向きを戻す。',
    '後パッドが反対側にある状態で中央裏支持 → 滑走 → 復帰。前パッド越えだけでは失敗。'),
  edge('20', 'フロントサイド5-0グラインド', 'Frontside 5-0 Grind', 3, ['curb', 'rail'], { side: FS, support: 'rearPad', angle: 'parallel', crossed: null }, {},
    'つま先側の縁へ近づく。跳んで後パッドを乗せる → 前を上げる → 後ろ荷重で進む → 降りる。',
    '後パッドだけで支持。前パッドが支えた場合は失敗。'),
  edge('21', 'フロントサイド・ノーズグラインド', 'Frontside Nosegrind', 4, ['curb', 'rail'], { side: FS, support: 'frontPad', angle: 'parallel', crossed: null }, {},
    'つま先側へ平行に近づく。跳んで前パッドを乗せる → 前荷重、後を浮かす → 縁に沿って進む → 降りる。',
    '前パッド支持と平行を維持。後パッドも触れた場合は失敗。'),
  edge('22', 'バックサイド・クルックドグラインド', 'Backside Crooked Grind', 4, ['curb', 'rail'], { side: BS, support: 'frontPad', angle: 'diagonal', hang: { end: 'rear', side: 'entry' }, tilt: 'down', crossed: null }, { dogYaw: 45, tilt: 'down', exitMotion: 'revert' },
    'かかと側へ近づく。跳んで犬を斜めに入れる → 前パッドを乗せ前を少し下げる → 後端を進入側へ出して滑る → 外して降りる。',
    '前パッド支持と斜め（20°〜60°）の両方。平行や直角に近い場合は失敗。'),
  edge('23', 'フロントサイド・スミスグラインド', 'Frontside Smith Grind', 4, ['curb', 'rail'], { side: FS, support: 'rearPad', angle: 'diagonal', hang: { end: 'front', side: 'entry' }, tilt: 'down', crossed: null }, { dogYaw: 45, tilt: 'down', exitMotion: 'revert' },
    'つま先側へ近づく。跳んで後パッドを乗せる → 前側を進入側に下げる → 腰は後パッドの上で進む → 前を上げて抜ける。',
    '後パッド支持。前パッドは縁より下かつ進入側。前荷重で支えた場合は失敗。'),
  edge('24', 'バックサイド・フィーブルグラインド', 'Backside Feeble Grind', 4, ['curb', 'rail'], { side: BS, support: 'rearPad', angle: 'diagonal', hang: { end: 'front', side: 'far' }, tilt: 'down', crossed: 'frontPad' }, { dogYaw: 45, tilt: 'down', exitMotion: 'revert' },
    'かかと側へ近づく。跳んで前パッドを越す → 後パッドを乗せ、前側を反対側に下げる → 斜めに滑る → 前を上げて抜ける。',
    '前パッド越え → 後パッド支持。前パッドが進入側に残るか、側面衝突なら失敗。'),
  ramp('25', 'ドロップイン', 'Drop-in', 2, { start: 'coping', lock: 'tailEnd', descend: 'forward', minStillUs: 0 }, {}, [],
    '後端裏を上端の支点にして静止 → 前荷重 → 前足組を曲面へ下ろす → 両足組で下る。',
    '後端裏 → 前足組 → 安定した前向きの下り。前荷重なしで縁から離れると失敗。'),
  ramp('26', 'テールストール', 'Tail Stall', 2, { start: 'bottom', fakie: true, lock: 'tailEnd', descend: 'forward', minStillUs: 200_000 }, {}, [],
    '後ろ向きに上る。後ろ荷重 → 後端裏を縁に掛ける → 前を浮かせ停止 → 前荷重へ移し、前向きに下る。',
    '後端裏支持で0.20秒停止 → 前向きで下る。縁を飛び越えた場合は失敗。'),
  ramp('27', 'ノーズストール', 'Nose Stall', 3, { start: 'bottom', lock: 'noseEnd', descend: 'backward', minStillUs: 200_000 }, {}, [],
    '前向きに上る。前荷重 → 前端裏を縁に掛けて後ろを浮かす → 停止 → 後ろへ荷重して後ろ向きに下る。',
    '前端裏支持 → 0.20秒停止 → 後ろ向きの下り。前パッド支持で代用すると失敗。'),
  ramp('28', 'ロック・トゥ・フェイキー', 'Rock to Fakie', 2, { start: 'bottom', lock: 'center', crossed: 'frontPad', descend: 'backward', turn: 0, minStillUs: 80_000 }, { exitMotion: 'straight' }, ['exitMotion'],
    '前向きに上る。前パッドを縁の向こうへ → 中央裏を掛ける → 前パッドを浮かせて荷重を抜く → 身体を回さず後ろ向きに下る。',
    '前パッドの越境 → 中央裏支持 → 後ろ向きで下る。180°回すと失敗。'),
  ramp('29', 'バックサイド・ロックンロール', 'Backside Rock ’n’ Roll', 3, { start: 'bottom', lock: 'center', crossed: 'frontPad', descend: 'forward', turn: -180, minStillUs: 80_000 }, { exitMotion: 'bsHalf' }, ['exitMotion'],
    '28と同様に中央裏まで乗せる。「抜ける」で前を浮かせ、支持が残る間にBS回転を始め、縁を外れて前向きに下る。',
    '中央裏支持中に回転開始、縁を抜けるまでに犬・人ともBS180°。後ろ向きで降りる場合は失敗。'),
  ramp('30', 'バックサイド・アクスルストール', 'Backside Axle Stall', 3, { start: 'bottom', lock: 'bothPads', descend: 'forward', turn: -180, minStillUs: 200_000 }, { dogYaw: -90, riderYaw: -90, exitMotion: 'bsHalf' }, ['dogYaw', 'riderYaw', 'exitMotion'],
    '前向きに上る。犬と腰をBS約90°回して縁に沿わせる → 前後パッドを乗せて停止 → 前向きに下る。',
    '両パッド支持で0.20秒停止し、前向きの下りに戻る。片側支持やFSへの回転は失敗。'),
  ramp('31', 'フロントサイド・ディザスター', 'Frontside Disaster', 4, { start: 'bottom', lock: 'center', crossed: 'rearPad', descend: 'forward', turn: 180, minStillUs: 200_000 }, { dogYaw: 180, riderYaw: 180 }, ['dogYaw', 'riderYaw'],
    '前向きに上る。後足側で弾き犬と人をFS180° → 後パッドを台側へ通す → 中央裏を掛ける → 短く停止 → 前荷重で前向きに下る。',
    'FS180°完了 → 後パッドが台側へ越える → 中央裏支持 → 停止 → 曲面へ復帰。回転前の越境は失敗。'),
  grab('32', 'ノーズグラブ', 'Nose Grab', 3, ['kicker', 'gap'], 'front', 'nose',
    '膝を曲げて跳ぶ → 両膝を引き上げる → 前手を前端の持ち手へ → 保持して離す → 膝を曲げて接地。',
    '前手＋前端。後ろ手、短すぎる保持、着地時まで保持は失敗。'),
  grab('33', 'テールグラブ', 'Tail Grab', 3, ['kicker', 'gap'], 'back', 'tail',
    '後ろ膝を引いて後端を近づける → 後ろ手を後端の持ち手へ → 保持して離す → 両足で接地。',
    '後ろ手＋後端。前手または前端は失敗。'),
  grab('34', 'ウェドル・グラブ', 'Weddle Grab', 3, ['kicker', 'flat'], 'front', 'toe',
    '両足を前後の位置に置いて跳ぶ → 膝を引く → 前手で両足の間のつま先側を持つ → 離す → 接地。',
    '前手＋つま先側中央。37の手や38の側では失敗。', { alias: 'ミュート・グラブ（旧称）' }),
  {
    id: '35', ja: 'ボンレス', en: 'Boneless', difficulty: 2, group: 'hand', fixtureIds: ['flat', 'slope'],
    req: { kind: 'air', grab: { hand: 'back', handle: 'toe' }, plant: 'boneless' }, demoSetup: { hand: 'back', handle: 'toe' }, setupFields: GRAB_FIELDS,
    motion: '後ろ手で側面を持つ → 前足を地面へ → その足で跳ぶ → 前足を戻してから手を離す → 両足で復帰。',
    pass: '手の保持 → 前足の実接地 → 踏切 → 前足復帰 → 手の解除。地面への足着きが先なら失敗。',
  },
  {
    id: '36', ja: 'フロントサイド180ノーコンプライ', en: 'FS 180 No Comply', difficulty: 3, group: 'hand', fixtureIds: ['flat', 'slope'],
    req: { kind: 'air', dogYaw: 180, riderYaw: 180, plant: 'noComply' }, demoSetup: { dogYaw: 180, riderYaw: 180 }, setupFields: ['dogYaw', 'riderYaw'],
    motion: '前足を地面へ → 後足側で弾いて肩を回す → 犬と人をFS180° → 前足を戻して復帰。',
    pass: '前足の実接地と両者FS180°、手の保持なし。35と同じように持った場合や前足が着かない場合は失敗。',
  },
  grab('37', 'インディ・グラブ', 'Indy Grab', 3, ['kicker', 'flat'], 'back', 'toe',
    '膝を引いて跳ぶ → 後ろ手を両足の間のつま先側へ → 保持 → 離す → 接地。',
    '後ろ手＋つま先側中央。前手なら失敗。', { successText: 'インディ式の持ち方が決まりました。' }),
  grab('38', 'メロン・グラブ／メランコリー', 'Melon / Melancholy Grab', 3, ['kicker', 'flat'], 'front', 'heel',
    '膝を引いて跳ぶ → 前手を両足の間のかかと側へ → 保持 → 離す → 接地。',
    '前手＋かかと側中央。手か側が違えば失敗。'),
];

// ------------------------------------------------------------------ お手本の操作列

/** 平地での踏切の時刻。ギャップは開口部の手前0.25 m、階段は上段の端の手前0.3 m。 */
const POP_AT_US: Partial<Record<LabFixtureId, number>> = {
  flat: 600_000,
  slope: 600_000,
  gap: 1_245_000,
  stairs: 1_060_000,
};
/** レールと縁石は、横へ2回寄せてから跳ぶ。 */
const EDGE_POP_US = 570_000;

function after(event: LabEventKind, delayUs: number): LabDemoStep['at'] {
  return { after: event, delayUs };
}

function setupStep(setup: Partial<LabSetup>): LabDemoStep[] {
  return Object.keys(setup).length ? [{ at: 0, action: { type: 'setup', setup }, button: null }] : [];
}

const START: LabDemoStep = { at: 0, action: { type: 'start' }, button: 'start' };

function catchDelayUs(r: { dogYaw?: number; flip?: number; riderYaw?: number }): number | null {
  const dog = r.dogYaw ?? 0;
  const rider = r.riderYaw ?? 0;
  const flip = r.flip ?? 0;
  if (!flip && dog === rider) return null;
  if (dog === rider) return 340_000;
  return Math.abs(dog) <= 90 ? 260_000 : 440_000;
}

/** 技と地形からお手本の操作列を作る。プレイヤーと同じ入力の形で送る。 */
export function labDemo(lesson: LabLesson, fixture: LabFixtureId): LabDemoStep[] {
  const steps: LabDemoStep[] = [...setupStep(lesson.demoSetup), START];
  const req = lesson.req;
  const popStep = (): LabDemoStep[] => {
    if (fixture === 'kicker') return [];
    return [{ at: POP_AT_US[fixture] ?? 600_000, action: { type: 'pop' }, button: 'pop' }];
  };
  if (req.kind === 'air') {
    if (req.plant === 'boneless') {
      steps.push(
        { at: 300_000, action: { type: 'grab' }, button: 'grab' },
        { at: after('grabReach', 100_000), action: { type: 'plant' }, button: 'plant' },
        { at: after('plantContact', 80_000), action: { type: 'pop' }, button: 'pop' },
        { at: after('takeoff', 200_000), action: { type: 'catch' }, button: 'catch' },
        { at: after('catch', 150_000), action: { type: 'release' }, button: 'grab' },
      );
      return steps;
    }
    if (req.plant === 'noComply') {
      steps.push(
        { at: 400_000, action: { type: 'plant' }, button: 'plant' },
        { at: after('plantContact', 80_000), action: { type: 'pop' }, button: 'pop' },
        { at: after('takeoff', 340_000), action: { type: 'catch' }, button: 'catch' },
      );
      return steps;
    }
    steps.push(...popStep());
    const c = catchDelayUs(req);
    if (c !== null) steps.push({ at: after('takeoff', c), action: { type: 'catch' }, button: 'catch' });
    if (req.grab) {
      steps.push(
        { at: after('takeoff', 120_000), action: { type: 'grab' }, button: 'grab' },
        { at: after('grabReach', 200_000), action: { type: 'release' }, button: 'grab' },
      );
    }
    return steps;
  }
  if (req.kind === 'manual') {
    const load = req.manual;
    steps.push(
      { at: 300_000, action: { type: 'load', load }, button: load === 'back' ? 'loadBack' : 'loadFront' },
      { at: 1_300_000, action: { type: 'load', load: 'center' }, button: 'loadCenter' },
    );
    return steps;
  }
  if (req.kind === 'edge') {
    // 縁の側へ0.4 mずつ2回寄せる（開始位置から見て右は +x）。
    const right = req.edge.side === 1;
    const dir: LabButtonId = right ? 'right' : 'left';
    const dx = right ? 0.4 : -0.4;
    steps.push(
      { at: 100_000, action: { type: 'aim', dx }, button: dir },
      { at: 200_000, action: { type: 'aim', dx }, button: dir },
      { at: EDGE_POP_US, action: { type: 'pop' }, button: 'pop' },
    );
    const part = req.edge.support;
    const load = part === 'frontPad' || part === 'noseEnd' ? 'front' : part === 'rearPad' || part === 'tailEnd' ? 'back' : null;
    if (load) steps.push({ at: after('takeoff', 150_000), action: { type: 'load', load }, button: load === 'front' ? 'loadFront' : 'loadBack' });
    return steps;
  }
  // 曲面ランプ
  const r = req.ramp;
  if (r.start === 'coping') {
    steps.push({ at: 400_000, action: { type: 'load', load: 'front' }, button: 'loadFront' });
    return steps;
  }
  if (lesson.id === '31') {
    steps.push(
      { at: after('zone', 60_000), action: { type: 'pop' }, button: 'pop' },
      { at: after('supportOn', 300_000), action: { type: 'load', load: 'front' }, button: 'loadFront' },
    );
    return steps;
  }
  if (r.lock === 'tailEnd') steps.push({ at: 50_000, action: { type: 'load', load: 'back' }, button: 'loadBack' });
  if (r.lock === 'noseEnd') steps.push({ at: 50_000, action: { type: 'load', load: 'front' }, button: 'loadFront' });
  steps.push({ at: 60_000, action: { type: 'brake' }, button: 'brake' });
  if (r.lock === 'tailEnd') steps.push({ at: after('supportOn', 350_000), action: { type: 'load', load: 'front' }, button: 'loadFront' });
  else if (r.lock === 'noseEnd') steps.push({ at: after('supportOn', 350_000), action: { type: 'load', load: 'back' }, button: 'loadBack' });
  else steps.push({ at: after('supportOn', r.minStillUs + 150_000), action: { type: 'exit' }, button: 'exit' });
  return steps;
}
