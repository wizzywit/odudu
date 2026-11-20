import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2023',
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['next', /^next\//u],
});
