export const FLOWS_RECORD = 'flows';

export function flowRecordName(id: string): string {
  return `${FLOWS_RECORD}/${id}`;
}
