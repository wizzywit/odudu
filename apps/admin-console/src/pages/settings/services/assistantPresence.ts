import type { AdminCapability, Authority } from '#/shared/lib/services/principal';
import { holds } from '#/shared/lib/services/access';
import type { RecordStatus } from '#/shared/lib/services/record';
import type { GatewayFailure } from '#/shared/lib/services/result';

// Whether the assistant's settings are on this page, and in what state. A
// deployment with no assistant answers 404 and a caller who may neither read
// nor change them answers 403: both leave the page as it was, with no section.
export type AssistantPresence = 'absent' | 'pending' | 'failed' | 'ready';

const READERS: readonly AdminCapability[] = ['manage-assistant', 'read-assistant-activity'];

// Nothing is asked until whoami has answered, so a person who holds neither
// capability is never sent a request that can only be refused.
export function mayReadAssistant(authority: Authority | undefined): boolean {
  return authority !== undefined && READERS.some((capability) => holds(authority, capability));
}

export function mayChangeAssistant(authority: Authority | undefined): boolean {
  return holds(authority, 'manage-assistant');
}

function refusedOutright(failure: GatewayFailure | null): boolean {
  return failure?.kind === 'problem' && failure.problem.status === 403;
}

// Whether the section stands on the page and is listed beside the others:
// while the read is out it does not, so a deployment with no assistant never
// draws one and takes it away again. A failed read is shown, but unlisted.
export function assistantShown(presence: AssistantPresence): boolean {
  return presence === 'ready';
}

export function assistantPresence(read: {
  mayRead: boolean;
  status: RecordStatus;
  failure: GatewayFailure | null;
}): AssistantPresence {
  if (!read.mayRead || read.status === 'missing' || refusedOutright(read.failure)) return 'absent';
  switch (read.status) {
    case 'loading':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'ready':
      return 'ready';
  }
}
