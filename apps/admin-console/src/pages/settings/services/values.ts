import { formatDuration, listOrNone } from '#/shared/lib/services/format';
import type { SettingField } from '#/pages/settings/services/sections';

export type SettingValue = boolean | number | string | readonly string[];

export interface SettingEntry {
  name: string;
  label: string;
  value: SettingValue;
  describe: (value: unknown) => string;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isList(value: SettingValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

export function settingValue(
  field: SettingField,
  settings: Readonly<Record<string, unknown>>,
): SettingValue {
  const value = settings[field.name];
  switch (field.control) {
    case 'toggle':
      return value === true;
    case 'text':
      return isText(value) ? value : '';
    case 'choice':
      if (field.numeric === true) return typeof value === 'number' ? String(value) : '';
      return isText(value) ? value : '';
    case 'set':
      return Array.isArray(value) ? value.filter(isText) : [];
    case 'seconds':
    case 'count':
      return typeof value === 'number' ? value : Number.NaN;
  }
}

export function describeSetting(field: SettingField): (value: unknown) => string {
  return (value) => {
    switch (field.control) {
      case 'toggle':
        return value === true ? 'on' : 'off';
      case 'seconds':
        return typeof value === 'number' ? formatDuration(value) : 'unset';
      case 'count':
        return typeof value === 'number' ? `${String(value)} ${field.unit ?? ''}`.trim() : 'unset';
      case 'text':
        return isText(value) && value !== '' ? value : 'none';
      case 'choice':
        return field.options?.find((option) => option.id === String(value))?.label ?? String(value);
      case 'set': {
        const chosen = Array.isArray(value) ? value : [];
        const labels = (field.options ?? [])
          .filter((option) => chosen.includes(option.id))
          .map((option) => option.label);
        return listOrNone(labels, { join: 'comma' });
      }
    }
  };
}

export function settingEntries(
  fields: readonly SettingField[],
  settings: Readonly<Record<string, unknown>>,
): readonly SettingEntry[] {
  return fields.map((field) => ({
    name: field.name,
    label: field.label,
    value: settingValue(field, settings),
    describe: describeSetting(field),
  }));
}

export function settingsRequest(
  changes: Readonly<Partial<Record<string, SettingValue>>>,
): Record<string, boolean | number | string | string[]> {
  const request: Record<string, boolean | number | string | string[]> = {};
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined || (typeof value === 'number' && Number.isNaN(value))) continue;
    request[name] = isList(value) ? [...value] : value;
  }
  return request;
}

export function booleanOf(value: SettingValue | undefined): boolean {
  return value === true;
}

export function numberOf(value: SettingValue | undefined): number {
  return typeof value === 'number' ? value : Number.NaN;
}

export function textOf(value: SettingValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function listOf(value: SettingValue | undefined): readonly string[] {
  return isList(value) ? value : [];
}
