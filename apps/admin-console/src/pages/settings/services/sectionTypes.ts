export type SettingControl = 'toggle' | 'text' | 'url' | 'seconds' | 'count' | 'choice' | 'set';

export interface SettingOption {
  id: string;
  label: string;
  description?: string;
  // Why it cannot be left out, when it cannot.
  fixed?: string;
  // The heading a set of options is listed under.
  group?: string;
}

// A field that means something only while another holds a value.
export interface SettingDependency {
  on: string;
  value: string;
  // Said in place of the description while the other holds another value.
  otherwise: string;
}

export interface SettingField {
  name: string;
  label: string;
  control: SettingControl;
  // What the setting does, before the range the server holds it to.
  description?: string;
  // The rest of what it does, folded away until asked for.
  more?: string;
  // The unit a `count` is in.
  unit?: string;
  options?: readonly SettingOption[];
  // A choice whose values are numbers on the server, spelled as text here.
  numeric?: true;
  // A text that is a word or a number rather than a line, so it does not take a wide cell.
  short?: true;
  // The titled group of the section it is laid out in.
  group?: string;
  dependsOn?: SettingDependency;
}

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  fields: readonly SettingField[];
}
