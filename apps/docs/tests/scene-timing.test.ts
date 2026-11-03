import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_EASE } from '#docs/src/features/landing/services/sceneMotion.ts';
import { TIMING } from '#docs/src/features/landing/services/timing.ts';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const view = (file: string): string =>
  readFileSync(path.join(DOCS_ROOT, 'src/features/landing/ui', file), 'utf8');
const flow = view('SignInFlow/SignInFlow.module.css');
const controls = view('FlowControls/FlowControls.module.css');

// The stylesheets repeat the service's durations; these hold the two together.
describe('the scene durations in the stylesheets', () => {
  it('match the service', () => {
    expect(flow).toContain(`--scene-fade: ${String(TIMING.fadeMs)}ms;`);
    expect(flow).toContain(`--scene-draw: ${String(TIMING.drawMs)}ms;`);
    expect(flow).toContain(`--scene-ease: ${SCENE_EASE};`);
    expect(controls).toContain(`drift-out ${String(TIMING.leaveMs)}ms`);
    expect(controls).toContain(
      `rise-in ${String(TIMING.riseMs)}ms var(--scene-ease) ${String(TIMING.riseAfterTimedMs)}ms`,
    );
    expect(controls).toContain(
      `rise-in ${String(TIMING.riseMs)}ms var(--scene-ease) ${String(TIMING.riseAfterClickMs)}ms`,
    );
    expect(controls).toContain(`transform ${String(TIMING.fadeMs)}ms var(--scene-ease)`);
  });
});
