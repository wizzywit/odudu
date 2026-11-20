export type RouteName = 'login' | 'callback' | 'logout' | 'session' | 'proxy';

const PLAIN = new Set<string>(['login', 'callback', 'logout', 'session']);

function isPlain(name: string): name is Exclude<RouteName, 'proxy'> {
  return PLAIN.has(name);
}

// Which BFF route a request path is for. The proxy owns its path and
// everything below it; the others are one segment below the mount path.
export function routeFor(
  pathname: string,
  mount: string,
  proxyPath: string,
): RouteName | undefined {
  if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) return 'proxy';
  if (!pathname.startsWith(`${mount}/`)) return undefined;
  const name = pathname.slice(mount.length + 1);
  return isPlain(name) ? name : undefined;
}
