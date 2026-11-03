import { SUBJECT_CAPABILITY_FILTER } from '@odudu/contracts/admin';

// `any` is the server's own value, the holders of at least one capability.
export const CAPABILITY_FILTER = [
  { id: 'all', label: 'Holding anything or nothing' },
  ...SUBJECT_CAPABILITY_FILTER.map((capability) => ({
    id: capability,
    label: capability === 'any' ? 'Any capability' : capability,
  })),
];
