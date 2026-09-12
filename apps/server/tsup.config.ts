import { defineConfig } from 'tsup';

// Every native (non-pure-JS) dependency belongs here, and nowhere else.
// tsup's external-resolution plugin checks `noExternal` before `external`
// and stops at the first match (bundle-require's `match()`: a string
// matches by exact equality or `id.startsWith(p + '/')`), so anything this
// exclusion misses gets bundled regardless of what `external` says below —
// a hand-written regex that got one character wrong here would silently
// re-inline the package, and esbuild would only fail to build it if the
// platform-specific binary it requires happens not to exist for the
// machine running the build. Deriving `noExternal`'s exclusion from this
// same list, instead of hand-writing a second pattern that has to be kept
// in sync with it, makes that drift impossible: adding a second native
// dependency (e.g. a future `@node-rs/bcrypt`) means appending its
// specifier here ONCE, and both `noExternal` and `external` below pick it
// up automatically.
const nativeExternals = ['@node-rs/argon2'];

function escapeRegExp(specifier: string): string {
  return specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const bundleEverythingExcept = new RegExp(
  `^(?!(${nativeExternals.map(escapeRegExp).join('|')})($|/)).*$`,
);

export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  noExternal: [bundleEverythingExcept],
  external: nativeExternals,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
