import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const buildId = process.env.INUBO_BUILD_ID ?? 'local';

// base を相対にして、サブパス（例: https://example.com/inubo/）に置いても素材を読み込めるようにする。
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __FREE_SOURCE__: JSON.stringify(sourceCommit),
    __FREE_BUILD__: JSON.stringify(buildId),
  },
  plugins: mode === 'review' ? [{ name: 'review-info', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'review-info.json', source: JSON.stringify({ sourceCommit, buildId, rulesVersion: 'rules-freestyle-1', stage: 'interaction' }, null, 2) });
  } }] : [],
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
