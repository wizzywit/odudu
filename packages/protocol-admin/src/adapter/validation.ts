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
// than refusing them — so the dialect has to be chosen explicitly. A tenant
// setting's value schema is a union (boolean, integer or text), which strict
// mode otherwise refuses to compile at all.
function instance(coerceTypes: boolean): Ajv2020 {
  return addFormats(
    new Ajv2020({ allErrors: false, strict: true, coerceTypes, allowUnionTypes: true }),
  );
}

// Fastify hands query and path parameters to ajv as strings regardless of
// the Zod type they were generated from, so a numeric schema there has to
// coerce rather than reject them outright. A JSON body carries its own
// types, and coercing those is loss rather than repair: `{"name": 123}`
// becomes the string "123" instead of a 400, and a union that puts
// `boolean` first turns the numbers 0 and 1 into `false` and `true`.
const coercing = instance(true);
const exact = instance(false);

export function compileSchema(schema: z.ZodType, httpPart?: string): ValidateFunction {
  const ajv = httpPart === 'body' || httpPart === undefined ? exact : coercing;
  return ajv.compile(z.toJSONSchema(schema));
}

export const adminValidatorCompiler: FastifySchemaCompiler<z.ZodType> = ({ schema, httpPart }) =>
  compileSchema(schema, httpPart);

/** ADR 0007: scoped to this plugin's encapsulation context, never the root instance. */
export function installAdminValidator(app: FastifyInstance): void {
  app.setValidatorCompiler(adminValidatorCompiler);
}
