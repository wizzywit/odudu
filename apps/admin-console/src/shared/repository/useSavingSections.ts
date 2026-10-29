import { create } from 'zustand';
import { anySaving, savingToggled } from '#/shared/service/savingSections';

interface SavingSections {
  saving: ReadonlySet<string>;
  // A section tells when it starts to save and when it stops.
  report: (key: string, now: boolean) => void;
}

export const useSavingSections = create<SavingSections>()((set, get) => ({
  saving: new Set(),
  report: (key, now) => {
    const next = savingToggled(get().saving, key, now);
    if (next !== null) set({ saving: next });
  },
}));

// Whether any section of a record is saving, wherever on the page it sits.
export function useRecordSaving(tenant: string, record: string): boolean {
  return useSavingSections((state) => anySaving(state.saving, tenant, record));
}
