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
