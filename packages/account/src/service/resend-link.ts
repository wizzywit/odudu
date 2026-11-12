import { type ActionTokenRecord } from '#/schema/action-tokens';

// The address a refused verification link was minted for, which a new link
// proves in its place. Only a verification link names one to prove again.
export function addressToProveAgain(record: ActionTokenRecord | null): string | null {
  return record?.type === 'verify_email' ? record.email : null;
}
