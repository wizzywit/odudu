import { z } from 'zod';

// Without this, building any schema probes `new Function`, which the shell's
// CSP reports as a `script-src` violation. It has to run before any module
// that builds a schema is evaluated, so main.tsx imports it first.
z.config({ jitless: true });
