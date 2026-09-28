import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The gateway serves the build under /console/, from /app/console in the
// image. In development the gateway is the server on its default port.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/console/api': 'http://localhost:3000',
      '/console/auth': 'http://localhost:3000',
    },
  },
});
