import type { AdminCapability, Authority } from '#/shared/service/principal.ts';

// whoami is advice for what to draw, never authority: every request is
// still authorised by the server, and a 403 re-reads whoami, so all of this
// follows it without a reload.

export function holds(authority: Authority | undefined, capability: AdminCapability): boolean {
  return authority?.capabilities.includes(capability) === true;
}

// What a page's changes need that whoami says is missing; nothing until it
// has answered, so a page does not flash a refusal it may not owe.
export function lacking(
  authority: Authority | undefined,
  needs: readonly AdminCapability[],
): AdminCapability[] {
  return authority === undefined ? [] : needs.filter((capability) => !holds(authority, capability));
}

// Whether the rail lists an area: its first read needs nothing, or needs a
// capability whoami says is held. An address typed or shared still opens,
// and explains.
export function readable(
  authority: Authority | undefined,
  capability: AdminCapability | null,
): boolean {
  return capability === null || authority === undefined || holds(authority, capability);
}

export interface Change {
  // As the page's one line says it: "change them", "export them".
  change: string;
  needs: readonly AdminCapability[];
}

// The page's changes whoami rules out, joined into the one line that
// stands in for their absent controls.
export function blockedChanges(
  authority: Authority | undefined,
  changes: readonly Change[],
): Change | null {
  const blocked = changes.filter((c) => lacking(authority, c.needs).length > 0);
  if (blocked.length === 0) return null;
  const needs = [...new Set(blocked.flatMap((c) => lacking(authority, c.needs)))];
  const phrases = blocked.map((c) => c.change);
  const last = phrases.pop() ?? '';
  return { change: phrases.length === 0 ? last : `${phrases.join(', ')} or ${last}`, needs };
}

// Whether whoami has answered and rules none of `needs` out.
export function admitted(
  authority: Authority | undefined,
  needs: readonly AdminCapability[],
): boolean {
  return authority !== undefined && lacking(authority, needs).length === 0;
}
