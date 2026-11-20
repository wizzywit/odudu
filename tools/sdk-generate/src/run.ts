import path from 'node:path';
import { generateAll } from '#/generate';
import { generatePython } from '#/python';

const root = path.resolve(import.meta.dirname, '../../..');
for (const file of await generateAll(root)) console.log(`wrote ${file}`);
const python = await generatePython(root);
console.log(`wrote ${String(python.files.length)} Python files`);
for (const warning of python.warnings) console.warn(`warning: ${warning}`);
