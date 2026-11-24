import type { Choice } from '#/shared/lib/services/choice';
import { ANY_STATUS } from '#/shared/lib/services/filters';

export const EVENT_TYPE_OPTIONS: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any event type' },
  { id: 'admin_mutation', label: 'Admin change' },
  { id: 'admin_access', label: 'Admin access' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'session', label: 'Session' },
  { id: 'token', label: 'Token' },
  { id: 'credential', label: 'Credential' },
];

export const OUTCOME_OPTIONS: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any outcome' },
  { id: 'allowed', label: 'Allowed' },
  { id: 'refused', label: 'Refused' },
  { id: 'failed', label: 'Failed' },
];
