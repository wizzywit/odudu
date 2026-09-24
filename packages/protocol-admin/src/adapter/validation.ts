import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import * as ajvFormatsModule from 'ajv-formats';
import { type FormatsPlugin } from 'ajv-formats';
import { type FastifyInstance, type FastifySchemaCompiler } from 'fastify';
import { z } from 'zod';

// ajv-formats is CommonJS with no "exports" map, so under nodenext
// resolution TypeScript cannot type a default import, or the `default`
// property of a namespace import, as anything but the module namespace
// itself — which has no call signature. At runtime the namespace's
// `default` property is the plugin function (`exports.default =
// formatsPlugin` in the CJS source); this cast asserts that value's real
// type where TypeScript's static analysis cannot derive it.
const addFormats = ajvFormatsModule.default as unknown as FormatsPlugin;

// ajv 8's default export is draft-07; z.toJSONSchema emits 2020-12, and a
// draft-07 validator silently ignores the keywords it does not know rather
// than refusing them — so the dialect has to be chosen explicitly.
//
// Fastify hands query and path parameters to ajv as strings regardless of
// the Zod type they were generated from, so a numeric schema has to coerce
// rather than reject them outright.
const ajv = addFormats(new Ajv2020({ allErrors: false, strict: true, coerceTypes: true }));

export function compileSchema(schema: z.ZodType): ValidateFunction {
  return ajv.compile(z.toJSONSchema(schema));
}

export const adminValidatorCompiler: FastifySchemaCompiler<z.ZodType> = ({ schema }) =>
  compileSchema(schema);

/** ADR 0007: scoped to this plugin's encapsulation context, never the root instance. */
export function installAdminValidator(app: FastifyInstance): void {
  app.setValidatorCompiler(adminValidatorCompiler);
}
