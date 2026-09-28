import { type AdminMethod } from '#/service/odudu-port';

export const CONSOLE_SUBJECT_HEADER = 'x-odudu-console-subject';

type IncomingHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

const READS: ReadonlySet<AdminMethod> = new Set(['GET', 'HEAD']);

export function believedSubject(headers: IncomingHeaders): string | undefined {
  const value = headers[CONSOLE_SUBJECT_HEADER];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// The console cookie is shared by every tab, so another tab's sign-in can
// replace the session under this one. A tab names the subject it believes
// it is, and a request naming anyone else is refused rather than acted on
// as somebody the page does not show. A read naming nobody still passes.
export function principalChanged(
  method: AdminMethod,
  believed: string | undefined,
  actual: string,
): boolean {
  if (believed === undefined) return !READS.has(method);
  return believed !== actual;
}
