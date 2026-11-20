import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogueText } from '#/generate';
import { CATALOGUE_FILE } from '#/location';

await writeFile(CATALOGUE_FILE, catalogueText());
console.log(`wrote ${path.relative(process.cwd(), CATALOGUE_FILE)}`);
