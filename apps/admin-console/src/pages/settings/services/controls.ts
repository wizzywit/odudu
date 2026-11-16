import type {
  SettingField,
  SettingOption,
  SettingsSection,
} from '#/pages/settings/services/sections';
import { fieldDescription, rangeRule, settingRange } from '#/pages/settings/services/notes';
import {
  booleanOf,
  listOf,
  numberOf,
  textOf,
  type SettingValue,
} from '#/pages/settings/services/values';
import { numberKept } from '#/shared/lib/services/numbers';

interface Shared {
  name: string;
  label: string;
  description: string | undefined;
  // What the description leaves for a person who asks.
  more: string | undefined;
  // The titled group it is laid out in, if the section has them.
  group: string | undefined;
  error: string | undefined;
  changed: boolean;
  // Present for a setting that is fixed, with the reason as its description.
  isDisabled: boolean;
  // The cell a wide control takes in the grid of its section.
  cell: { span?: 'wide' | 'full' };
}

export type ControlView = Shared &
  (
    | { control: 'toggle'; value: boolean }
    | { control: 'text' | 'url'; value: string }
    | {
        control: 'number';
        value: number;
        unit: string;
        // Seconds are entered in the unit that suits them.
        picker: boolean;
        min: number | undefined;
        max: number | undefined;
        rangeMessage: string | undefined;
      }
    | { control: 'choice'; value: string; options: readonly SettingOption[] }
    | {
        control: 'set';
        value: readonly string[];
        options: readonly { id: string; label: string; group?: string; unavailable?: string }[];
      }
  );

// What a section's save reads of the controls it draws.
interface Edited {
  values: Readonly<Record<string, SettingValue>>;
  fieldErrors: Readonly<Partial<Record<string, string>>>;
  changed: readonly string[];
}

// Short options sit three to a row; long ones take two columns.
const SHORT_OPTIONS = 5;
const SHORT_LABEL = 12;

function cellOf(field: SettingField): Shared['cell'] {
  switch (field.control) {
    case 'text':
      return field.short === true ? {} : { span: 'wide' };
    case 'url':
      return { span: 'wide' };
    case 'set':
      return { span: 'full' };
    case 'choice': {
      const options = field.options ?? [];
      const short =
        options.length <= SHORT_OPTIONS && options.every((each) => each.label.length < SHORT_LABEL);
      return short ? {} : { span: 'wide' };
    }
    default:
      return {};
  }
}

// Why a field cannot be edited at present: its own tenant state holds it, or
// the setting it depends on holds another value.
export function dependencyReason(
  field: SettingField,
  values: Readonly<Record<string, SettingValue>>,
): string | undefined {
  const needs = field.dependsOn;
  return needs === undefined || textOf(values[needs.on]) === needs.value
    ? undefined
    : needs.otherwise;
}

export function controlViews(
  section: SettingsSection,
  save: Edited,
  fixed: Readonly<Record<string, string>>,
): readonly ControlView[] {
  return section.fields.map((field): ControlView => {
    const why = fixed[field.name] ?? dependencyReason(field, save.values);
    const shared: Shared = {
      name: field.name,
      label: field.label,
      description: why ?? fieldDescription(field),
      more: why === undefined ? field.more : undefined,
      group: field.group,
      error: save.fieldErrors[field.name],
      changed: save.changed.includes(field.name),
      isDisabled: why !== undefined,
      cell: cellOf(field),
    };
    const value = save.values[field.name];
    switch (field.control) {
      case 'toggle':
        return { ...shared, control: 'toggle', value: booleanOf(value) };
      case 'text':
      case 'url':
        return { ...shared, control: field.control, value: textOf(value) };
      case 'seconds':
      case 'count': {
        const range = settingRange(field);
        return {
          ...shared,
          control: 'number',
          value: numberOf(value),
          unit: field.control === 'seconds' ? 'seconds' : (field.unit ?? ''),
          picker: field.control === 'seconds',
          min: range?.min,
          max: range?.max,
          rangeMessage: rangeRule(field) ?? undefined,
        };
      }
      case 'choice':
        return {
          ...shared,
          control: 'choice',
          value: textOf(value),
          options: field.options ?? [],
        };
      case 'set':
        return {
          ...shared,
          control: 'set',
          value: listOf(value),
          options: (field.options ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.group === undefined ? {} : { group: option.group }),
            ...(option.fixed === undefined ? {} : { unavailable: option.fixed }),
          })),
        };
    }
  });
}

export interface ControlGroup {
  title: string | undefined;
  controls: readonly ControlView[];
}

// Neighbouring controls of one group, in the order the section lists them.
export function controlGroups(controls: readonly ControlView[]): readonly ControlGroup[] {
  const groups: { title: string | undefined; controls: ControlView[] }[] = [];
  for (const control of controls) {
    const last = groups.at(-1);
    if (last !== undefined && last.title === control.group) last.controls.push(control);
    else groups.push({ title: control.group, controls: [control] });
  }
  return groups;
}

// A number field cleared reads NaN, and the value then stays as it was.
export function editedValue(was: SettingValue | undefined, next: SettingValue): SettingValue {
  return typeof next === 'number' ? numberKept(next, numberOf(was)) : next;
}
