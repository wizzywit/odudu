import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildInstrument } from '#/service/build';

const PACKAGE = join(import.meta.dirname, '..');
const CONSOLE_VIEW = join(PACKAGE, '../../apps/admin-console/src/shared/ui');
const DIST = join(PACKAGE, 'dist');
const require = createRequire(join(PACKAGE, 'package.json'));

const [tokensCss, fontsCss, pagesCss] = await Promise.all([
  readFile(join(CONSOLE_VIEW, 'tokens.css'), 'utf8'),
  readFile(join(CONSOLE_VIEW, 'fonts.css'), 'utf8'),
  readFile(join(PACKAGE, 'src/pages.css'), 'utf8'),
]);

const wanted = [...fontsCss.matchAll(/url\('(@fontsource\/[^']+)'\)/gu)].map(
  (match) => match[1] ?? '',
);
const bytes = new Map(
  await Promise.all(
    [...new Set(wanted)].map(
      async (path) => [path, await readFile(require.resolve(path))] as const,
    ),
  ),
);

const { css, fonts } = buildInstrument({
  tokensCss,
  fontsCss,
  pagesCss,
  fontFile: (name) => {
    const found = bytes.get(name);
    if (found === undefined) throw new Error(`no font file for ${name}`);
    return found;
  },
});

await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, 'fonts'), { recursive: true });
await writeFile(join(DIST, 'instrument.css'), css);
await copyFile(join(PACKAGE, 'src/mark.svg'), join(DIST, 'mark.svg'));
await Promise.all(
  ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'].map((file) =>
    copyFile(join(PACKAGE, 'src', file), join(DIST, file)),
  ),
);
await Promise.all(
  [...fonts].map(([file, content]) => writeFile(join(DIST, 'fonts', file), content)),
);
process.stdout.write(
  `instrument: ${String(fonts.size)} fonts, ${String(css.length)} bytes of css\n`,
);
