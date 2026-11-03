import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOBS, markupFor, renderedHash } from './shots.ts';

const manifest: Record<string, { hash?: string; width?: number; height?: number }> = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../../static/server-pages/manifest.json'),
    'utf8',
  ),
) as Record<string, { hash?: string; width?: number; height?: number }>;

describe('the pages strip on the landing', () => {
  it('has a capture for every page the renderers produce, and no other', () => {
    expect(Object.keys(manifest).sort()).toEqual(JOBS.map((job) => job.file).sort());
  });

  it.each(JOBS.map((job) => job.file))(
    '%s still matches what the server page renderer produces',
    (file) => {
      const job = JOBS.find((candidate) => candidate.file === file);
      if (job === undefined) throw new Error(`no job named ${file}`);
      expect(
        renderedHash(job),
        `${file} changed: the server page or its stylesheet is not what the landing page shows. Run pnpm page-shots and commit the pictures.`,
      ).toBe(manifest[file]?.hash);
    },
  );

  it('hashes two renders alike, though each draws its own script nonce', () => {
    const second = JOBS.find((job) => job.file === 'sign-in');
    if (second === undefined) throw new Error('no sign-in job');
    expect(markupFor(second, 'light')).not.toBe(markupFor(second, 'light'));
    expect(renderedHash(second)).toBe(renderedHash(second));
  });

  it('cuts the pictures of a group to one size, and the frames are that shape', () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, '../../src/features/landing/ui/Frame/Frame.module.css'),
      'utf8',
    );
    const ratio = (kind: string): string =>
      new RegExp(`\\.${kind} \\{\\s*aspect-ratio: ([^;]+);`, 'u').exec(css)?.[1] ?? '';
    const shape = (file: string): string =>
      `${String(manifest[file]?.width)} / ${String(manifest[file]?.height)}`;
    expect(shape('sign-in')).toBe(shape('create-account'));
    expect(shape('reset-password')).toBe(shape('second-factor'));
    expect(shape('look-odudu')).toBe(shape('look-other'));
    expect(ratio('large')).toBe(shape('sign-in'));
    expect(ratio('small')).toBe(shape('reset-password'));
    expect(ratio('look')).toBe(shape('look-odudu'));
  });
});
