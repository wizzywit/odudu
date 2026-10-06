import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';

// A component the compiler cannot compile fails the build, so none ships
// uncompiled (ADR 0041). The build and the DOM tests both use this; a test
// file is scaffolding, never shipped, and is left as written.
export function reactCompiler() {
  return babel({
    presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })],
    exclude: /\.test\.tsx?$/u,
  });
}
