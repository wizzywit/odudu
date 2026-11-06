// `encodeURIComponent` leaves `.` and `..` as they are, and a router resolves
// them, so they are refused along with the empty segment.
function segment(value: string): string {
  if (value === '' || value === '.' || value === '..') {
    throw new Error('a path parameter must be a real segment, not empty, "." or ".."');
  }
  return encodeURIComponent(value);
}

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
