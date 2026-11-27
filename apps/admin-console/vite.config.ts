import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { reactCompiler } from './reactCompiler.ts';

// The gateway serves the build under /console/, from /app/console in the
// image. In development the dev server forwards the gateway's two routes, and
// the Instrument assets the shell's icons link to, to the running server, on
// :3000 unless ODUDU_CONSOLE_UPSTREAM names it.
const upstream = process.env.ODUDU_CONSOLE_UPSTREAM ?? 'http://localhost:3000';

export default defineConfig({
  base: '/console/',
  plugins: [react(), reactCompiler()],
  // gallery.html is a development-only page; the build reaches index.html alone.
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: 'index.html',
      // zod and its jitless setting share a chunk that imports nothing, so
      // the setting runs before any split chunk builds a schema (zodConfig.ts).
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'zod',
              // Not zod's mini build, which only the chat client of the assistant
              // panel uses, and which is wanted when the panel is opened.
              test: /[\\/]node_modules[\\/]zod[\\/](?!.*mini)|[\\/]src[\\/]zodConfig\.ts$/u,
            },
            {
              // The modal every dialog is drawn in. Left to the default split it
              // lands in the entry chunk or beside the shared page code
              // depending on how many pages import it, which moved the entry
              // past its budget when a list page was added.
              name: 'dialog',
              test: /[\\/]shared[\\/]ui[\\/](DialogFrame|dialogPresence)|react-aria-components[\\/]dist[\\/]private[\\/]Modal|react-aria[\\/]dist[\\/]private[\\/](overlays[\\/]useModalOverlay|utils[\\/]useViewportSize)/u,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/console/api': upstream,
      '/console/auth': upstream,
      '/instrument': upstream,
    },
  },
});
