import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // tsup's own external-resolution plugin checks `noExternal` before
  // `external` and treats a `noExternal` match as "stop looking, bundle
  // it" — so a blanket `[/.*/]` here made the `external` entry below dead
  // regardless of its contents (verified by reading
  // node_modules/tsup/dist/index.js's externalPlugin: the noExternal branch
  // returns before the external branch is ever reached). The carve-out
  // below is the same "bundle everything" rule with @node-rs/argon2's
  // specifier excluded, so `external` is the one that actually decides it.
  noExternal: [/^(?!@node-rs\/argon2($|\/)).*$/],
  external: ['@node-rs/argon2'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
