import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import * as ajvFormatsModule from 'ajv-formats';
import { type FormatsPlugin } from 'ajv-formats';
import { type FastifyInstance, type FastifySchemaCompiler } from 'fastify';
import { z } from 'zod';

// ajv-formats ships an `export default` in a CommonJS package, which
// TypeScript's nodenext resolution cannot unwrap to a callable type — the
// default-import binding types as the module namespace instead. The
// runtime value is a function; this is the accepted cast for that gap.
const addFormats = ajvFormatsModule as unknown as FormatsPlugin;

// ajv 8's default export is draft-07; z.toJSONSchema emits 2020-12, and a
// draft-07 validator silently ignores the keywords it does not know rather
// than refusing them — so the dialect has to be chosen explicitly.
const ajv = addFormats(new Ajv2020({ allErrors: false, strict: true }));

export function compileSchema(schema: z.ZodType): ValidateFunction {
  return ajv.compile(z.toJSONSchema(schema));
}

export const adminValidatorCompiler: FastifySchemaCompiler<z.ZodType> = ({ schema }) =>
  compileSchema(schema);

/** ADR 0007: scoped to this plugin's encapsulation context, never the root instance. */
export function installAdminValidator(app: FastifyInstance): void {
  app.setValidatorCompiler(adminValidatorCompiler);
}
