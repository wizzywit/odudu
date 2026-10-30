import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '@odudu/protocol-admin';
import { buildAdminOpenApiDocument, type OpenApiDocument } from '@odudu/protocol-admin/docs';
import {
  areaOf,
  operationSlug,
  operationsOf,
  parametersOf,
  renderOpenApiPages,
} from './openapi-pages.ts';

const document = buildAdminOpenApiDocument();
const pages = renderOpenApiPages(document);

function operationHeading(method: string, pattern: string): string {
  return `## ${method} ${pattern.replace(/:(\w+)/gu, '{$1}')}`;
}

// The text of an operation's section, wherever the area put it.
function sectionText(area: string, method: string, path: string): string {
  const heading = `\n${operationHeading(method.toUpperCase(), path)}\n`;
  for (const [name, page] of pages) {
    const start = page.indexOf(heading);
    if (!name.startsWith(`admin-api/${area}/`) || start === -1) continue;
    const next = page.indexOf('\n## ', start + heading.length);
    return page.slice(start, next === -1 ? undefined : next);
  }
  return '';
}

function allText(): string {
  return [...pages.values()].join('\n');
}

// A document of one operation whose prose is hostile to Markdown.
function hostile(): OpenApiDocument {
  const base = buildAdminOpenApiDocument();
  const operation = base.paths['/admin/tenants/{tenant}/whoami']?.get;
  if (operation === undefined) throw new Error('whoami is gone');
  return {
    ...base,
    paths: {
      '/admin/tenants/{tenant}/whoami': {
        get: {
          ...operation,
          description:
            'Say <script>alert(1)</script> & {{x}} and {y}, keep `a < b & c` as code, <!-- no -->',
          responses: {
            '200': {
              description: 'OK <img src=x onerror=alert(1)>',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      note: {
                        type: 'string',
                        description: 'A | pipe, a <b>tag</b> and {braces}\nacross two lines',
                      },
                    },
                    required: ['note'],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

// A document of the whoami operation whose success body is the given schema.
function hostileWith(schema: Record<string, unknown>): OpenApiDocument {
  const doc = hostile();
  const path = '/admin/tenants/{tenant}/whoami';
  const operation = doc.paths[path]?.get;
  if (operation === undefined) throw new Error('whoami is gone');
  return {
    ...doc,
    paths: {
      [path]: {
        get: {
          ...operation,
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema } },
            },
          },
        },
      },
    },
  };
}

type Schema = Record<string, unknown>;

function resolved(schema: Schema | undefined): Schema {
  const ref = typeof schema?.$ref === 'string' ? schema.$ref : '';
  const target = (document.components.schemas as Record<string, Schema>)[
    ref.replace('#/components/schemas/', '')
  ];
  return target ?? schema ?? {};
}

// The field paths a reader should find for a body, walked here from the
// document and not taken from the generator, which is what is under test.
// A shape a component names is walked where it first occurs in the body, and
// only its own field is expected where it occurs again.
function fieldPaths(
  schema: Schema | undefined,
  path: string,
  depth: number,
  seen = new Set<string>(),
): string[] {
  const found = resolved(schema);
  const variants = [...((found.anyOf as Schema[] | undefined) ?? [])];
  const others = variants.filter((variant) => variant.type !== 'null');
  const named = [schema, ...((schema?.anyOf as Schema[] | undefined) ?? [])]
    .map((node) => node?.$ref)
    .find((ref): ref is string => typeof ref === 'string');
  if (named !== undefined && path !== '') {
    if (seen.has(named)) return [path];
    seen.add(named);
  }
  const inner =
    others.length === 1 && others.length < variants.length ? resolved(others[0]) : found;
  const properties = inner.properties as Record<string, Schema> | undefined;
  const items = inner.items as Schema | undefined;
  const paths = path === '' ? [] : [path];
  if (depth >= 5) return paths;
  if (properties !== undefined) {
    for (const [name, child] of Object.entries(properties)) {
      paths.push(...fieldPaths(child, path === '' ? name : `${path}.${name}`, depth + 1, seen));
    }
  } else if (items !== undefined && resolved(items).properties !== undefined) {
    paths.push(...fieldPaths(items, `${path}[]`, depth + 1, seen));
  }
  return paths;
}

interface BodyPaths {
  readonly section: string;
  readonly paths: string[];
}

// The request body and each success body of an operation, with their paths.
function bodyPaths(operation: Record<string, unknown>): BodyPaths[] {
  const bodies: BodyPaths[] = [];
  const request = operation.requestBody as
    { content?: Record<string, { schema?: Schema }> } | undefined;
  for (const media of Object.values(request?.content ?? {})) {
    bodies.push({ section: 'request', paths: fieldPaths(media.schema, '', 0) });
  }
  const responses = operation.responses as Record<
    string,
    { content?: Record<string, { schema?: Schema }> }
  >;
  for (const [status, response] of Object.entries(responses)) {
    if (!status.startsWith('2')) continue;
    for (const [type, media] of Object.entries(response.content ?? {})) {
      if (type !== 'application/problem+json') {
        bodies.push({ section: status, paths: fieldPaths(media.schema, '', 0) });
      }
    }
  }
  return bodies;
}

function firstCells(page: string): string[] {
  return page
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => /^\| `(.+?)` \|/u.exec(line)?.[1] ?? '');
}

function htmlNodes(markdown: string): string[] {
  const found: string[] = [];
  const visit = (node: { type: string; value?: string; children?: unknown[] }): void => {
    if (node.type === 'html' && node.value !== undefined) found.push(node.value);
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit(fromMarkdown(markdown));
  return found;
}

describe('the admin API reference pages', () => {
  it('writes one section per operation with its method, path, capability and request and response schemas', () => {
    const text = allText();
    for (const route of ADMIN_ROUTES) {
      expect(text, `${route.method} ${route.pattern}`).toContain(
        `${operationHeading(route.method, route.pattern)}\n`,
      );
    }
    const section = sectionText('clients', 'POST', '/admin/tenants/{tenant}/clients');
    expect(section).toContain('Requires the "manage-clients" capability.');
    expect(section).toContain('\n### Path parameters\n');
    expect(section).toContain('| `tenant` |');
    expect(section).toContain('\n### Request body\n');
    expect(section).toContain('| `client_id` | string | yes |');
    expect(section).toContain('\n### Responses\n');
    expect(section).toContain('\n#### 201 Created\n');
    expect(section).toContain('| `token_endpoint_auth_method` |');
    expect(section).toContain('\n#### 401');
  });

  it('names every route ADMIN_ROUTES lists', () => {
    const headings = [...allText().matchAll(/^## ([A-Z]+ \/\S+)$/gmu)].map((match) => match[1]);
    const listed = ADMIN_ROUTES.map(
      (route) => `${route.method} ${route.pattern.replace(/:(\w+)/gu, '{$1}')}`,
    );
    expect(headings.filter((heading) => !listed.includes(heading ?? ''))).toEqual([]);
    expect(listed.filter((entry) => !headings.includes(entry))).toEqual([]);
    expect(headings).toHaveLength(listed.length);
  });

  it('groups the routes into one folder per area, an index that links each and, where an area has several pages, an area index that links each operation', () => {
    const index = pages.get('admin-api/index.md') ?? '';
    const areas = [...operationsOf(document).keys()];
    expect(areas.length).toBeGreaterThan(10);
    for (const area of areas) {
      expect(index, area).toContain(`](./${area}/index.md)`);
      const areaIndex = pages.get(`admin-api/${area}/index.md`) ?? '';
      if (!areaIndex.includes('\n## Operations\n')) continue;
      for (const { method, path } of operationsOf(document).get(area) ?? []) {
        const link = new RegExp(
          `\\[\`${method.toUpperCase()} ${path.replace(/[{}]/gu, '\\$&')}\`\\]\\(\\./(part-\\d+)\\.md#`,
          'u',
        ).exec(areaIndex);
        expect(link, `${method} ${path}`).not.toBeNull();
        expect(sectionText(area, method, path), `${method} ${path}`).not.toBe('');
      }
    }
  });

  it('keeps every page to a table size a browser lays out quickly, listing a longer body on pages of its own', () => {
    const rows = (text: string): number =>
      text.split('\n').filter((l) => l.startsWith('| ')).length;
    const largest = Math.max(...[...pages.values()].map(rows));
    expect(largest).toBeLessThanOrEqual(70);
  });

  it('keeps every parameter, response status and nested body field of the OpenAPI document in the section of its operation, in order across the pages of a split body', () => {
    const missing: string[] = [];
    for (const [area, operations] of operationsOf(document)) {
      for (const { method, path, operation } of operations) {
        const slug = operationSlug(method, path);
        const name = `${area} ${method} ${path}`;
        const parts = [...pages.keys()].filter((key) =>
          new RegExp(`^admin-api/${area}/${slug}-(request|\\d+)-part-\\d+\\.md$`, 'u').test(key),
        );
        const page = [
          sectionText(area, method, path),
          ...parts.map((key) => pages.get(key) ?? ''),
        ].join('\n');
        for (const parameter of parametersOf(operation, document)) {
          if (!page.includes(`| \`${parameter.name}\` |`))
            missing.push(`${name}: ${parameter.name}`);
        }
        const responses = operation.responses as Record<string, unknown>;
        for (const status of Object.keys(responses)) {
          if (!page.includes(`\n#### ${status} `)) missing.push(`${name}: ${status}`);
        }
        for (const { section, paths } of bodyPaths(operation)) {
          const here = firstCells(page);
          for (const field of paths) {
            if (!here.includes(field)) missing.push(`${name}: ${section} ${field}`);
          }
          const partNames = parts.filter((key) => key.includes(`-${section}-part-`)).sort();
          if (partNames.length > 0) {
            const listed = partNames.flatMap((key) => firstCells(pages.get(key) ?? ''));
            if (listed.join('\n') !== paths.join('\n')) missing.push(`${name}: ${section} order`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('splits what hangs off a subject, and refuses a sub-resource it has no page for', () => {
    const base = '/admin/tenants/{tenant}/subjects/{id}';
    expect(areaOf(`${base}/profile`)).toBe('subjects');
    expect(areaOf(`${base}/lockout`)).toBe('subject-sign-in');
    expect(areaOf(`${base}/groups`)).toBe('subject-access');
    expect(areaOf(`${base}/grants/{clientId}`)).toBe('subject-sessions');
    expect(() => areaOf(`${base}/something-new`)).toThrow(/subject-sign-in/u);
  });

  it('names the subject pages as a reader would say them', () => {
    const text = pages.get('admin-api/subject-sign-in/index.md') ?? '';
    expect(text).toContain('title: "Admin API: Subject sign-in"');
    expect(text).toContain("operations of the Odudu admin API on a subject's sign-in");
    expect(pages.get('admin-api/index.md')).toContain(
      '[Subject sign-in](./subject-sign-in/index.md)',
    );
  });

  it('gives every page a title and a description, and a heading for the title', () => {
    for (const [name, text] of pages) {
      expect(text, name).toMatch(/^---\ntitle: .+\ndescription: .+\n(?:sidebar_\w+: .+\n)*---\n/u);
      expect(text, name).toMatch(/\n# .+\n/u);
    }
  });

  it('escapes HTML in descriptions and writes .md, never .mdx', () => {
    const rendered = renderOpenApiPages(hostile());
    for (const name of rendered.keys()) expect(name.endsWith('.md'), name).toBe(true);
    const text = [...rendered.values()].join('\n');
    expect(text).not.toContain('<script');
    expect(text).not.toContain('<img');
    expect(text).not.toContain('<!-- no');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; {{x}} and {y}');
    expect(text).toContain('`a < b & c`');
    for (const [name, page] of rendered) {
      const html = htmlNodes(page.replace(/^---\n[\s\S]*?\n---\n/u, ''));
      expect(
        html.filter((node) => !node.startsWith('<!-- Generated')),
        name,
      ).toEqual([]);
    }
    const row = text.split('\n').find((line) => line.startsWith('| `note` |')) ?? '';
    expect(row).toContain('A \\| pipe, a &lt;b&gt;tag&lt;/b&gt; and {braces} across two lines');
  });

  it('says constraints in words: plurals, known patterns and formats, and never a raw expression it knows', () => {
    const text = allText();
    expect(text).not.toContain('at least 1 characters');
    expect(text).not.toContain('^[^\\u0000]*$');
    expect(text).not.toContain('[0-9a-fA-F]{8}');
    expect(text).toContain('at least 1 character');
    expect(text).toContain('no bidirectional control characters');
    expect(text).toContain('a UUID');
  });

  it('shows a pattern it cannot put in words in a collapsed block after the operation', () => {
    const doc = hostileWith({ type: 'string', pattern: '^[a-z]{3}-\\d+$' });
    const text = [...renderOpenApiPages(doc).values()].join('\n');
    expect(text).toContain('matching a pattern, listed below');
    expect(text).toContain('<details>');
    expect(text).toContain('<code>^[a-z]{3}-\\d+$</code>');
  });

  it('lists a response on pages of its own when the request and it would overfill one page', () => {
    const fields = (count: number): Record<string, { type: 'string' }> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `f${String(index)}`,
          { type: 'string' as const },
        ]),
      );
    const doc = hostileWith({ type: 'object', properties: fields(40), required: [] });
    const path = '/admin/tenants/{tenant}/whoami';
    const operation = doc.paths[path]?.get;
    if (operation === undefined) throw new Error('whoami is gone');
    const withRequest: OpenApiDocument = {
      ...doc,
      paths: {
        [path]: {
          get: {
            ...operation,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: fields(40), required: [] },
                },
              },
            },
          },
        },
      },
    };
    const rendered = renderOpenApiPages(withRequest);
    expect(rendered.has('admin-api/whoami/get-whoami-200-part-1.md')).toBe(true);
    expect(rendered.has('admin-api/whoami/get-whoami-request-part-1.md')).toBe(false);
  });

  it('puts the pattern a long body field uses on the page that lists the field', () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 70; index += 1)
      properties[`f${String(index)}`] = { type: 'string' };
    properties.f65 = { type: 'string', pattern: '^[a-z]{3}-\\d+$' };
    const rendered = renderOpenApiPages(hostileWith({ type: 'object', properties, required: [] }));
    const first = rendered.get('admin-api/whoami/get-whoami-200-part-1.md') ?? '';
    const second = rendered.get('admin-api/whoami/get-whoami-200-part-2.md') ?? '';
    const main = rendered.get('admin-api/whoami/index.md') ?? '';
    expect(second).toContain('<code>^[a-z]{3}-\\d+$</code>');
    expect(first).not.toContain('<details>');
    expect(main).not.toContain('<details>');
  });

  it('says when it stops expanding a deeply nested schema, and where the rest is', () => {
    let nested: Record<string, unknown> = { type: 'string', description: 'The bottom.' };
    for (let level = 0; level < 8; level += 1) {
      nested = { type: 'object', properties: { inner: nested }, required: ['inner'] };
    }
    const text = [...renderOpenApiPages(hostileWith(nested)).values()].join('\n');
    expect(text).toContain('The fields inside are not listed here');
    expect(text).toContain('[OpenAPI document](pathname:///openapi/admin.json)');
  });

  it('prints how much of each area\u2019s request and response fields carry a description', () => {
    const clients = pages.get('admin-api/clients/index.md') ?? '';
    expect(clients).toMatch(/\nDocumentation coverage: \d+ of \d+ fields described \(\d+%\)\.\n$/u);
  });

  it('is deterministic', () => {
    const again = renderOpenApiPages(buildAdminOpenApiDocument());
    expect([...again.entries()]).toEqual([...pages.entries()]);
    expect([...pages.keys()]).toEqual([...pages.keys()].sort());
  });
});
