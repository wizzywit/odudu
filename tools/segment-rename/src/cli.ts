import { resolve } from 'node:path';
import { renameSegments } from '#/rename';

const MAPPING = { view: 'ui', usecase: 'use-cases', service: 'services' };

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const dry = args.includes('--dry');
const [root, aliasPrefix] = args.filter((arg) => arg !== '--dry');

if (root === undefined || aliasPrefix === undefined) {
  process.stderr.write('usage: rename [--dry] <root> <aliasPrefix>\n');
  process.exit(2);
}

const result = renameSegments(
  resolve(process.env.INIT_CWD ?? process.cwd(), root),
  aliasPrefix,
  MAPPING,
  { dry },
);
process.stdout.write(
  `${dry ? 'would move' : 'moved'} ${String(result.moved.length)} directories, ` +
    `${dry ? 'would rewrite' : 'rewrote'} ${String(result.rewritten.length)} files\n`,
);
