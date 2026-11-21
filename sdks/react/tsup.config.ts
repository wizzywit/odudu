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
  // React Server Components treat a module with this directive as one to ship
  // to the browser, which is what every export here is.
  banner: { js: "'use client';" },
});
