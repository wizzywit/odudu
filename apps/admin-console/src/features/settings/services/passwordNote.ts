import { passwordConformance } from '@odudu/contracts/admin';

export interface PasswordNote {
  // Present for advice worth acting on; absent for plain reassurance.
  tone?: 'warning';
  text: string;
}

// A hint beside the minimum length. It never blocks a save: the server
// accepts any length in its range.
export function passwordNote(minLength: number, otpRequired: unknown): PasswordNote | null {
  if (!Number.isFinite(minLength)) return null;
  switch (passwordConformance(minLength, otpRequired === true)) {
    case 'needs_second_factor':
      return {
        tone: 'warning',
        text: 'A minimum under 15 is only safe when every sign-in needs a second factor. Raise it, or ask every subject for a one-time password in Sign-in flow.',
      };
    case 'conforms_with_second_factor':
      return {
        text: 'Every sign-in needs a second factor, so this minimum is enough.',
      };
    case 'conforms':
      return null;
  }
}
