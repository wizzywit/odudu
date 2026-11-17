// Why a required-action page is shown again: the code a catalogue entry is
// looked up by, never a sentence.
export type EnrolmentRefusal =
  'code_mismatch' | 'codes_not_saved' | 'passkey_not_added' | 'passkey_not_discoverable';
