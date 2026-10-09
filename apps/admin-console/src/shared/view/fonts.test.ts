import { expect, it } from 'vitest';
import fonts from '#/shared/view/fonts.css?raw';

interface Face {
  family: string | undefined;
  weight: string | undefined;
  src: string | undefined;
  range: string | undefined;
}

function faces(): Face[] {
  return [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/gu)].map(([, body = '']) => {
    const read = (property: string): string | undefined =>
      new RegExp(`${property}:\\s*([^;]+);`, 'u').exec(body)?.[1]?.replace(/\s+/gu, ' ').trim();
    return {
      family: read('font-family'),
      weight: read('font-weight'),
      src: read('src'),
      range: read('unicode-range'),
    };
  });
}

it('self-hosts Plex Sans and Mono in latin and latin-ext at 400, 500 and 600 alone', () => {
  const expected = ['sans', 'mono'].flatMap((family) =>
    ['latin', 'latin-ext'].flatMap((subset) =>
      ['400', '500', '600'].map(
        (weight) =>
          `url('@fontsource/ibm-plex-${family}/files/ibm-plex-${family}-${subset}-${weight}-normal.woff2') format('woff2')`,
      ),
    ),
  );
  expect(
    faces()
      .map((face) => face.src)
      .sort(),
  ).toEqual(expected.sort());
});

it('gives every face its family, weight and unicode range', () => {
  for (const face of faces()) {
    expect(face.family).toMatch(/^'IBM Plex (?:Sans|Mono)'$/u);
    expect(face.src).toContain(`-${face.weight ?? 'none'}-normal.woff2`);
    expect(face.src?.includes('plex-mono')).toBe(face.family === "'IBM Plex Mono'");
    expect(face.range).toMatch(/^U\+/u);
  }
});
