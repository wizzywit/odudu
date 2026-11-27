import { assistantPageContextSchema } from '@odudu/contracts/admin';
import type { PageContext } from '#/widgets/assistant-panel/types/chat';

const HOME: PageContext = { route: '/' };

// The collections whose second path segment is a record's id.
const RECORD_KINDS: Readonly<Record<string, string>> = {
  clients: 'client',
  subjects: 'subject',
  groups: 'group',
  roles: 'role',
  scopes: 'scope',
  domains: 'domain',
  flows: 'flow',
  keys: 'key',
};

const ID = /^[A-Za-z0-9._:-]+$/u;

// Where the administrator is, from the router's own path (the one below the
// console's base) and nothing a
// person typed: the route below the tenant and, on a page of one record, its
// kind and id. What the server's schema would refuse is not sent at all, so a
// path it cannot describe is the tenant's home.
export function pageContextOf(pathname: string, tenant: string): PageContext {
  const prefix = `/${tenant}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return HOME;
  const rest = pathname.slice(prefix.length).replace(/\/+$/u, '');
  const route = rest === '' ? '/' : rest;
  const [, collection = '', id = ''] = route.split('/');
  const kind = RECORD_KINDS[collection];
  const context: PageContext =
    kind !== undefined && ID.test(id) ? { route, objectType: kind, objectId: id } : { route };
  return assistantPageContextSchema.safeParse(context).success ? context : HOME;
}

// What the chip beside the composer says.
export function pageLabel(context: PageContext): string {
  if (context.objectType !== undefined && context.objectId !== undefined) {
    return `${context.objectType} ${context.objectId}`;
  }
  return context.route === '/' ? 'Overview' : context.route;
}
