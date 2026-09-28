import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway serves the build under /console/, from /app/console in the
// image. In development the dev server forwards the gateway's two routes
// to the running server, on :3000 unless ODUDU_CONSOLE_UPSTREAM names it.
const upstream = process.env.ODUDU_CONSOLE_UPSTREAM ?? 'http://localhost:3000';

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  // gallery.html is a development-only page; the build reaches index.html alone.
  build: { outDir: 'dist', rolldownOptions: { input: 'index.html' } },
  server: {
    proxy: {
      '/console/api': upstream,
      '/console/auth': upstream,
    },
  },
});
