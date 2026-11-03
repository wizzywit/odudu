import { spaced } from '#/shared/lib/services/format';

export interface PickerWording {
  // Said, with another try, when the list could not be read.
  failed: string;
  // A field's description while the list is being read.
  whileLoading: (description: string) => string;
}

export function pickerWording(loading: string, failed: string): PickerWording {
  return { failed, whileLoading: (description) => spaced(description, loading) };
}
