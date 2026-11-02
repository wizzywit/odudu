export type SettingControl = 'toggle' | 'text' | 'seconds' | 'count' | 'choice' | 'set';

export interface SettingOption {
  id: string;
  label: string;
  description?: string;
  // Why it cannot be left out, when it cannot.
  fixed?: string;
}

export interface SettingField {
  name: string;
  label: string;
  control: SettingControl;
  // What the setting does, before the range the server holds it to.
  description?: string;
  // The unit a `count` is in.
  unit?: string;
  options?: readonly SettingOption[];
}

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  fields: readonly SettingField[];
}
