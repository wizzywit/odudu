import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  dts: true,
  clean: true,
  sourcemap: true,
});
