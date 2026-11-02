// ADR 0039: a token's roles claim carries the name.
export const NAME_FIXED =
  "A role's name is fixed once it is made: tokens carry it in their roles claim, and a relying party that matches on it would otherwise pass or fail by a token's age. A tenant role can be copied under another name instead.";

export const DEFAULT_LABEL = 'Given to every new subject';

export const ADD_LABEL = 'Add a composite';

export const NEST_LABEL = 'Role to nest';
