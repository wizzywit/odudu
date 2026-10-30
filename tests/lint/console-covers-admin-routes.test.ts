import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '../../packages/protocol-admin/src/index.js';

// Every admin route has a screen: some console adapter calls it, by method
// and path template, or it is named below as one the console never calls.
// A reference is a `request('<METHOD>', <path>)` with a literal or template
// path, an `adminCall(gateway, '<METHOD>', tenant, [<parts>])`, an
// `adminRootCall(gateway, '<METHOD>', [<parts>])`, or a
// `listReader('<collection>')` or `countReader('<collection>')`; a query
// after `?` is ignored. Any other helper that builds the prefix hides the
// route, and this test then fails on the route rather than guessing.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ADAPTERS = [
  'apps/admin-console/src/features/*/adapter/**/*.{ts,tsx}',
  'apps/admin-console/src/features/*/adapter.{ts,tsx}',
  'apps/admin-console/src/shared/adapter/**/*.{ts,tsx}',
];
const TEST = /\.test\.tsx?$/u;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// The previews are framed by address, as `previewSource` and
// `mailPreviewSource` build it, and never requested by an adapter.
const FRAMED =
  'Framed by address (previewSource), not requested by an adapter: the Branding preview is an iframe whose own navigation fetches it.';

// Routes the console deliberately never calls, each with the reason.
const NEVER: Readonly<Record<string, string>> = {
  'POST /admin/tenants/:tenant/subjects/bulk':
    'API-only: acts on up to 100 subjects in one call for scripts and migrations. Every console list and record page acts on one subject at a time and has no multi-select.',
  'GET /admin/tenants/:tenant/audit/count':
    'The audit trail has no count, by design: over a trail that long a capped total would be an estimate the page cannot stand behind, so it says how far back the loaded rows reach instead.',
  'GET /admin/tenants/:tenant/theme/preview': FRAMED,
  'GET /admin/tenants/:tenant/clients/:id/theme/preview': FRAMED,
  'GET /admin/tenants/:tenant/mail/preview': FRAMED,
  'GET /admin/tenants/:tenant/clients/:id/mail/preview': FRAMED,
};

function template(pattern: string): string {
  return pattern.replace(/\/:[^/]+/gu, '/:');
}

function pathOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) => `:${span.literal.text}`).join('');
}

function partsOf(node: ts.Expression): string | null {
  if (!ts.isArrayLiteralExpression(node)) return null;
  const parts = node.elements.map((part) => (ts.isStringLiteralLike(part) ? part.text : ':'));
  return `admin/tenants/:/${parts.join('/')}`;
}

function referenceOf(node: ts.CallExpression): string | null {
  const name = ts.isIdentifier(node.expression) ? node.expression.text : null;
  const [first, second, third, fourth] = node.arguments;
  if (name === 'adminRootCall') {
    if (second === undefined || third === undefined) return null;
    if (!ts.isStringLiteralLike(second) || !METHODS.has(second.text)) return null;
    if (!ts.isArrayLiteralExpression(third)) return null;
    const parts = third.elements.map((part) => (ts.isStringLiteralLike(part) ? part.text : ':'));
    return `${second.text} /admin/${parts.join('/')}`;
  }
  if (name === 'adminCall') {
    if (second === undefined || fourth === undefined) return null;
    if (!ts.isStringLiteralLike(second) || !METHODS.has(second.text)) return null;
    const address = partsOf(fourth);
    return address === null ? null : `${second.text} /${address}`;
  }
  if ((name === 'listReader' || name === 'countReader') && first !== undefined) {
    if (!ts.isStringLiteralLike(first)) return null;
    return `GET /admin/tenants/:/${first.text}${name === 'countReader' ? '/count' : ''}`;
  }
  const [method, target] = node.arguments;
  if (method === undefined || target === undefined) return null;
  if (!ts.isStringLiteralLike(method) || !METHODS.has(method.text)) return null;
  const address = pathOf(target)?.split('?')[0];
  return address?.startsWith('admin/') === true ? `${method.text} /${address}` : null;
}

// `METHOD /admin/...` for every admin path an adapter source asks for.
function referencesIn(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const reference = referenceOf(node);
      if (reference !== null) found.push(reference);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

async function adapterReferences(): Promise<Map<string, string[]>> {
  const references = new Map<string, string[]>();
  for (const pattern of ADAPTERS) {
    for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
      if (TEST.test(file)) continue;
      const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const reference of referencesIn(file, source)) {
        references.set(reference, [...(references.get(reference) ?? []), file]);
      }
    }
  }
  return references;
}

const ROUTES = new Map(
  ADMIN_ROUTES.map((route) => [
    `${route.method} ${template(route.pattern)}`,
    `${route.method} ${route.pattern}`,
  ]),
);

describe("the console's reach into the admin API", { timeout: 60_000 }, () => {
  it('finds a reference however the path is written, and nothing else', () => {
    const source = `
      gateway.request('GET', \`admin/tenants/\${encodeURIComponent(tenant)}/roles?\${query.toString()}\`, { schema });
      gateway.request('DELETE', \`admin/tenants/\${t}/subjects/\${id}/sessions/\${sid}\`, { schema });
      adminCall(gateway, 'PATCH', tenant, ['roles', roleId, 'composites'], { schema });
      adminCall(gateway, 'GET', tenant, ['roles', 'count'], { query, schema });
      adminCall(gateway, method, tenant, ['roles'], { schema });
      adminRootCall(gateway, 'GET', ['tenants', name], { schema });
      adminRootCall(gateway, 'POST', ['tenant-imports'], { schema });
      adminRootCall(gateway, method, ['tenants'], { schema });
      listReader('groups', schema);
      countReader('groups');
      gateway.request('POST', 'admin/tenant-imports', { schema });
      gateway.request('GET', 'session', { schema });
      gateway.request(method, 'admin/tenants', { schema });
      log('GET', 'admin/tenants');
    `;
    expect(referencesIn('fixture.ts', source).map((reference) => template(reference))).toEqual([
      'GET /admin/tenants/:/roles',
      'DELETE /admin/tenants/:/subjects/:/sessions/:',
      'PATCH /admin/tenants/:/roles/:/composites',
      'GET /admin/tenants/:/roles/count',
      'GET /admin/tenants/:',
      'POST /admin/tenant-imports',
      'GET /admin/tenants/:/groups',
      'GET /admin/tenants/:/groups/count',
      'POST /admin/tenant-imports',
      'GET /admin/tenants',
    ]);
  });

  it('asks only for routes the admin API has', async () => {
    const references = await adapterReferences();
    expect([...references.keys()]).toContain('GET /admin/tenants/:/whoami');
    const unknown = [...references].filter(([reference]) => !ROUTES.has(template(reference)));
    expect(unknown.map(([reference, files]) => `${reference} in ${files.join(', ')}`)).toEqual([]);
  });

  it('calls every admin route but those it never calls', async () => {
    const referenced = new Set([...(await adapterReferences()).keys()].map((r) => template(r)));
    const never = new Set(Object.keys(NEVER));
    const uncovered = [...ROUTES]
      .filter(([key, route]) => !referenced.has(key) && !never.has(route))
      .map(([, route]) => route)
      .sort();
    expect(uncovered, 'a route no adapter calls needs a screen, or a reason in NEVER').toEqual([]);
  });

  it('never calls a route it says it never calls, and says why for each', async () => {
    const referenced = new Set([...(await adapterReferences()).keys()].map((r) => template(r)));
    const routes = new Set(ROUTES.values());
    for (const [route, reason] of Object.entries(NEVER)) {
      expect(routes.has(route), route).toBe(true);
      expect(reason.trim(), route).not.toBe('');
      expect(referenced.has(template(route)), route).toBe(false);
    }
  });
});
