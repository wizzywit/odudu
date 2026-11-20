import { clearReturnCookie, setReturnCookie } from '#/services/return-cookie';
import { safeReturnTo } from '#/services/return-to';

// How to change an answer of the BFF: a new `Location` and the cookies to add.
export interface Change {
  location?: string;
  cookies: string[];
}

// After `login`: remember a safe `returnTo` for the callback, or clear one an
// earlier sign-in left, when the BFF is sending the person to the issuer.
export function planLogin(
  status: number,
  returnTo: string | null,
  returnCookieName: string,
  mount: string,
): Change {
  const target = safeReturnTo(returnTo, mount);
  if (status !== 302) return { cookies: [] };
  return {
    cookies: [
      target === undefined
        ? clearReturnCookie(returnCookieName)
        : setReturnCookie(returnCookieName, target),
    ],
  };
}

export interface CallbackInput {
  status: number;
  // The `Set-Cookie` lines of the BFF's answer.
  setCookies: string[];
  sessionCookieName: string;
  returnCookieName: string;
  // What the request's return cookie held, after it was checked.
  target: string | undefined;
  // Whether the request carried a return cookie at all.
  carriedReturnCookie: boolean;
}

function startedSession(input: CallbackInput): boolean {
  return input.setCookies.some(
    (line) =>
      line.startsWith(`${input.sessionCookieName}=`) &&
      !line.startsWith(`${input.sessionCookieName}=;`),
  );
}

// After `callback`: a sign-in that succeeded goes where the person was headed,
// and the return cookie is cleared whatever happened, so it never outlives
// the sign-in it belongs to.
export function planCallback(input: CallbackInput): Change {
  const cookies = input.carriedReturnCookie ? [clearReturnCookie(input.returnCookieName)] : [];
  const succeeded = input.status === 302 && startedSession(input);
  return succeeded && input.target !== undefined
    ? { location: input.target, cookies }
    : { cookies };
}
