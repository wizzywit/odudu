// `encodeURIComponent` leaves `.` and `..` as they are, and a router resolves
// them, so they are refused along with the empty segment.
function segment(value: string): string {
  if (value === '' || value === '.' || value === '..') {
    throw new Error('a path parameter must be a real segment, not empty, "." or ".."');
  }
  return encodeURIComponent(value);
}

// The only routes with no `:tenant` a tool may call: the reads that span
// tenants, which the admin API admits to the system tenant's agent alone. Any
// other pattern lacking the tenant segment is refused, so a path that carries
// no tenant is never built by accident.
export const INSTANCE_PATTERNS: readonly string[] = ['/admin/tenants', '/admin/tenants/count'];

// A route pattern with its parameters filled, each as one path segment. The
// tenant is the caller's, so a parameter named `tenant` is refused rather
// than allowed to name another one.
export function expandPattern(
  pattern: string,
  tenant: string,
  params: Readonly<Record<string, string>>,
): string {
  if (Object.hasOwn(params, 'tenant')) {
    throw new Error("a tool cannot name the tenant: it is the caller's");
  }
  if (!pattern.includes(':tenant') && !INSTANCE_PATTERNS.includes(pattern)) {
    throw new Error('a route without a tenant is not one a tool may call');
  }
  const used = new Set<string>();
  const path = pattern.replace(/:([A-Za-z]+)/gu, (_match, name: string) => {
    if (name === 'tenant') return segment(tenant);
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined) throw new Error(`the route needs a value for :${name}`);
    used.add(name);
    return segment(value);
  });
  const unused = Object.keys(params).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`the route takes no :${unused.join(', :')}`);
  return path;
}
