import { z } from 'zod';

// Without this, building any schema probes `new Function`, which the shell's
// CSP reports as a `script-src` violation. It has to run before any module
// that builds a schema is evaluated. main.tsx imports it first, which holds
// only unbundled; the build puts it in zod's own chunk (vite.config.ts),
// which tests/lint/console-zod-chunk.test.ts checks. It imports only zod.
z.config({ jitless: true });
