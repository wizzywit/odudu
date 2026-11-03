export interface ActivityWords {
  loading: string;
  failed: string;
  refusedNoun: string;
  emptyTitle: string;
  emptyText: string;
  note: string;
  tableLabel: string;
  pagerLabel: string;
  moreFailedNoun: string;
}

// `noun` is what the record is: "client".
export function activityWords(noun: string): ActivityWords {
  return {
    loading: 'Loading activity',
    failed: 'Activity could not be loaded',
    refusedNoun: 'Activity',
    emptyTitle: `No activity on this ${noun} yet`,
    emptyText: 'Every change made to it, and every change refused, is listed here.',
    note:
      'A correlation id links rows written for one request. The caller can set it, so it is a ' +
      'correlation, not evidence.',
    tableLabel: `Activity on this ${noun}`,
    pagerLabel: 'Activity',
    moreFailedNoun: 'activity',
  };
}
