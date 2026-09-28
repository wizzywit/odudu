import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway serves the build under /console/, from /app/console in the
// image. In development the dev server forwards the gateway's two routes
// to the running server, on :3000 unless ODUDU_CONSOLE_UPSTREAM names it.
const upstream = process.env.ODUDU_CONSOLE_UPSTREAM ?? 'http://localhost:3000';

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/console/api': upstream,
      '/console/auth': upstream,
    },
  },
});
