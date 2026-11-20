import { cookies } from 'next/headers.js';

// Every cookie of the request being rendered, as a `Cookie` header. `cookies()`
// is asynchronous and only reads here: a server component cannot set one.
export async function cookieHeaderOfRender(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
}
