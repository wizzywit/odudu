import { signInToLabel } from '#/entities/session';
import {
  continueAsLabel,
  enteredTenant,
  signInAgainLabel,
  signInLabel,
} from '#/widgets/session-gate/services/signInText';

export function useSignInText() {
  return { signInLabel, signInToLabel, enteredTenant, signInAgainLabel, continueAsLabel };
}
