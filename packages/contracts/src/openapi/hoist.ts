type Json = Record<string, unknown>;

const COMPONENT_PREFIX = '#/components/schemas/';
const MIN_OCCURRENCES = 3;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shapeOf(node: Json): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(node).filter(([key]) => key !== 'description' && key !== '$schema'),
    ),
  );
}

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part !== '')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function operationHint(path: string, method: string, ignored: ReadonlySet<string>): string {
  const segments = path
    .split('/')
    .filter((part) => part !== '' && !part.startsWith('{') && !ignored.has(part));
  return `${pascal(segments.join('-'))}${pascal(method)}`;
}

// The values of these keywords are data, not schemas, so what looks like a
// schema inside one is left alone.
const LITERAL_KEYS: ReadonlySet<string> = new Set([
  'example',
  'examples',
  'default',
  'const',
  'enum',
]);

interface Candidate {
  readonly shape: string;
  readonly hint: string;
}

// Every object schema with named properties, in document order, with a name
// built from the operation and the property chain that leads to it.
function candidatesIn(node: unknown, hint: string, out: Candidate[]): void {
  if (Array.isArray(node)) {
    for (const child of node) candidatesIn(child, hint, out);
    return;
  }
  if (!isJson(node)) return;
  if ('properties' in node && isJson(node.properties)) {
    out.push({ shape: shapeOf(node), hint });
    for (const [name, child] of Object.entries(node.properties)) {
      candidatesIn(child, `${hint}${pascal(name)}`, out);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === 'properties' || LITERAL_KEYS.has(key)) continue;
    candidatesIn(child, key === 'items' ? `${hint}Item` : hint, out);
  }
}

function candidatesOfPaths(paths: Json, ignored: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    if (!isJson(methods)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      if (!isJson(operation)) continue;
      const base = operationHint(path, method, ignored);
      candidatesIn(operation.parameters, `${base}Parameter`, out);
      candidatesIn(operation.requestBody, `${base}Request`, out);
      candidatesIn(operation.responses, `${base}Response`, out);
    }
  }
  return out;
}

// `namesProperties` is true for the value of a `properties` keyword, whose keys
// are property names rather than keywords: one called `example` holds a schema.
function replace(node: unknown, shape: string, name: string, namesProperties = false): unknown {
  if (Array.isArray(node)) return node.map((child) => replace(child, shape, name));
  if (!isJson(node)) return node;
  if (!namesProperties && 'properties' in node && shapeOf(node) === shape) {
    return {
      $ref: `${COMPONENT_PREFIX}${name}`,
      ...(node.description === undefined ? {} : { description: node.description }),
    };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [
      key,
      !namesProperties && LITERAL_KEYS.has(key)
        ? child
        : replace(child, shape, name, !namesProperties && key === 'properties'),
    ]),
  );
}

function definitionFor(shape: string): Json {
  const parsed: unknown = JSON.parse(shape);
  return isJson(parsed) ? parsed : {};
}

function uniqueName(hint: string, taken: ReadonlySet<string>): string {
  if (!taken.has(hint)) return hint;
  let suffix = 2;
  while (taken.has(`${hint}${String(suffix)}`)) suffix += 1;
  return `${hint}${String(suffix)}`;
}

export interface Hoisted {
  readonly paths: Json;
  readonly schemas: Record<string, unknown>;
}

/**
 * Moves every object schema that occurs three or more times into
 * `components.schemas`, largest first so a repeated parent takes its repeated
 * children with it. A reference keeps the description the occurrence carried.
 * A component is named after the operation's path, less `ignoredSegments`.
 */
export function hoistRepeatedSchemas(
  paths: Json,
  schemas: Record<string, unknown>,
  ignoredSegments: readonly string[],
): Hoisted {
  const ignored = new Set(ignoredSegments);
  let currentPaths = paths;
  const currentSchemas = { ...schemas };
  // Each pass turns a shape of three or more occurrences into one definition, so
  // the loop ends after at most as many passes as the document has distinct shapes.
  for (;;) {
    const found = [...candidatesOfPaths(currentPaths, ignored)];
    for (const [key, body] of Object.entries(currentSchemas)) candidatesIn(body, key, found);
    const counts = new Map<string, { count: number; hint: string }>();
    for (const { shape, hint } of found) {
      const seen = counts.get(shape);
      counts.set(shape, { count: (seen?.count ?? 0) + 1, hint: seen?.hint ?? hint });
    }
    const [next] = [...counts]
      .filter(([, { count }]) => count >= MIN_OCCURRENCES)
      .sort((a, b) => b[0].length - a[0].length);
    if (next === undefined) return { paths: currentPaths, schemas: currentSchemas };
    const [shape, { hint }] = next;
    const name = uniqueName(hint, new Set(Object.keys(currentSchemas)));
    currentPaths = replace(currentPaths, shape, name) as Json;
    for (const [key, body] of Object.entries(currentSchemas)) {
      currentSchemas[key] = replace(body, shape, name);
    }
    currentSchemas[name] = definitionFor(shape);
  }
}
