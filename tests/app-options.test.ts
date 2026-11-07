import { expect, test } from 'vitest';
import { readPlayOptions } from '../src/app-options';

test('本番は自動操縦・速度変更・デバッグ・模擬順位を有効にしない', () => {
  expect(readPlayOptions('?autoplay=trick&speed=20&debug=1&ranking=mock', false))
    .toEqual({ testBuild: false, autoplay: null, speed: 1, debug: false, mockRanking: false });
});

test('試験ビルドだけが既知のルート・模擬順位を使う', () => {
  expect(readPlayOptions('?autoplay=trick&speed=30&debug=1&ranking=mock', true))
    .toEqual({ testBuild: true, autoplay: 'trick', speed: 20, debug: true, mockRanking: true });
  expect(readPlayOptions('?autoplay=unknown&speed=12', true)).toMatchObject({ autoplay: null, speed: 1 });
});
