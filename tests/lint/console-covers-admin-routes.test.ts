import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '../../packages/protocol-admin/src/index.js';

// Every admin route has a screen: some console adapter calls it, by method
// and path template, or it is named below as one the console never calls.
// A reference is `request('<METHOD>', <path>)` with the path a literal or a
// template whose spans each fill one whole segment; a query after `?` is
// ignored. A helper that builds the prefix hides the route from this test,
// which then fails on the route rather than passing on a guess.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ADAPTERS = [
  'apps/admin-console/src/features/*/adapter/**/*.{ts,tsx}',
  'apps/admin-console/src/features/*/adapter.{ts,tsx}',
  'apps/admin-console/src/shared/adapter/**/*.{ts,tsx}',
];
const TEST = /\.test\.tsx?$/u;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Routes no console adapter calls yet. Each feature takes its own out as it
// lands, and the list is empty when the console is complete.
const TODO: readonly string[] = [
  'PATCH /admin/tenants/:tenant/settings',
  'GET /admin/tenants/:tenant/registration-tokens',
  'POST /admin/tenants/:tenant/registration-tokens',
  'DELETE /admin/tenants/:tenant/registration-tokens/:id',
  'POST /admin/tenants/:tenant/scopes',
  'GET /admin/tenants/:tenant/scopes/:id',
  'PATCH /admin/tenants/:tenant/scopes/:id',
  'DELETE /admin/tenants/:tenant/scopes/:id',
  'GET /admin/tenants/:tenant/scopes/:id/roles',
  'PUT /admin/tenants/:tenant/scopes/:id/roles',
  'GET /admin/tenants/:tenant/scopes/:id/mappers',
  'PUT /admin/tenants/:tenant/scopes/:id/mappers',
  'GET /admin/tenants/:tenant/scopes/:id/clients',
  'POST /admin/tenants/:tenant/keys',
  'POST /admin/tenants/:tenant/keys/:id/promote',
  'POST /admin/tenants/:tenant/keys/:id/retire',
  'PUT /admin/tenants/:tenant/smtp',
  'DELETE /admin/tenants/:tenant/smtp',
  'POST /admin/tenants/:tenant/smtp/test',
  'GET /admin/tenants/:tenant/flow/executions',
  'PUT /admin/tenants/:tenant/flow/executions',
  'POST /admin/tenants/:tenant/subjects/bulk',
  'GET /admin/tenants/:tenant/sessions',
  'GET /admin/tenants/:tenant/sessions/count',
  'DELETE /admin/tenants/:tenant/sessions',
  'DELETE /admin/tenants/:tenant/lockouts',
  'GET /admin/tenants/:tenant/clients/:id/sessions',
  'DELETE /admin/tenants/:tenant/clients/:id/grants',
  'GET /admin/tenants/:tenant/clients/:id/logout-deliveries',
  'GET /admin/tenants/:tenant/clients/:id/installation',
  'GET /admin/tenants/:tenant/clients/:id/evaluate',
  'DELETE /admin/tenants/:tenant/keys/:id',
  'GET /admin/tenants/:tenant/mail',
  'GET /admin/tenants/:tenant/audit/count',
  'GET /admin/tenants/:tenant/audit/export',
  'DELETE /admin/tenants/:tenant',
];

// Routes the console deliberately never calls, each with the reason.
const NEVER: Readonly<Record<string, string>> = {};

function template(pattern: string): string {
  return pattern.replace(/\/:[^/]+/gu, '/:');
}

function pathOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) => `:${span.literal.text}`).join('');
}

// `METHOD /admin/...` for every admin path an adapter source asks for.
function referencesIn(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [method, target] = node.arguments;
      if (
        method !== undefined &&
        target !== undefined &&
        ts.isStringLiteralLike(method) &&
        METHODS.has(method.text)
      ) {
        const address = pathOf(target)?.split('?')[0];
        if (address?.startsWith('admin/') === true) found.push(`${method.text} /${address}`);
      }
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
      gateway.request('POST', 'admin/tenant-imports', { schema });
      gateway.request('GET', 'session', { schema });
      gateway.request(method, 'admin/tenants', { schema });
      log('GET', 'admin/tenants');
    `;
    expect(referencesIn('fixture.ts', source).map((reference) => template(reference))).toEqual([
      'GET /admin/tenants/:/roles',
      'DELETE /admin/tenants/:/subjects/:/sessions/:',
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

  it('calls every admin route, but for those still to come and those it never calls', async () => {
    const referenced = new Set([...(await adapterReferences()).keys()].map((r) => template(r)));
    const never = new Set(Object.keys(NEVER));
    const uncovered = [...ROUTES]
      .filter(([key, route]) => !referenced.has(key) && !never.has(route))
      .map(([, route]) => route)
      .sort();
    expect([...TODO].sort(), 'TODO must name exactly the routes no adapter calls yet').toEqual(
      uncovered,
    );
  });

  it('never calls a route it says it never calls, and says why for each', async () => {
    const referenced = new Set([...(await adapterReferences()).keys()].map((r) => template(r)));
    const routes = new Set(ROUTES.values());
    for (const [route, reason] of Object.entries(NEVER)) {
      expect(routes.has(route), route).toBe(true);
      expect(reason.trim(), route).not.toBe('');
      expect(TODO, route).not.toContain(route);
      expect(referenced.has(template(route)), route).toBe(false);
    }
  });
});
