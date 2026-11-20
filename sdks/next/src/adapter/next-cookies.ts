import { cookies } from 'next/headers.js';

// One cookie of the request being rendered. `cookies()` is asynchronous and
// only read here: a server component cannot set one.
export async function cookieOfRender(name: string): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(name)?.value;
}
