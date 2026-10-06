import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';

// A component the compiler cannot compile fails the build, so none ships
// uncompiled (ADR 0041). The build and the DOM tests both use this. The
// first pattern is the plugin's own default exclusion, which naming one
// replaces; a test file is scaffolding, never shipped, and is left as written.
export function reactCompiler() {
  return babel({
    presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })],
    exclude: [/[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/, /\.test\.tsx?$/u],
  });
}
