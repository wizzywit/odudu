import { TENANT_SETTING_RANGES } from '@odudu/contracts/admin';
import { formatSpan } from '#/shared/lib/services/format';
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

function bound(field: SettingField, value: number): string {
  return field.control === 'seconds' ? formatSpan(value) : String(value);
}

export function rangeRule(field: SettingField): string | null {
  const range = settingRange(field);
  if (range === null) return null;
  const unit = field.control === 'count' && field.unit !== undefined ? ` ${field.unit}` : '';
  return range.max === undefined
    ? `Allowed: at least ${bound(field, range.min)}${unit}.`
    : `Allowed: ${bound(field, range.min)} to ${bound(field, range.max)}${unit}.`;
}

export function fieldDescription(field: SettingField): string | undefined {
  const rule = rangeRule(field);
  const parts = [field.description, rule].filter(
    (part): part is string => part !== undefined && part !== null,
  );
  return parts.length === 0 ? undefined : parts.join(' ');
}
