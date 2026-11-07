import type { SimEvent } from '../game/types';
import { DIR8_NAMES } from '../game/tricks';

/**
 * 仕様書§8 の E01〜E24 を、計算側の出来事（SimEvent）と画面の操作に対応づける。
 * 演出は出来事を読むだけで、成績を変えない（消音や粒の省略でも同じ走行になる）。
 */

export type EffectId = `E${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24'}`;

export interface EffectSpec {
  id: EffectId;
  scene: string;
  visual: string[];
  sound: string[];
}

export const EFFECTS: EffectSpec[] = [
  { id: 'E01', scene: '犬・コースを選ぶ／決定／戻る', visual: ['tailWag', 'pawCircle', 'markRetract'], sound: ['select', 'decide', 'back'] },
  { id: 'E02', scene: '開始を待つ／発進', visual: ['crouch', 'sandBurst'], sound: ['beat', 'go'] },
  { id: 'E03', scene: '通常走行／直線の最高速', visual: ['footprints', 'earsFlutter'], sound: ['stepsLoop', 'windLoop'] },
  { id: 'E04', scene: '左右移動／カーブ', visual: ['weightShift', 'leanSand'], sound: ['stepSwitch', 'skid'] },
  { id: 'E05', scene: '上り坂／下り坂', visual: ['riderLean', 'windLines'], sound: ['kickUp', 'windSlide'] },
  { id: 'E06', scene: 'ジャンプ／踏切台からの大ジャンプ', visual: ['kickMark', 'kickMarkBig'], sound: ['jump', 'jumpBig'] },
  { id: 'E07', scene: '犬だけの縦回転／横転／逆回転', visual: ['dogTrailNose', 'dogTrailFeet'], sound: ['dogSpinV', 'dogSpinH'] },
  { id: 'E08', scene: '人と犬の体ごとの回転／斜めの技', visual: ['dirArrow', 'shoulderTrail'], sound: ['bodyWhoosh', 'bodyWhoosh2'] },
  { id: 'E09', scene: '複合入力／複合技の着地成功', visual: ['twoTrails', 'pawTrails'], sound: ['compositeCue', 'chord2'] },
  { id: 'E10', scene: '入力が短い／技が未成立', visual: ['traceFade', 'practiceHint'], sound: ['hintSoft'] },
  { id: 'E11', scene: '壁・柵・階段を跳び越す／坂で迂回', visual: ['edgePaw', 'signSway'], sound: ['tap', 'stepsSurface'] },
  { id: 'E12', scene: '手すりに乗る／滑る／離れる', visual: ['railDot', 'railSpark', 'railLineEnd'], sound: ['railOn', 'grindLoop', 'confirm'] },
  { id: 'E13', scene: '通常着地／ぴたりと着地', visual: ['sandRing', 'fourPaws'], sound: ['landSoft', 'landPerfect'] },
  { id: 'E14', scene: '着地失敗／姿勢を立て直す', visual: ['stumble', 'underRotatedLabel'], sound: ['landBad', 'recover'] },
  { id: 'E15', scene: '壁・正面・手すり側面への衝突／停止／再発進', visual: ['impactLines', 'stopLabel', 'brace'], sound: ['thud', 'kick'] },
  { id: 'E16', scene: '踏切予告／骨形ゲートの上下', visual: ['lamp', 'gateMove'], sound: ['bell', 'mech'] },
  { id: 'E17', scene: '復帰地点を通る／コース外へ落ちる／復帰', visual: ['flagUp', 'fadeOut', 'respawnShow'], sound: ['flag', 'fallDown', 'respawn'] },
  { id: 'E18', scene: 'フード取得／加速中／加速終了', visual: ['boostGauge', 'windLinesLong'], sound: ['bag', 'up2', 'downSoft'] },
  { id: 'E19', scene: '糞を踏む／減速中／回復', visual: ['brownPrints', 'slowLabel'], sound: ['slip', 'stepsBack'] },
  { id: 'E20', scene: '骨形の道しるべ／分岐に入る／合流', visual: ['guidePrints', 'forkSign', 'printsSettle'], sound: ['wood', 'stepChoose'] },
  { id: 'E21', scene: '区間の技点確定／3区間連続成功', visual: ['markFill', 'streakLabel'], sound: ['stepUp', 'chord3'] },
  { id: 'E22', scene: '練習のお手本／課題達成／犬の完走スタンプ', visual: ['demoTrace', 'pawStamp'], sound: ['demoBeat', 'stamp'] },
  { id: 'E23', scene: '一時停止／再開／走り直し', visual: ['cover', 'reveal', 'resetPose'], sound: ['ambientDown', 'ambientUp', 'readyCue'] },
  { id: 'E24', scene: 'ゴール／結果発表／自己ベスト更新', visual: ['tape', 'breakdown', 'bestPaw'], sound: ['arrive', 'tick', 'best3'] },
];

/** 中央の短い文字の優先度。1=停止・失敗、2=着地・技、3=アイテム。 */
export type TextPriority = 1 | 2 | 3;

export interface Cue {
  effect: EffectId;
  visual: string;
  sound: string | null;
  text?: string;
  priority?: TextPriority;
  /** 中央に出さなかった出来事は、足元の印として残す。 */
  footMark?: string;
  objId?: string;
  atUs: number;
  runId: string;
  data?: SimEvent['data'];
}

function cue(ev: SimEvent, effect: EffectId, visual: string, sound: string | null, extra: Partial<Cue> = {}): Cue {
  return { effect, visual, sound, atUs: ev.atUs, runId: ev.runId, objId: ev.objId, data: ev.data, ...extra };
}

/** 出来事ひとつを演出に変える。対応しない出来事は null。 */
export function cueForEvent(ev: SimEvent): Cue | null {
  const d = ev.data ?? {};
  switch (ev.kind) {
    case 'countdown':
      return cue(ev, 'E02', 'crouch', 'beat');
    case 'start':
      return cue(ev, 'E02', 'sandBurst', 'go');
    case 'slope':
      return d.sign === 1 ? cue(ev, 'E05', 'riderLean', 'kickUp') : d.sign === -1 ? cue(ev, 'E05', 'windLines', 'windSlide') : null;
    case 'jump':
      return d.kind === 'kicker' ? cue(ev, 'E06', 'kickMarkBig', 'jumpBig') : cue(ev, 'E06', 'kickMark', 'jump');
    case 'trickStart':
      if (d.channel === 'dog') {
        const name = String(d.name ?? '');
        const vertical = name.includes('縦');
        return cue(ev, 'E07', vertical ? 'dogTrailNose' : 'dogTrailFeet', vertical ? 'dogSpinV' : 'dogSpinH', { text: vertical ? '犬・縦' : '犬・横', priority: 2 });
      }
      {
        // 払った方向の小さな矢印を添える（E08）。
        const name = String(d.name ?? '');
        const arrow = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][DIR8_NAMES.indexOf(name)] ?? '';
        return cue(ev, 'E08', 'shoulderTrail', name.includes('＋') ? 'bodyWhoosh2' : 'bodyWhoosh', { text: `${arrow} ${name}`.trim(), priority: 2 });
      }
    case 'trickHeld':
      return cue(ev, 'E09', 'twoTrails', 'compositeCue');
    case 'composite':
      return cue(ev, 'E09', 'twoTrails', 'compositeCue', { text: '複合', priority: 2 });
    case 'trickReject':
      return cue(ev, 'E10', d.air ? 'practiceHint' : 'traceFade', d.air ? 'hintSoft' : null);
    case 'land': {
      if (d.plain) return cue(ev, 'E13', 'sandRing', 'landSoft');
      const pts = Number(d.points ?? 0);
      const names = Array.isArray(d.names) ? d.names.join('＋') : '';
      if (d.composite) return cue(ev, 'E09', 'pawTrails', 'chord2', { text: `${names} ${pts > 0 ? `＋${pts}` : '（採点済みの区間）'}`, priority: 2 });
      if (d.tenths === 12) return cue(ev, 'E13', 'fourPaws', 'landPerfect', { text: `ぴたり ${pts > 0 ? `＋${pts}` : ''}`.trim(), priority: 2 });
      return cue(ev, 'E13', 'sandRing', 'landSoft', { text: pts > 0 ? `${names} ＋${pts}` : names, priority: 2 });
    }
    case 'landFail':
      return cue(ev, 'E14', 'underRotatedLabel', 'landBad', { text: d.reason === 'tilted' ? '足が傾いた' : '回転不足', priority: 1 });
    case 'collide':
      return cue(ev, 'E15', 'impactLines', 'thud', { text: 'ストップ', priority: 1 });
    case 'relaunch':
      return cue(ev, 'E15', 'brace', 'kick');
    case 'clear':
      return cue(ev, 'E11', 'edgePaw', 'tap', { footMark: '越えた' });
    case 'railOn':
      return cue(ev, 'E12', 'railDot', 'railOn');
    case 'railOff':
      return cue(ev, 'E12', 'railLineEnd', null);
    case 'railScore':
      return Number(d.points ?? 0) > 0
        ? cue(ev, 'E12', 'railSpark', 'confirm', { text: `手すり ${Math.floor(Number(d.distMm ?? 0) / 1000)}m ＋${d.points}`, priority: 2 })
        : cue(ev, 'E12', 'railLineEnd', null);
    case 'railLost':
      return cue(ev, 'E14', 'stumble', 'recover', { text: '手すり 0点', priority: 1 });
    case 'food':
      return cue(ev, 'E18', 'boostGauge', 'bag', { text: '加速 5秒', priority: 3 });
    case 'boostEnd':
      return cue(ev, 'E18', 'windLinesLong', 'downSoft');
    case 'poop':
      return cue(ev, 'E19', 'brownPrints', 'slip', { text: '減速', priority: 3 });
    case 'slowEnd':
      return cue(ev, 'E19', 'brownPrints', 'stepsBack');
    case 'guide':
      return cue(ev, 'E20', 'guidePrints', 'wood', { text: '道しるべ', priority: 3 });
    case 'fork':
      return cue(ev, d.trick ? 'E20' : 'E11', d.trick ? 'forkSign' : 'signSway', 'stepChoose', { footMark: String(d.label ?? '') });
    case 'merge':
      return cue(ev, 'E20', 'printsSettle', null);
    case 'guideClose':
      return cue(ev, 'E20', 'printsSettle', null);
    case 'checkpoint':
      return cue(ev, 'E17', 'flagUp', 'flag');
    case 'fall':
      return cue(ev, 'E17', 'fadeOut', 'fallDown', { text: '落下', priority: 1 });
    case 'respawn':
      return cue(ev, 'E17', 'respawnShow', 'respawn');
    case 'sectionScore':
      return cue(ev, 'E21', 'markFill', 'stepUp');
    case 'sectionMiss':
      return null;
    case 'streak':
      return cue(ev, 'E21', 'streakLabel', 'chord3', { text: '3区間連続 ＋100', priority: 2 });
    case 'gateLamp':
      return cue(ev, 'E16', 'lamp', 'bell');
    case 'gateRise':
    case 'gateFall':
      return cue(ev, 'E16', 'gateMove', 'mech');
    case 'pause':
      return cue(ev, 'E23', 'cover', 'ambientDown');
    case 'resume':
      return cue(ev, 'E23', 'reveal', 'ambientUp');
    case 'goal':
      return cue(ev, 'E24', 'tape', 'arrive', { text: 'ゴール', priority: 2 });
  }
  return null;
}

/** 画面の操作に付ける演出（計算の出来事ではないもの）。 */
export const UI_CUES = {
  select: { effect: 'E01', visual: 'tailWag', sound: 'select' },
  decide: { effect: 'E01', visual: 'pawCircle', sound: 'decide' },
  back: { effect: 'E01', visual: 'markRetract', sound: 'back' },
  demo: { effect: 'E22', visual: 'demoTrace', sound: 'demoBeat' },
  stamp: { effect: 'E22', visual: 'pawStamp', sound: 'stamp' },
  retry: { effect: 'E23', visual: 'resetPose', sound: 'readyCue' },
  reveal: { effect: 'E24', visual: 'breakdown', sound: 'tick' },
  best: { effect: 'E24', visual: 'bestPaw', sound: 'best3' },
  run: { effect: 'E03', visual: 'footprints', sound: 'stepsLoop' },
  turn: { effect: 'E04', visual: 'leanSand', sound: 'skid' },
} as const satisfies Record<string, { effect: EffectId; visual: string; sound: string }>;

/**
 * 同じ時期に起きた出来事のうち、中央に出す文字を1つ選ぶ。「停止・失敗」→「着地・技」→「アイテム」の順。
 * 同じ優先度なら、あとから起きた方。選ばれなかった文字は足元の印として残す。
 */
export function pickCenterText(cues: Cue[]): { text: string | null; priority: TextPriority | null; footMarks: string[] } {
  let best: Cue | null = null;
  for (const c of cues) {
    if (!c.text || !c.priority) continue;
    if (!best || c.priority < best.priority! || (c.priority === best.priority && c.atUs >= best.atUs)) best = c;
  }
  const footMarks = cues.filter((c) => c !== best && (c.text || c.footMark)).map((c) => c.footMark ?? c.text!);
  return { text: best?.text ?? null, priority: best?.priority ?? null, footMarks };
}

/** 中央の文字を、優先度と表示時間で管理する（新しい文字は、同じか高い優先度なら差し替える）。 */
export class CenterText {
  text: string | null = null;
  priority: TextPriority = 3;
  untilMs = 0;
  footMarks: { text: string; untilMs: number }[] = [];

  push(cues: Cue[], nowMs: number): void {
    const pick = pickCenterText(cues);
    if (pick.text && pick.priority) {
      const active = this.text !== null && nowMs < this.untilMs;
      if (!active || pick.priority <= this.priority) {
        if (active && this.text) this.footMarks.push({ text: this.text, untilMs: nowMs + 1800 });
        this.text = pick.text;
        this.priority = pick.priority;
        this.untilMs = nowMs + (pick.priority === 1 ? 1100 : 1300);
      } else {
        this.footMarks.push({ text: pick.text, untilMs: nowMs + 1800 });
      }
    }
    for (const f of pick.footMarks) if (f) this.footMarks.push({ text: f, untilMs: nowMs + 1500 });
    this.footMarks = this.footMarks.filter((f) => f.untilMs > nowMs).slice(-4);
  }

  current(nowMs: number): string | null {
    return nowMs < this.untilMs ? this.text : null;
  }
}
