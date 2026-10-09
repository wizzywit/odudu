import { z } from 'zod';
import type { Fetch } from '#/shared/transport/gateway.ts';
import { readProblem, type Problem } from '#/shared/transport/problem.ts';

const LOGOUT = '/console/auth/logout';
const DEFAULT_TIMEOUT_MS = 30_000;

const logoutSchema = z.object({ redirect: z.string() });

export type LogoutResult =
  | { ok: true; redirect: string }
  | { ok: false; kind: 'problem'; problem: Problem }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'schema' };

export interface Auth {
  logout(): Promise<LogoutResult>;
}

export interface AuthDependencies {
  fetch?: Fetch;
  log?: (message: string) => void;
  timeoutMs?: number;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

const CONSOLE_PATH = '/console/';

// The redirect ends the tenant's SSO session, so it names this origin's own
// end-session endpoint; anything else would send the window somewhere the
// console has no business sending it. An ended session is sent back to the
// console by path, and no other relative form is taken.
function sameOrigin(redirect: string): boolean {
  try {
    if (!URL.canParse(redirect)) {
      const at = new URL(redirect, globalThis.location.origin);
      return (
        redirect.startsWith(CONSOLE_PATH) &&
        at.origin === globalThis.location.origin &&
        at.pathname.startsWith(CONSOLE_PATH)
      );
    }
    return new URL(redirect).origin === globalThis.location.origin;
  } catch {
    return false;
  }
}

// Logout lives beside the gateway rather than under /console/api/, and is
// never repeated: the session it ends is gone after the first answer.
export function createAuth(dependencies: AuthDependencies = {}): Auth {
  const fetchResponse: Fetch = dependencies.fetch ?? ((url, init) => fetch(url, init));
  const log =
    dependencies.log ??
    ((message: string) => {
      console.error(message);
    });
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async logout() {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      let response: Response;
      let text: string;
      try {
        response = await fetchResponse(LOGOUT, {
          method: 'POST',
          headers: new Headers({ accept: 'application/json', 'x-odudu-console': '1' }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        text = await response.text();
      } catch {
        return { ok: false, kind: 'network' };
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const problem = readProblem(response.status, response.headers.get('content-type'), text);
        return { ok: false, kind: 'problem', problem };
      }
      const parsed = logoutSchema.safeParse(parseJson(text));
      if (!parsed.success || !sameOrigin(parsed.data.redirect)) {
        log('console defect: POST logout answered without a same-origin redirect');
        return { ok: false, kind: 'schema' };
      }
      return { ok: true, redirect: parsed.data.redirect };
    },
  };
}
