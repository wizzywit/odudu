export type CredentialType = 'password' | 'totp' | 'webauthn' | 'recovery-code';

export interface Credential {
  // A recovery-code entry names no single row, so it carries none.
  id?: string | undefined;
  type: CredentialType;
  createdAt: string;
  expired?: boolean | undefined;
  recoveryCodeCount?: number | undefined;
}
