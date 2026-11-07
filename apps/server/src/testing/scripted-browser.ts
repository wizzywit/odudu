import type { FastifyInstance } from 'fastify';

export interface Person {
  // The Host a browser would send: the host of the instance's public address.
  readonly host: string;
  readonly tenant: string;
  readonly username: string;
  readonly password: string;
  // The scopes ticked on a consent page that offers them.
  readonly tick: readonly string[];
}

interface Reply {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  readonly body: string;
}

function remember(jar: Map<string, string>, reply: Reply): void {
  const raw = reply.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  for (const line of lines) {
    const [pair] = line.split(';');
    const at = pair?.indexOf('=') ?? -1;
    if (pair === undefined || at < 0) continue;
    const value = pair.slice(at + 1);
    if (value === '') jar.delete(pair.slice(0, at));
    else jar.set(pair.slice(0, at), value);
  }
}

const cookieOf = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

function sessionField(html: string): string {
  const found = /name="auth_session_id" value="([^"]*)"/u.exec(html)?.[1];
  if (found === undefined) throw new Error(`no auth_session_id in ${html.slice(0, 200)}`);
  return found;
}

// What a person does in a browser: open the address, sign in on the login
// page, and on a consent page tick what they agree to and allow. Returns where
// the browser would be sent next, the redirect to the client's own address.
export async function scriptedBrowser(
  app: FastifyInstance,
  address: string,
  person: Person,
): Promise<string> {
  const jar = new Map<string, string>();
  const form = { 'content-type': 'application/x-www-form-urlencoded', host: person.host };
  const send = async (options: {
    method: 'GET' | 'POST';
    url: string;
    payload?: string;
    headers?: Record<string, string>;
  }): Promise<Reply> => {
    const res = await app.inject({
      ...options,
      headers: {
        host: person.host,
        ...options.headers,
        ...(jar.size === 0 ? {} : { cookie: cookieOf(jar) }),
      },
    });
    const reply = { statusCode: res.statusCode, headers: res.headers, body: res.body };
    remember(jar, reply);
    return reply;
  };
  const target = new URL(address);
  let page = await send({ method: 'GET', url: `${target.pathname}${target.search}` });
  for (let step = 0; step < 6; step += 1) {
    const location = page.headers.location;
    if (page.statusCode === 302 && typeof location === 'string') return location;
    if (page.statusCode !== 200)
      throw new Error(`the browser stopped at ${String(page.statusCode)}`);
    if (page.body.includes('name="password"')) {
      page = await send({
        method: 'POST',
        url: `/tenants/${person.tenant}/login-actions/authenticate`,
        headers: form,
        payload: new URLSearchParams({
          auth_session_id: sessionField(page.body),
          username: person.username,
          password: person.password,
        }).toString(),
      });
    } else if (page.body.includes('name="decision"')) {
      const body = new URLSearchParams({
        auth_session_id: sessionField(page.body),
        decision: 'allow',
      });
      for (const scope of person.tick) {
        if (page.body.includes(`value="${scope}"`)) body.append('scope', scope);
      }
      page = await send({
        method: 'POST',
        url: `/tenants/${person.tenant}/login-actions/consent`,
        headers: form,
        payload: body.toString(),
      });
    } else {
      throw new Error(`the browser was shown a page it does not know: ${page.body.slice(0, 200)}`);
    }
  }
  throw new Error('the sign-in did not end');
}

// A `fetch` that reaches the app in-process for its public address, and the
// network for anything else (the loopback listener).
export function reachingApp(app: FastifyInstance, base: string | readonly string[]): typeof fetch {
  const origins = new Set((typeof base === 'string' ? [base] : base).map((b) => new URL(b).origin));
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!origins.has(url.origin)) return fetch(input, init);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH',
      url: `${url.pathname}${url.search}`,
      headers: { host: url.host, ...headers },
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const out = new Headers();
    for (const [name, value] of Object.entries(res.headers)) {
      if (Array.isArray(value)) for (const v of value) out.append(name, v);
      else if (value !== undefined) out.set(name, String(value));
    }
    const noBody = res.statusCode === 204 || res.statusCode === 304 || res.statusCode < 200;
    return new Response(noBody ? null : res.rawPayload, { status: res.statusCode, headers: out });
  };
}
