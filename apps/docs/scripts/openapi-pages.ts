import type { OpenApiDocument } from '@odudu/protocol-admin/docs';
import {
  cell,
  code,
  codeCell,
  codeHtml,
  escapeProse,
  frontMatter,
  table,
  titleCase,
} from './markdown.ts';

type Json = Readonly<Record<string, unknown>>;

const PAGE_DIR = 'admin-api';
const MAX_DEPTH = 5;
// What the generator that wrote the document uses for an unbounded integer.
const SAFE_INTEGER = 9_007_199_254_740_991;
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

interface Row {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly details: string;
  readonly described: boolean;
  readonly patterns: readonly string[];
}

function typeOf(schema: Json): string {
  const type = schema.type;
  if (Array.isArray(type)) return list(type).map(scalar).join(' or ');
  if (typeof type === 'string') return type;
  if (schema.enum !== undefined) return 'enum';
  if (schema.const !== undefined) return 'constant';
  return 'any';
}

function variantsOf(schema: Json): readonly Json[] {
  return [...list(schema.anyOf), ...list(schema.oneOf)].flatMap((variant) => {
    const found = record(variant);
    return found === undefined ? [] : [found];
  });
}

function bound(label: string, value: unknown, unit?: string): string[] {
  if (typeof value !== 'number' || Math.abs(value) >= SAFE_INTEGER) return [];
  const noun = unit === undefined ? '' : ` ${value === 1 ? unit : `${unit}s`}`;
  return [`${label} ${String(value)}${noun}`];
}

// What a pattern says in words, for the patterns the contracts use. A pattern
// that is not here is printed as written, in a block after the operation.
const PATTERN_WORDS: readonly (readonly [test: (pattern: string) => boolean, words: string])[] = [
  [(pattern) => pattern === '^[^\\u0000]*$', ''],
  [
    (pattern) => pattern === '^[^\\u202A-\\u202E\\u2066-\\u2069]*$',
    'no bidirectional control characters',
  ],
  [(pattern) => /^\^\(?\[0-9a-fA-F\]\{8\}-/u.test(pattern), 'a UUID'],
  [(pattern) => pattern.startsWith('^(?:(?:\\d\\d[2468]'), 'an ISO 8601 date and time'],
];

const FORMAT_WORDS: Readonly<Record<string, string>> = {
  uuid: 'a UUID',
  'date-time': 'an ISO 8601 date and time',
  uri: 'an absolute URL',
  email: 'an email address',
};

function constraints(schema: Json, unknown: string[]): string[] {
  const found: string[] = [];
  const format = str(schema.format);
  const pattern = str(schema.pattern);
  const words = pattern === undefined ? undefined : PATTERN_WORDS.find(([test]) => test(pattern));
  const formatWords = format === undefined ? undefined : FORMAT_WORDS[format];
  if (format !== undefined && formatWords !== undefined) found.push(formatWords);
  else if (format !== undefined) found.push(`format ${code(format)}`);
  if (words !== undefined && words[1] !== '' && words[1] !== formatWords) found.push(words[1]);
  if (pattern !== undefined && words === undefined) {
    unknown.push(pattern);
    found.push('matching a pattern, listed below');
  }
  if (schema.enum !== undefined) {
    found.push(
      `one of ${list(schema.enum)
        .map((value) => code(scalar(value)))
        .join(', ')}`,
    );
  }
  if (schema.const !== undefined) found.push(`always ${code(scalar(schema.const))}`);
  found.push(
    ...bound('at least', schema.minimum),
    ...bound('at most', schema.maximum),
    ...bound('at least', schema.minLength, 'character'),
    ...bound('at most', schema.maxLength, 'character'),
    ...bound('at least', schema.minItems, 'item'),
    ...bound('at most', schema.maxItems, 'item'),
  );
  if (schema.default !== undefined) found.push(`default ${code(scalar(schema.default))}`);
  if (schema.additionalProperties === true || record(schema.additionalProperties) !== undefined) {
    const extra = record(schema.additionalProperties);
    if (extra === undefined || Object.keys(extra).length === 0) found.push('other fields accepted');
  }
  return found;
}

const OPENAPI_LINK = '[OpenAPI document](pathname:///openapi/admin.json)';

function sentence(text: string): string {
  return /[.!?:)`]$/u.test(text) ? text : `${text}.`;
}

function detailsOf(schema: Json, unknown: string[], truncated = false): string {
  const description = str(schema.description);
  const limits = constraints(schema, unknown);
  const parts = [
    ...(description === undefined ? [] : [sentence(escapeProse(description.trim()))]),
    ...(limits.length === 0 ? [] : [`Constraints: ${limits.join(', ')}.`]),
    ...(truncated ? [`The fields inside are not listed here; the ${OPENAPI_LINK} has them.`] : []),
  ];
  return parts
    .join(' ')
    .replace(/\s*\n\s*/gu, ' ')
    .replaceAll('|', '\\|');
}

// A nullable field is an `anyOf` of the field and `null`.
function unwrapNullable(schema: Json): { schema: Json; nullable: boolean } {
  const variants = variantsOf(schema);
  const others = variants.filter((variant) => variant.type !== 'null');
  const [only] = others;
  if (others.length === 1 && only !== undefined && others.length < variants.length) {
    const description = str(schema.description);
    return {
      schema:
        description === undefined || str(only.description) !== undefined
          ? only
          : { ...only, description },
      nullable: true,
    };
  }
  return { schema, nullable: false };
}

function describeType(schema: Json, nullable: boolean): string {
  const variants = variantsOf(schema);
  const base =
    variants.length > 1
      ? [...new Set(variants.map(typeOf))].join(' or ')
      : schema.type === 'array'
        ? `array of ${typeOf(record(schema.items) ?? {})}`
        : typeOf(schema);
  return nullable ? `${base} or null` : base;
}

function collect(
  schema: Json,
  path: string,
  required: boolean,
  depth: number,
  rows: Row[],
  root: OpenApiDocument,
  unknown: string[],
  seen: Map<string, string>,
): void {
  const ref = refOf(schema);
  const unwrapped = unwrapNullable(resolveRef(schema, root));
  const inner = resolveRef(unwrapped.schema, root);
  const nullable = unwrapped.nullable;
  const properties = record(inner.properties);
  const items = record(inner.items);
  const isObject = properties !== undefined;

  const hasChildren =
    isObject || (items !== undefined && record(resolveRef(items, root).properties) !== undefined);
  const truncated = depth >= MAX_DEPTH && hasChildren;
  if (path !== '' || !isObject) {
    const own: string[] = [];
    rows.push({
      path: path === '' ? '(body)' : path,
      type: describeType(inner, nullable),
      required,
      details: detailsOf(inner, own, truncated),
      described: (str(inner.description) ?? '').trim() !== '',
      patterns: own,
    });
    unknown.push(...own);
  }
  // A shape named by a component is listed where it first occurs.
  if (ref !== undefined && path !== '') {
    const first = seen.get(ref);
    if (first !== undefined) {
      const last = rows.at(-1);
      if (last !== undefined) {
        const details = `${last.details} The same fields as ${code(first)}, not listed again.`;
        rows[rows.length - 1] = { ...last, details: details.trim() };
      }
      return;
    }
    seen.set(ref, path);
  }
  if (depth >= MAX_DEPTH) return;
  if (isObject) {
    const requiredNames = new Set(list(inner.required).map(scalar));
    for (const [name, property] of Object.entries(properties)) {
      const child = record(property) ?? {};
      collect(
        child,
        path === '' ? name : `${path}.${name}`,
        requiredNames.has(name),
        depth + 1,
        rows,
        root,
        unknown,
        seen,
      );
    }
  } else if (items !== undefined && record(resolveRef(items, root).properties) !== undefined) {
    collect(items, `${path === '' ? '' : path}[]`, true, depth + 1, rows, root, unknown, seen);
  }
}

function resolveRef(schema: Json, root: OpenApiDocument): Json {
  const ref = str(schema.$ref);
  const prefix = '#/components/schemas/';
  if (ref?.startsWith(prefix) !== true) return schema;
  const target = record((root.components.schemas as Json)[ref.slice(prefix.length)]);
  if (target === undefined) return schema;
  const description = str(schema.description);
  return description === undefined ? target : { ...target, description };
}

// The name of the component a field refers to, however it is wrapped in a
// nullable `anyOf`.
function refOf(schema: Json): string | undefined {
  const direct = str(schema.$ref);
  if (direct !== undefined) return direct;
  const named = variantsOf(schema).map((variant) => str(variant.$ref));
  return named.find((name) => name !== undefined);
}

export function fieldRows(schema: Json, root: OpenApiDocument, unknown: string[]): Row[] {
  const rows: Row[] = [];
  collect(schema, '', true, 0, rows, root, unknown, new Map());
  return rows;
}

function rowsTable(rows: readonly Row[]): string {
  return table(
    ['Field', 'Type', 'Required', 'Details'],
    rows.map((row) => [
      codeCell(row.path),
      cell(row.type),
      row.required ? 'yes' : 'no',
      row.details,
    ]),
  );
}

function schemaTable(schema: Json, root: OpenApiDocument, unknown: string[]): string {
  return rowsTable(fieldRows(schema, root, unknown));
}

interface Parameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly description: string | undefined;
  readonly schema: Json;
}

export function parametersOf(operation: Json, root: OpenApiDocument): Parameter[] {
  return list(operation.parameters).flatMap((entry) => {
    const found = record(entry);
    if (found === undefined) return [];
    const ref = str(found.$ref);
    const prefix = '#/components/parameters/';
    const parameter =
      ref?.startsWith(prefix) === true
        ? record((root.components.parameters as Json)[ref.slice(prefix.length)])
        : found;
    const name = str(parameter?.name);
    if (parameter === undefined || name === undefined) return [];
    return [
      {
        name,
        in: str(parameter.in) ?? 'query',
        required: parameter.required === true,
        description: str(parameter.description),
        schema: record(parameter.schema) ?? {},
      },
    ];
  });
}

function parameterTable(parameters: readonly Parameter[], unknown: string[]): string {
  return table(
    ['Name', 'Type', 'Required', 'Details'],
    parameters.map((parameter) => {
      const { schema, nullable } = unwrapNullable(parameter.schema);
      const details = detailsOf(
        {
          ...schema,
          ...(parameter.description === undefined ? {} : { description: parameter.description }),
        },
        unknown,
      );
      return [
        codeCell(parameter.name),
        cell(describeType(schema, nullable)),
        parameter.required ? 'yes' : 'no',
        details,
      ];
    }),
  );
}

function examplesOf(media: Json): string[] {
  const schema = record(media.schema);
  const values: unknown[] = [];
  if (media.example !== undefined) values.push(media.example);
  for (const example of Object.values(record(media.examples) ?? {})) {
    const value = record(example)?.value;
    if (value !== undefined) values.push(value);
  }
  values.push(...list(schema?.examples));
  return values.map((value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

// A body with more fields than this, or one that would take the operation's
// page past it, is listed on pages of its own, so that no page carries more
// table than a browser lays out in one piece.
const MAX_TABLE_ROWS = 60;

interface Part {
  readonly slug: string;
  readonly heading: string;
  readonly rows: readonly Row[];
  readonly mediaType: string;
  readonly patterns: readonly string[];
}

interface Context {
  readonly root: OpenApiDocument;
  readonly problemLink: string;
  readonly unknown: string[];
  readonly slug: string;
  readonly parts: Part[];
  readonly level: number;
  // Rows already listed inline on this operation's page.
  readonly inline: { rows: number };
}

function topLevel(row: Row): string {
  return /^[^.[]*/u.exec(row.path)?.[0] ?? row.path;
}

// Rows are kept together by their top-level field, so a field and what is
// inside it are never on different pages.
function chunkRows(rows: readonly Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(topLevel(row));
    if (group === undefined) groups.set(topLevel(row), [row]);
    else group.push(row);
  }
  const chunks: Row[][] = [];
  for (const group of groups.values()) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + group.length <= MAX_TABLE_ROWS) last.push(...group);
    else chunks.push([...group]);
  }
  return chunks;
}

function partLines(
  ctx: Context,
  section: string,
  heading: string,
  mediaType: string,
  rows: readonly Row[],
): string[] {
  const chunks = chunkRows(rows);
  const links: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const slug = `${ctx.slug}-${section}-part-${String(index + 1)}`;
    ctx.parts.push({
      slug,
      heading:
        chunks.length === 1
          ? heading
          : `${heading}, part ${String(index + 1)} of ${String(chunks.length)}`,
      rows: chunk,
      mediaType,
      patterns: chunk.flatMap((row) => row.patterns),
    });
    const names = [...new Set(chunk.map(topLevel))].map((name) => code(name)).join(', ');
    links.push(`- [${names}](./${slug}.md)`);
  }
  return [
    chunks.length === 1
      ? `The body has ${String(rows.length)} fields, listed on a page of its own:`
      : `The body has ${String(rows.length)} fields, listed on ${String(chunks.length)} pages, grouped by the top-level field they belong to:`,
    '',
    ...links,
  ];
}

function mediaBlock(
  ctx: Context,
  section: string,
  heading: string,
  mediaType: string,
  media: Json,
): string[] {
  if (mediaType === 'application/problem+json') {
    return [
      `Body: ${code(mediaType)}, an RFC 9457 problem document described under [problem details](${ctx.problemLink}).`,
    ];
  }
  const schema = record(media.schema);
  const rows = schema === undefined ? [] : fieldRows(schema, ctx.root, []);
  const split = ctx.inline.rows + rows.length > MAX_TABLE_ROWS;
  if (!split) ctx.inline.rows += rows.length;
  const listing = split ? partLines(ctx, section, heading, mediaType, rows) : [rowsTable(rows)];
  if (!split) ctx.unknown.push(...rows.flatMap((row) => row.patterns));
  return [
    `Body: ${code(mediaType)}`,
    ...(schema === undefined ? [] : ['', ...listing]),
    ...examplesOf(media).flatMap((example) => ['', example]),
  ];
}

function responseBlocks(operation: Json, ctx: Context): string[] {
  const lines: string[] = [];
  for (const [status, response] of Object.entries(record(operation.responses) ?? {})) {
    const found = record(response) ?? {};
    const description = str(found.description) ?? '';
    lines.push(`${'#'.repeat(ctx.level + 1)} ${status} ${escapeProse(description)}`.trimEnd(), '');
    const content = Object.entries(record(found.content) ?? {});
    if (content.length === 0) lines.push('No body.', '');
    for (const [mediaType, media] of content) {
      const heading = `${status} response body`;
      lines.push(...mediaBlock(ctx, status, heading, mediaType, record(media) ?? {}), '');
    }
  }
  return lines;
}

// A pattern the generator cannot put in words is shown as the contract states it.
function patternBlock(patterns: readonly string[]): string {
  // No list tags: the agent copies strip block tags, and a copy that differs
  // from its source in what it says is refused.
  return [
    '<details>',
    '<summary>Patterns this operation applies</summary>',
    ...[...new Set(patterns)].map((pattern) => codeHtml(pattern)),
    '</details>',
    '',
  ].join('\n');
}

function operationBody(operation: Json, ctx: Context): string {
  const heading = '#'.repeat(ctx.level);
  const lines: string[] = [];
  const summary = str(operation.summary);
  if (summary !== undefined) lines.push(escapeProse(summary), '');
  const description = str(operation.description);
  if (description !== undefined) lines.push(escapeProse(description), '');

  const parameters = parametersOf(operation, ctx.root);
  for (const [place, label] of [
    ['path', 'Path parameters'],
    ['query', 'Query parameters'],
  ] as const) {
    const ofPlace = parameters.filter((parameter) => parameter.in === place);
    if (ofPlace.length > 0) {
      lines.push(`${heading} ${label}`, '', parameterTable(ofPlace, ctx.unknown), '');
    }
  }

  const body = record(operation.requestBody);
  if (body !== undefined) {
    lines.push(`${heading} Request body`, '');
    for (const [mediaType, media] of Object.entries(record(body.content) ?? {})) {
      lines.push(...mediaBlock(ctx, 'request', 'Request body', mediaType, record(media) ?? {}), '');
    }
  }

  lines.push(`${heading} Responses`, '', ...responseBlocks(operation, ctx));
  if (ctx.unknown.length > 0) lines.push(patternBlock(ctx.unknown));
  return lines.join('\n').replace(/\n+$/u, '\n');
}

export interface Coverage {
  readonly described: number;
  readonly total: number;
}

// The fields a reader of an operation meets: its query parameters, its request
// body and the body of its success response, and how many carry a description.
function coverageOf(operation: Json, root: OpenApiDocument): Coverage {
  const rows: boolean[] = [];
  const sink: string[] = [];
  for (const parameter of parametersOf(operation, root)) {
    if (parameter.in !== 'query') continue;
    rows.push((parameter.description ?? str(parameter.schema.description) ?? '').trim() !== '');
  }
  const schemas: Json[] = [];
  for (const media of Object.values(record(record(operation.requestBody)?.content) ?? {})) {
    const schema = record(record(media)?.schema);
    if (schema !== undefined) schemas.push(schema);
  }
  for (const [status, response] of Object.entries(record(operation.responses) ?? {})) {
    if (!status.startsWith('2')) continue;
    for (const [mediaType, media] of Object.entries(record(record(response)?.content) ?? {})) {
      const schema = record(record(media)?.schema);
      if (schema !== undefined && mediaType !== 'application/problem+json') schemas.push(schema);
    }
  }
  for (const schema of schemas) {
    for (const row of fieldRows(schema, root, sink)) {
      if (row.path !== '(body)' && !row.path.endsWith('[]')) rows.push(row.described);
    }
  }
  return { described: rows.filter(Boolean).length, total: rows.length };
}

export function coverageOfArea(
  operations: readonly { readonly operation: Json }[],
  root: OpenApiDocument,
): Coverage {
  return operations.reduce<Coverage>(
    (sum, { operation }) => {
      const found = coverageOf(operation, root);
      return { described: sum.described + found.described, total: sum.total + found.total };
    },
    { described: 0, total: 0 },
  );
}

export function coverageLine(coverage: Coverage): string {
  const percent =
    coverage.total === 0 ? 100 : Math.floor((100 * coverage.described) / coverage.total);
  return `Documentation coverage: ${String(coverage.described)} of ${String(coverage.total)} fields described (${String(percent)}%).`;
}

// A subject has enough calls to make one page too heavy to read and to
// scroll, so what hangs off one is split by what a reader is doing.
const SUBJECT_AREAS: Readonly<Record<string, string>> = {
  profile: 'subjects',
  credentials: 'subject-sign-in',
  password: 'subject-sign-in',
  'password-reset': 'subject-sign-in',
  verification: 'subject-sign-in',
  'actions-email': 'subject-sign-in',
  lockout: 'subject-sign-in',
  'recovery-codes': 'subject-sign-in',
  'required-actions': 'subject-sign-in',
  roles: 'subject-access',
  'effective-roles': 'subject-access',
  'admin-capabilities': 'subject-access',
  groups: 'subject-access',
  consents: 'subject-sessions',
  sessions: 'subject-sessions',
  grants: 'subject-sessions',
};

function subjectArea(id: string | undefined, resource: string | undefined, path: string): string {
  if (id === undefined || !id.startsWith('{') || resource === undefined) return 'subjects';
  const area = SUBJECT_AREAS[resource];
  if (area === undefined) {
    throw new Error(
      `${path} has no page: add ${resource} to SUBJECT_AREAS (subjects, subject-sign-in, subject-access or subject-sessions)`,
    );
  }
  return area;
}

export function areaOf(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  const [, first, second, third] = parts;
  if (first === 'tenant-imports') return 'tenants';
  if (first === 'tenants') {
    if (second === undefined || second === 'count') return 'tenants';
    if (second.startsWith('{')) {
      if (third === 'subjects') return subjectArea(parts[4], parts[5], path);
      return third === undefined || third === 'export' ? 'tenants' : third;
    }
  }
  return first ?? 'other';
}

interface Operation {
  readonly method: string;
  readonly path: string;
  readonly operation: Json;
}

export function operationsOf(doc: OpenApiDocument): Map<string, Operation[]> {
  const areas = new Map<string, Operation[]>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    const ordered = Object.entries(methods).sort(
      ([a], [b]) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b),
    );
    for (const [method, operation] of ordered) {
      const area = areaOf(path);
      areas.set(area, [
        ...(areas.get(area) ?? []),
        { method, path, operation: record(operation) ?? {} },
      ]);
    }
  }
  return areas;
}

// How a reader says an area, where the folder name is not it.
const AREA_TITLES: Readonly<Record<string, string>> = {
  'subject-sign-in': 'Subject sign-in',
  'subject-access': 'Subject access',
  'subject-sessions': 'Subject sessions',
};
const AREA_SUBJECTS: Readonly<Record<string, string>> = {
  'subject-sign-in': "a subject's sign-in",
  'subject-access': "a subject's access",
  'subject-sessions': "a subject's sessions",
};

function titleOf(area: string): string {
  return AREA_TITLES[area] ?? titleCase(area);
}

// The path a reader sees under an area: what follows the tenant.
function tailOf(path: string): readonly string[] {
  const parts = path.split('/').filter((part) => part !== '');
  const [, ...rest] = parts;
  const [first, second, ...after] = rest;
  if (first === 'tenants' && second === '{tenant}' && after.length > 0) return after;
  return rest;
}

export function operationSlug(method: string, path: string): string {
  const words = tailOf(path).map((part) =>
    part
      .replace(/^\{(.+)\}$/u, '$1')
      .replace(/([a-z])([A-Z])/gu, '$1-$2')
      .toLowerCase(),
  );
  return [method, ...words].join('-');
}

function operationShort(method: string, path: string): string {
  return `${method.toUpperCase()} /${tailOf(path).join('/')}`;
}

function capabilityOf(operation: Json): string {
  return str(operation.summary) ?? 'Requires an authenticated admin caller.';
}

// A page holds operations up to this many table rows; an operation larger
// than that has a page to itself.
const MAX_PAGE_ROWS = 60;

interface Section {
  readonly operation: Operation;
  readonly text: string;
  readonly rows: number;
  readonly parts: readonly Part[];
}

function sectionOf(operation: Operation, doc: OpenApiDocument): Section {
  const { method, path } = operation;
  const ctx: Context = {
    root: doc,
    problemLink: '../index.md#problem-details',
    unknown: [],
    slug: operationSlug(method, path),
    parts: [],
    level: 3,
    inline: { rows: 0 },
  };
  const text = `## ${method.toUpperCase()} ${path}\n\n${operationBody(operation.operation, ctx)}`;
  const rows = text.split('\n').filter((line) => line.startsWith('| ')).length;
  return { operation, text, rows, parts: ctx.parts };
}

function pack(sections: readonly Section[]): Section[][] {
  const groups: Section[][] = [];
  for (const section of sections) {
    const last = groups.at(-1);
    const used = last?.reduce((sum, found) => sum + found.rows, 0) ?? 0;
    if (last !== undefined && used + section.rows <= MAX_PAGE_ROWS) last.push(section);
    else groups.push([section]);
  }
  return groups;
}

// The id the site gives a heading: lower case, punctuation dropped, spaces dashed.
function anchorOf({ method, path }: Operation): string {
  return `${method.toUpperCase()} ${path}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replaceAll(' ', '-');
}

function describeArea(area: string, operations: readonly Operation[]): string {
  const noun = operations.length === 1 ? 'operation' : 'operations';
  const subject = AREA_SUBJECTS[area] ?? area.replaceAll('-', ' ');
  return (
    `${String(operations.length)} ${noun} of the Odudu admin API on ${subject}, ` +
    'each with its method, path, required capability, parameters, request body and responses.'
  );
}

const BEARER =
  'Every request carries a bearer token; the [admin API overview](../index.md) says which audience it needs and how a refusal is shaped.';

function addParts(
  pages: Map<string, string>,
  group: readonly Section[],
  target: string,
  position: number,
  label: string,
): void {
  const where = `in the [${label}](./index.md) area of the [admin API](../index.md)`;
  for (const section of group) {
    for (const [number, part] of section.parts.entries()) {
      const { method, path } = section.operation;
      const short = operationShort(method, path);
      const heading = `${short}: ${part.heading}`;
      pages.set(
        part.slug,
        [
          frontMatter(
            `Admin API: ${heading}`,
            `One page of the fields of ${short} in the Odudu admin API (${label}): its ${part.heading}.`,
            { sidebar_position: position + (number + 1) / 100 },
          ),
          `# Admin API: ${heading}`,
          '',
          `The fields of one body of [${code(`${method.toUpperCase()} ${path}`)}](./${target}.md#${anchorOf(section.operation)}), ${where}.`,
          '',
          `Body: ${code(part.mediaType)}`,
          '',
          rowsTable(part.rows),
          '',
          ...(part.patterns.length > 0 ? [patternBlock(part.patterns)] : []),
        ].join('\n'),
      );
    }
  }
}

function areaPages(
  area: string,
  operations: readonly Operation[],
  doc: OpenApiDocument,
): Map<string, string> {
  const label = titleOf(area);
  const subject = AREA_SUBJECTS[area] ?? area.replaceAll('-', ' ');
  const sections = operations.map((operation) => sectionOf(operation, doc));
  const groups = pack(sections);
  const footer = `${coverageLine(coverageOfArea(operations, doc))}\n`;
  const pages = new Map<string, string>();
  if (groups.length === 1) {
    pages.set(
      'index',
      [
        frontMatter(`Admin API: ${label}`, describeArea(area, operations)),
        `# Admin API: ${label}`,
        '',
        `Operations on ${subject} in the ${doc.info.title}, one section each. ${BEARER}`,
        '',
        sections.map((section) => section.text).join('\n'),
        footer,
      ].join('\n'),
    );
    addParts(pages, sections, 'index', 0, label);
    return pages;
  }
  const where = `in the [${label}](./index.md) area of the [admin API](../index.md)`;
  const items: string[] = [];
  for (const [index, group] of groups.entries()) {
    const name = `part-${String(index + 1)}`;
    const title = `Admin API: ${label} (${String(index + 1)} of ${String(groups.length)})`;
    const first = group[0]?.operation;
    const last = group.at(-1)?.operation;
    if (first === undefined || last === undefined) continue;
    for (const { operation } of group) {
      const { method, path } = operation;
      items.push(
        `- [${code(`${method.toUpperCase()} ${path}`)}](./${name}.md#${anchorOf(operation)}): ${escapeProse(capabilityOf(operation.operation))}`,
      );
    }
    pages.set(
      name,
      [
        frontMatter(
          title,
          `Part ${String(index + 1)} of ${String(groups.length)} of the Odudu admin API on ${subject}: ${String(group.length)} ${group.length === 1 ? 'operation' : 'operations'} with parameters, bodies and responses.`,
          { sidebar_position: index + 1 },
        ),
        `# ${title}`,
        '',
        `Operations on ${subject}, ${where}. ${BEARER}`,
        '',
        group.map((section) => section.text).join('\n'),
      ].join('\n'),
    );
    addParts(pages, group, name, index + 1, label);
  }
  pages.set(
    'index',
    [
      frontMatter(`Admin API: ${label}`, describeArea(area, operations)),
      `# Admin API: ${label}`,
      '',
      `Operations on ${subject} in the ${doc.info.title}, listed here and described on ${String(groups.length)} pages. ${BEARER}`,
      '',
      '## Operations',
      '',
      ...items,
      '',
      footer,
    ].join('\n'),
  );
  return pages;
}

function indexPage(areas: ReadonlyMap<string, readonly Operation[]>, doc: OpenApiDocument): string {
  const scheme = record(doc.components.securitySchemes.bearerAuth);
  const tenant = record(doc.components.parameters.tenant);
  const total = [...areas.values()].reduce((sum, operations) => sum + operations.length, 0);
  const lines = [
    frontMatter(
      'Admin API',
      `The Odudu admin API: ${String(total)} operations over HTTP and JSON, grouped by area, with authentication and the shape of an error.`,
    ),
    '# Admin API',
    '',
    `${escapeProse(doc.info.title)}. Every operation is a JSON request ` +
      `under \`/admin/tenants\`. The pages are generated from the OpenAPI document the server ` +
      `itself serves at \`/admin/openapi.json\`, so they list exactly the routes the build serves.`,
    '',
    '## Authentication',
    '',
    escapeProse(str(scheme?.description) ?? 'Send a bearer token.'),
    '',
    `Each operation names the capability it needs. A caller without it is refused with \`403\`; a missing or wrong token with \`401\`.`,
    '',
    'Text values in a request may not contain the NUL character.',
    '',
    '## The tenant in the path',
    '',
    escapeProse(str(tenant?.description) ?? ''),
    '',
    '## Areas',
    '',
    ...[...areas].map(
      ([area, operations]) =>
        `- [${titleOf(area)}](./${area}/index.md): ${String(operations.length)} ${operations.length === 1 ? 'operation' : 'operations'}.`,
    ),
    '',
    '## Problem details',
    '',
    'A refusal is an `application/problem+json` document (RFC 9457) with these fields.',
    '',
    schemaTable(record(doc.components.schemas.ProblemDetails) ?? {}, doc, []),
    '',
  ];
  return lines.join('\n');
}

export function adminApiAreas(
  doc: OpenApiDocument,
): readonly (readonly [area: string, label: string])[] {
  return [...operationsOf(doc).keys()].map(
    (area) => [area, `Admin API: ${titleOf(area)}`] as const,
  );
}

// An index, then per area either one page or an index and pages that hold
// operations up to a table size, as Markdown by path relative to the generated
// reference directory.
export function renderOpenApiPages(doc: OpenApiDocument): ReadonlyMap<string, string> {
  const areas = operationsOf(doc);
  const pages = new Map<string, string>([[`${PAGE_DIR}/index.md`, indexPage(areas, doc)]]);
  for (const [area, operations] of areas) {
    for (const [name, page] of areaPages(area, operations, doc)) {
      pages.set(`${PAGE_DIR}/${area}/${name}.md`, page);
    }
  }
  return new Map([...pages].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
