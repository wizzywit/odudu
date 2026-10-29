import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_ROUTES } from '@odudu/protocol-admin';
import { buildAdminOpenApiDocument } from '@odudu/protocol-admin/docs';
import { CLI_COMMANDS } from '@odudu/server/src/cli/registry.ts';
import { servingApp } from '@odudu/server/src/testing/served-routes.ts';
import { renderBrandingPage } from './branding-page.ts';
import { renderCliPage } from './cli-page.ts';
import { renderConfigPage } from './config-page.ts';
import { renderEndpointsPage } from './endpoints-page.ts';
import { renderErrorsPage } from './errors-page.ts';
import { renderEventsPage } from './events-page.ts';
import { adminApiAreas, renderOpenApiPages } from './openapi-pages.ts';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

// Everything under these two directories is written here and nowhere else, so
// each is emptied before a run and ignored by git.
export const GENERATED_DIRS = ['content/en/reference/generated', 'static/openapi'] as const;
const REFERENCE_DIR = GENERATED_DIRS[0];

export function commitOf(): string {
  const fromEnvironment = process.env.ODUDU_COMMIT;
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

// The banner goes after the front matter, which has to stay the first thing in the file.
export function withBanner(page: string, source: string, commit: string): string {
  const end = page.indexOf('\n---\n', 4) + '\n---\n'.length;
  const banner = `<!-- Generated from ${source} at ${commit}; do not edit. -->\n`;
  return `${page.slice(0, end)}\n${banner}${page.slice(end)}`;
}

export interface Source {
  readonly name: string;
  readonly pages: ReadonlyMap<string, string>;
}

async function endpointsPage(): Promise<string> {
  const { app, endpoints } = await servingApp();
  try {
    return renderEndpointsPage({
      served: endpoints,
      adminOperations: new Set(ADMIN_ROUTES.map((route) => `${route.method} ${route.pattern}`)),
    });
  } finally {
    await app.close();
  }
}

export async function sources(): Promise<readonly Source[]> {
  return [
    {
      name: 'the OpenAPI document of @odudu/protocol-admin',
      pages: renderOpenApiPages(buildAdminOpenApiDocument()),
    },
    {
      name: 'the command registry of @odudu/server',
      pages: new Map([['cli.md', renderCliPage(CLI_COMMANDS)]]),
    },
    {
      name: 'the configuration schema of @odudu/kernel',
      pages: new Map([['configuration.md', renderConfigPage()]]),
    },
    {
      name: 'the error vocabularies of @odudu/kernel, @odudu/protocol-oidc and @odudu/protocol-admin',
      pages: new Map([['errors.md', renderErrorsPage()]]),
    },
    {
      name: 'the page kinds of @odudu/kernel and the stylesheet hooks of @odudu/domain-theme',
      pages: new Map([['branding.md', renderBrandingPage()]]),
    },
    {
      name: 'the audit vocabularies of @odudu/domain-audit and @odudu/protocol-admin',
      pages: new Map([['events.md', renderEventsPage()]]),
    },
    {
      name: 'the routes the @odudu/server app serves',
      pages: new Map([['endpoints.md', await endpointsPage()]]),
    },
  ];
}

// Paths relative to the docs app, with the content to write at each.
export async function generatedFiles(commit: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const source of await sources()) {
    for (const [name, page] of source.pages) {
      files.set(`${REFERENCE_DIR}/${name}`, withBanner(page, source.name, commit));
    }
  }
  const admin = buildAdminOpenApiDocument();
  const categories: [string, string][] = [
    ['admin-api', 'Admin API'],
    ...adminApiAreas(admin).map(([area, label]): [string, string] => [`admin-api/${area}`, label]),
  ];
  for (const [dir, label] of categories) {
    files.set(`${REFERENCE_DIR}/${dir}/_category_.json`, `${JSON.stringify({ label }, null, 2)}\n`);
  }
  files.set(
    'static/openapi/admin.json',
    `${JSON.stringify(buildAdminOpenApiDocument(), null, 2)}\n`,
  );
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function writeGenerated(root: string, files: ReadonlyMap<string, string>): void {
  for (const dir of GENERATED_DIRS) rmSync(path.join(root, dir), { recursive: true, force: true });
  for (const [name, content] of files) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

if (import.meta.main) {
  const files = await generatedFiles(commitOf());
  writeGenerated(APP_ROOT, files);
  console.log(`generated ${String(files.size)} files`);
}
