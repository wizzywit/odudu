import { TENANT_SETTING_RANGES } from '@odudu/contracts/admin';
import { formatDuration } from '#/shared/services/format';
import { rangeSentence } from '#/shared/services/numbers';
import type { SettingField } from '#/features/settings/services/sections';

// The range the server holds the setting to, as it reports it in a refusal.
export function rangeRule(field: SettingField): string | null {
  const range = TENANT_SETTING_RANGES[field.name];
  if (range === undefined) return null;
  if (field.control === 'seconds') return rangeSentence(range.min, range.max, formatDuration);
  return rangeSentence(
    range.min,
    range.max,
    String,
    field.unit === undefined ? '' : ` ${field.unit}`,
  );
}

export function fieldDescription(field: SettingField): string | undefined {
  const rule = rangeRule(field);
  const parts = [field.description, rule].filter(
    (part): part is string => part !== undefined && part !== null,
  );
  return parts.length === 0 ? undefined : parts.join(' ');
}
