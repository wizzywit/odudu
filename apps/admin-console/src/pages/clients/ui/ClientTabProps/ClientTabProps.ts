import type { ClientRecordRead } from '#/pages/clients/use-cases/useClientSection';

// What every tab of a client's record is given: the record as it was read,
// and whether the page offers any change to it.
export type ClientTabProps = ClientRecordRead & { writable: boolean };
