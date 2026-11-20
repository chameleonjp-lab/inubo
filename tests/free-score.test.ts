undefined

test('3対象の実回転を挟む切替を高加点し、単なる切替連打には点を与えない', () => {
  const state = createFreeMotion();
  const inputs = [
    { seq: 1, atUs: 0, target: 'common' as const, rotation: [0, 0.8, 0] as Vec3 },
    { seq: 2, atUs: 200_000, target: 'dog' as const, rotation: [0, 0.8, 0] as Vec3 },
    { seq: 3, atUs: 400_000, target: 'rider' as const, rotation: [0, 0.8, 0] as Vec3 },
  ];
  advanceFreeMotion(state, 800_000, inputs);
  const scored = scoreFreeMotion(state.history, 800_000, 0, [...state.seen.values()]);
  expect(scored.switchCount).toBe(2);
  expect(scored.switchBonus).toBe(550);
  expect(scored.points).toBe(scored.basePoints + 550);
  expect(scored.label).toContain('切替2連携');
  const noBonus = scoreFreeMotion(state.history, 800_000, 0);
  expect(noBonus.switchBonus).toBe(0);
  const spam = inputs.map((input, i) => ({ ...input, atUs: i * 10_000, rotation: [0, 0.001, 0] as Vec3 }));
  expect(scoreFreeMotion(state.history, 800_000, 0, spam).switchBonus).toBe(0);
});
