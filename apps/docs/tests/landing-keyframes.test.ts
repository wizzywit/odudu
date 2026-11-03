import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { travelKeyframes } from '#docs/src/features/landing/services/sceneMotion.ts';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

describe('scripts/landing-keyframes.ts', () => {
  it('runs under plain Node, through the services folder self-reference, and writes travelKeyframes()', () => {
    execFileSync(process.execPath, ['--no-warnings', 'scripts/landing-keyframes.ts'], {
      cwd: DOCS_ROOT,
    });
    const written = readFileSync(
      path.join(DOCS_ROOT, 'src/features/landing/ui/Scene/travel.css'),
      'utf8',
    );
    expect(written).toBe(`${travelKeyframes()}\n`);
  });
});
