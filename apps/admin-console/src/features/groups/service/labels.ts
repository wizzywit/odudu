// ADR 0039: a token's groups claim carries the path, which the name is part of.
export const NAME_FIXED =
  "A group's name is fixed once it is made: the groups claim carries its path, and a relying party that matches on it would otherwise pass or fail by a token's age.";

export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

export const PLACE_LABEL = 'Place in the tree';

export const DEFAULT_LABEL = 'Joined by every new subject';

export const NAME_TAKEN = 'That name is taken there';
