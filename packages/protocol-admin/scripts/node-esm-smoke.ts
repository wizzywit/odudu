// Vitest's CJS/ESM interop for `ajv-formats` differs from plain Node's, so
// a namespace-import bug in `../src/adapter/validation.ts` can compile,
// typecheck and pass every Vitest suite while throwing under `node
// dist/main.js` in the built container. This script loads the module the
// way Node resolves it — no test runner in between — and is the guard
// that catches that class of divergence.
import assert from 'node:assert/strict';
import { z } from 'zod';
import { compileSchema } from '#/adapter/validation';

const validate = compileSchema(z.object({ name: z.string() }));

assert.equal(validate({ name: 'acme' }), true, 'a valid document must validate');
assert.equal(validate({}), false, 'a document missing a required field must not validate');
console.log('node-esm-smoke: ajv-formats loads and compiles under Node resolution');
