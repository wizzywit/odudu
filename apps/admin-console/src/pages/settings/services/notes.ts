import { TENANT_SETTING_RANGES } from '@odudu/contracts/admin';
import { formatSpan } from '#/shared/lib/services/format';
import { rangeSentence } from '#/shared/lib/services/numbers';
import type { SettingField } from '#/pages/settings/services/sections';

export interface SettingRange {
  min: number;
  max: number | undefined;
}

// The range the server holds the setting to, as it reports it in a refusal.
export function settingRange(field: SettingField): SettingRange | null {
  const range = Object.hasOwn(TENANT_SETTING_RANGES, field.name)
    ? TENANT_SETTING_RANGES[field.name]
    : undefined;
  return range === undefined ? null : { min: range.min, max: range.max };
}

export function rangeRule(field: SettingField): string | null {
  const range = settingRange(field);
  if (range === null) return null;
  const seconds = field.control === 'seconds';
  const unit = field.control === 'count' && field.unit !== undefined ? ` ${field.unit}` : '';
  return rangeSentence(range.min, range.max, seconds ? formatSpan : String, unit);
}

export function fieldDescription(field: SettingField): string | undefined {
  const rule = rangeRule(field);
  const parts = [field.description, rule].filter(
    (part): part is string => part !== undefined && part !== null,
  );
  return parts.length === 0 ? undefined : parts.join(' ');
}
