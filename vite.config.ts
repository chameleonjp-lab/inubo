import { defineConfig } from 'vitest/config';

// base を相対にして、サブパス（例: https://example.com/inubo/）に置いても素材を読み込めるようにする。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    // 大半は Three.js。1つのファイルで配信する。
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
