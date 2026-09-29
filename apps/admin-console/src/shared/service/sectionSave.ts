// `conflict` and `stale` both follow a 412: `conflict` while a field edited
// here was changed there too, `stale` when the edits sit on the fresh read
// untouched and only need saving again.
export type SaveStatus =
  'idle' | 'saving' | 'saved' | 'invalid' | 'conflict' | 'stale' | 'refused' | 'failed';

// `changed`: another administrator saved these fields. `kept`: edits kept
// across a sign-in meet a record that has moved on, and what changed in
// between cannot be known.
export type ConflictSource = 'changed' | 'kept';

export const BLOCKED_BY_CONFLICT = 'Keep yours or take theirs before saving.';
