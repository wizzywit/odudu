import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    shared: 'src/shared.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  dts: true,
  clean: true,
  sourcemap: true,
});
