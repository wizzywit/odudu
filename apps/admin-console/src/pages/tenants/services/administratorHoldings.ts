import { holdingsProblem } from '#/shared/services/administrators';
import { andList } from '#/shared/services/format';
import { requiredProblem } from '#/shared/services/fieldErrors';

// further one to a tenant that has some.
export function choosesHoldings(step: { origin: string; granted: boolean }): boolean {
  return step.origin === 'existing' && !step.granted;
}

// What the administrator step refuses to send, by the field it belongs under.
export function administratorProblem(step: {
  username: string;
  holdings: readonly string[];
}): { username: string } | { holdings: string } | null {
  const username = requiredProblem(step.username, 'Enter a username for the administrator.');
  if (username !== null) return { username };
  const holdings = holdingsProblem(step.holdings);
  return holdings === null ? null : { holdings };
}

// What they hold, as a sentence fragment.
export function holdsText(holdings?: readonly string[]): string {
  if (holdings === undefined || holdings.includes('tenant-admin') || holdings.length === 0) {
    return 'tenant-admin';
  }
  return andList(holdings);
}

export function systemHoldsText(holds: string): string {
  return holds === 'tenant-admin'
    ? 'is a system administrator, holding tenant-admin in'
    : `holds ${holds} in`;
}
