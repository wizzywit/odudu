import type { SigningKeyStatus } from '@odudu/contracts/admin';

export const TITLE = 'Signing keys';

export const NOUN = { one: 'key', other: 'keys' } as const;

export interface Lane {
  status: SigningKeyStatus;
  title: string;
  rule: string;
  empty: string;
}

export const LANES: readonly Lane[] = [
  {
    status: 'rotating',
    title: 'Rotating',
    rule: 'Published in the key set but not signing. A staged key waits here until relying parties have had time to fetch it; the key a promotion replaced waits here to be retired.',
    empty: 'No key is rotating. Stage one to start a rotation.',
  },
  {
    status: 'active',
    title: 'Active',
    rule: 'Signs every new token. A tenant has one active key, and it is never retired while it is active: promote another key first.',
    empty: 'This tenant has no active key.',
  },
  {
    status: 'retired',
    title: 'Retired',
    rule: 'Published nowhere and signing nothing. A retired key can be deleted.',
    empty: 'No key has been retired.',
  },
];
