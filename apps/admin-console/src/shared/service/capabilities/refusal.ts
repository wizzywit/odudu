import { andList } from '#/shared/service/format.ts';

// The capabilities one part of a ceiling refusal's detail names after `lead`.
function namedAfter(parts: readonly string[], lead: string): string[] {
  const part = parts.find((each) => each.startsWith(lead));
  return part === undefined ? [] : part.slice(lead.length).split(', ');
}

// What a group, role or scope write refused by its guards means, worded
// where it was made; the server's own reason is kept when it is not the
// capability ceiling's (ADR 0040). Null for anything else.
export function writeRefusal(
  problem: { type: string; status: number; detail?: string | undefined },
  capability = 'manage-tenant',
): string | null {
  const detail = problem.detail;
  if (problem.status === 409 && problem.type === 'about:blank#last-administrator') {
    const who = detail === undefined ? '' : ` (${detail})`;
    return `Refused: it would leave this tenant with no enabled administrator${who}. Make somebody else an administrator first.`;
  }
  if (problem.status !== 403) return null;
  if (detail === undefined || detail === '') {
    return `Refused: it needs the ${capability} capability, or reaches a capability you do not hold.`;
  }
  const parts = detail.split('; ');
  const granted = namedAfter(parts, 'the caller does not hold: ');
  const removed = namedAfter(parts, 'this removes capabilities the caller does not hold: ');
  if (granted.length + removed.length === 0) return `Refused: ${detail}.`;
  const would = [
    ...(granted.length === 0 ? [] : [`hand out ${andList(granted)}`]),
    ...(removed.length === 0
      ? []
      : [`take ${andList(removed)} from whoever holds it through here`]),
  ];
  const tail =
    granted.length + removed.length > 1
      ? 'none of which you hold yourself'
      : 'which you do not hold yourself';
  return `Refused: it would ${would.join(' and ')}, ${tail}.`;
}
