import { andList } from '#/shared/services/format';

// The sentence that holds an action back while sections have unsaved edits.
// `action` is what the person may do first: only save, or save or discard
// (discarding the draft leaves the edits alone, so either clears the hold).
export function unsavedBlock(
  sections: readonly string[],
  reason: string,
  action: 'save' | 'save-or-discard' = 'save',
): string {
  const first = action === 'save' ? 'Save' : 'Save or discard';
  return `${first} your changes first, in ${andList(sections.map((title) => `“${title}”`))}: ${reason}.`;
}
