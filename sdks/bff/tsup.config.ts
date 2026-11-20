import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/adapter/express.ts',
    fastify: 'src/adapter/fastify.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2023',
  dts: true,
  clean: true,
  sourcemap: true,
});
