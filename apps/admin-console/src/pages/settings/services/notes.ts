import { ASSISTANT_SETTING_RANGES, TENANT_SETTING_RANGES } from '@odudu/contracts/admin';
import { formatSpan } from '#/shared/lib/services/format';
import { rangeSentence } from '#/shared/lib/services/numbers';
import type { SettingField } from '#/pages/settings/services/sections';

export interface SettingRange {
  min: number;
  max: number | undefined;
}

// The range the server holds the setting to, as it reports it in a refusal.
export function settingRange(field: SettingField): SettingRange | null {
  const ranges: Readonly<Partial<Record<string, { min: number; max?: number }>>> = {
    ...TENANT_SETTING_RANGES,
    ...ASSISTANT_SETTING_RANGES,
  };
  const range = Object.hasOwn(ranges, field.name) ? ranges[field.name] : undefined;
  return range === undefined ? null : { min: range.min, max: range.max };
}

function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

export function rangeRule(field: SettingField): string | null {
  const range = settingRange(field);
  if (range === null) return null;
  const seconds = field.control === 'seconds';
  const unit = field.control === 'count' && field.unit !== undefined ? ` ${field.unit}` : '';
  // A token limit runs to a billion, which is read in groups of three.
  const show = seconds ? formatSpan : field.unit === 'tokens' ? grouped : String;
  return rangeSentence(range.min, range.max, show, unit);
}

export function fieldDescription(field: SettingField): string | undefined {
  const rule = rangeRule(field);
  const parts = [field.description, rule].filter(
    (part): part is string => part !== undefined && part !== null,
  );
  return parts.length === 0 ? undefined : parts.join(' ');
}
