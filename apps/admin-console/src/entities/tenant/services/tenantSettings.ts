// The record key a tenant's settings are cached under. One ETag covers every
// setting, so each page that saves some of them reads and writes this key,
// and a save on one page rebases the sections of the others.
export const TENANT_SETTINGS_RECORD = 'settings';
