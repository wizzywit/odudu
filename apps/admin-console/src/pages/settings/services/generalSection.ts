// The settings a tenant's own state holds fixed, with why.
export function fixedSettings(disabledWhy: string | null): Readonly<Record<string, string>> {
  return disabledWhy === null ? {} : { enabled: disabledWhy };
}

export interface DisableDialog {
  title: string;
  confirmLabel: string;
  consequence: string;
}

export function disableDialog(tenant: string, consequence: string): DisableDialog {
  return {
    title: `Disable ${tenant}?`,
    confirmLabel: `Disable ${tenant}`,
    consequence,
  };
}
