/** 得点による5段階 × 空中の軌跡5系統 × 着地の光4系統 = 100通り。 */
export const TRICK_FX_MOTIONS = ['orbit', 'helix', 'cross', 'comet', 'crown'] as const;
export const TRICK_FX_BURSTS = ['sparks', 'rings', 'paws', 'stars'] as const;
export const TRICK_FX_TIERS = [1, 2, 3, 4, 5] as const;
export type TrickFxMotion = typeof TRICK_FX_MOTIONS[number];
export type TrickFxBurst = typeof TRICK_FX_BURSTS[number];
export type TrickFxTier = typeof TRICK_FX_TIERS[number];
export interface TrickFxVariant {
  id: string;
  tier: TrickFxTier;
  motion: TrickFxMotion;
  burst: TrickFxBurst;
  particleBudget: number;
}
export const TRICK_FX_100: readonly TrickFxVariant[] = TRICK_FX_TIERS.flatMap(tier =>
  TRICK_FX_MOTIONS.flatMap((motion, m) =>
    TRICK_FX_BURSTS.map((burst, b) => ({
      id: String((tier - 1) * 20 + m * 4 + b + 1).padStart(3, '0'),
      tier, motion, burst,
      // 端末向けに上限を決め、100種類分の画像や音を別々に読み込まない。
      particleBudget: Math.min(72, 6 + tier * 10 + b * 3),
    }))
  )
);
export function trickFxTier(points: number): TrickFxTier {
  if (points >= 850) return 5;
  if (points >= 650) return 4;
  if (points >= 400) return 3;
  if (points >= 200) return 2;
  return 1;
}
export function chooseTrickFx(points: number, name: string): TrickFxVariant {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  hash >>>= 0;
  const tier = trickFxTier(Math.max(0, points));
  // 同じ技・得点は常に同じ見た目。技名と得点が違えば軌跡・着地効果も変化する。
  const motion = Math.floor(hash % 5);
  const burst = Math.floor((Math.floor(hash / 5) + Math.floor(Math.max(0, points) / 25)) % 4);
  return TRICK_FX_100[(tier - 1) * 20 + motion * 4 + burst];
}
