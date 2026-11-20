import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const markdown = readFileSync(new URL('../docs/2026-11-20-81-trick-visual-spec.md', import.meta.url), 'utf8');
const ids = [...markdown.matchAll(/^\| ([BHD])-([FAL])(\d{2}) \|/gm)].map(match => ({
  id: `${match[1]}-${match[2]}${match[3]}`,
  target: match[1],
  kind: match[2],
  level: Number(match[3]),
}));

test('派手さ10・空中軌跡7・着地10 × 3対象で81種類の独立した仕様IDが揃う', () => {
  expect(ids).toHaveLength(81);
  expect(new Set(ids.map(spec => spec.id)).size).toBe(81);
  for (const target of ['B', 'H', 'D']) {
    for (const [kind, count] of [['F', 10], ['A', 7], ['L', 10]] as const) {
      expect(ids.filter(spec => spec.target === target && spec.kind === kind).map(spec => spec.level).sort((a, b) => a - b))
        .toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  }
});

test('旧100通りの積ではなく81件を正本として明示する', () => {
  expect(markdown).toContain('27種類×3操作対象＝81種類');
  expect(markdown).toContain('10×7×10の組合せ数ではない');
});
