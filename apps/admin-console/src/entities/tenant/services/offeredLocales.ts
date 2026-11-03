function isTag(value: unknown): value is string {
  return typeof value === 'string';
}

// The tenant's supported languages out of its settings record, which the
// contract types loosely.
export function offeredLocales(settings: Readonly<Record<string, unknown>>): string[] {
  const supported = settings.supported_locales;
  return Array.isArray(supported) ? supported.filter(isTag) : [];
}
