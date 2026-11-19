import { expect, test } from 'vitest';
import { resultCelebration } from '../src/ui/result-celebration';

test('0〜10,000点を30段階に分け、各段階で2種類の称号を使う', () => {
  const stages = new Map<number, Set<string>>();
  for (let total = 0; total <= 10_000; total++) {
    const result = resultCelebration(total);
    const stage = Math.min(30, 1 + Math.floor(total * 30 / 10_000));
    expect(result.stage).toBe(stage);
    expect(result.band).toBe(Math.ceil(stage / 5));
    expect(result.ornaments).toBe(stage);
    const titles = stages.get(stage) ?? new Set<string>();
    titles.add(result.title);
    stages.set(stage, titles);
  }
  expect(stages.size).toBe(30);
  expect([...stages.values()].map(titles => titles.size)).toEqual(Array(30).fill(2));
  expect(new Set([...stages.values()].flatMap(titles => [...titles])).size).toBe(60);
  expect(resultCelebration(166).title).toBe('公園のはじめの一歩');
  expect(resultCelebration(167).title).toBe('のんびり散歩隊');
  expect(resultCelebration(10_000).title).toBe('イヌボー・公園の大伝説');
});
