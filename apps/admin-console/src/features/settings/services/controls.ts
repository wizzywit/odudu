import type { SettingOption, SettingsSection } from '#/features/settings/services/sections';
import { fieldDescription } from '#/features/settings/services/notes';
import {
  booleanOf,
  listOf,
  numberOf,
  textOf,
  type SettingValue,
} from '#/features/settings/services/values';
import { numberKept } from '#/shared/services/numbers';

interface Shared {
  name: string;
  label: string;
  description: string | undefined;
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
    | { control: 'text'; value: string }
    | { control: 'number'; value: number; unit: string }
    | { control: 'choice'; value: string; options: readonly SettingOption[] }
    | {
        control: 'set';
        value: readonly string[];
        options: readonly { id: string; label: string; unavailable?: string }[];
      }
  );

// What a section's save reads of the controls it draws.
interface Edited {
  values: Readonly<Record<string, SettingValue>>;
  fieldErrors: Readonly<Partial<Record<string, string>>>;
  changed: readonly string[];
}

export function controlViews(
  section: SettingsSection,
  save: Edited,
  fixed: Readonly<Record<string, string>>,
): readonly ControlView[] {
  return section.fields.map((field): ControlView => {
    const why = fixed[field.name];
    const shared: Shared = {
      name: field.name,
      label: field.label,
      description: why ?? fieldDescription(field),
      error: save.fieldErrors[field.name],
      changed: save.changed.includes(field.name),
      isDisabled: why !== undefined,
      cell: {},
    };
    const value = save.values[field.name];
    switch (field.control) {
      case 'toggle':
        return { ...shared, control: 'toggle', value: booleanOf(value) };
      case 'text':
        return { ...shared, cell: { span: 'wide' }, control: 'text', value: textOf(value) };
      case 'seconds':
        return { ...shared, control: 'number', value: numberOf(value), unit: 'seconds' };
      case 'count':
        return { ...shared, control: 'number', value: numberOf(value), unit: field.unit ?? '' };
      case 'choice':
        return {
          ...shared,
          cell: { span: 'wide' },
          control: 'choice',
          value: textOf(value),
          options: field.options ?? [],
        };
      case 'set':
        return {
          ...shared,
          cell: { span: 'full' },
          control: 'set',
          value: listOf(value),
          options: (field.options ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.fixed === undefined ? {} : { unavailable: option.fixed }),
          })),
        };
    }
  });
}

// A number field cleared reads NaN, and the value then stays as it was.
export function editedValue(was: SettingValue | undefined, next: SettingValue): SettingValue {
  return typeof next === 'number' ? numberKept(next, numberOf(was)) : next;
}
