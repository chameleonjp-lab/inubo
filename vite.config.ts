import { FREE_RULES_VERSION } from './src/game/rules';
import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const buildId = process.env.INUBO_BUILD_ID ?? 'local';
const officialUrl = process.env.VITE_OFFICIAL_URL?.trim();

function socialCard(publicUrl: string): Plugin {
  const url = new URL(publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`).href;
  const image = new URL('social-card.jpg', url).href;
  const title = 'イヌボー';
  const description = '犬に乗ってコースを駆け抜け、ジャンプと空中トリックでハイスコアを狙うブラウザゲーム。';
  const imageAlt = 'イヌボーのロゴと、犬の背に乗ったプレイヤーが公園のジャンプ台から飛び上がる場面。';
  const openGraph = {
    'og:type': 'website',
    'og:locale': 'ja_JP',
    'og:url': url,
    'og:title': title,
    'og:description': description,
    'og:image': image,
    'og:image:type': 'image/jpeg',
    'og:image:width': '1200',
    'og:image:height': '600',
    'og:image:alt': imageAlt,
  };
  const twitter = {
    'twitter:card': 'summary_large_image',
    'twitter:site': '@Chameleonjp26',
    'twitter:title': title,
    'twitter:description': description,
    'twitter:image': image,
    'twitter:image:alt': imageAlt,
  };

  return {
    name: 'social-card',
    apply: 'build',
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: url } },
        ...Object.entries(openGraph).map(([property, content]) => ({ tag: 'meta', attrs: { property, content } })),
        ...Object.entries(twitter).map(([name, content]) => ({ tag: 'meta', attrs: { name, content } })),
      ];
    },
  };
}

// base を相対にして、サブパス（例: https://example.com/inubo/）に置いても素材を読み込めるようにする。
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __FREE_SOURCE__: JSON.stringify(sourceCommit),
    __FREE_BUILD__: JSON.stringify(buildId),
  },
  plugins: [
    mode === 'production' && officialUrl ? socialCard(officialUrl) : false,
    mode === 'review' && { name: 'review-info', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'review-info.json', source: JSON.stringify({ sourceCommit, buildId, rulesVersion: FREE_RULES_VERSION, stage: 'interaction' }, null, 2) });
    } },
  ],
  build: {
    target: 'es2022',
    outDir: mode === 'review' ? 'dist-review' : mode === 'e2e' ? 'dist-e2e' : 'dist',
    sourcemap: false,
    // 大半は Three.js。1つのファイルで配信する。
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
