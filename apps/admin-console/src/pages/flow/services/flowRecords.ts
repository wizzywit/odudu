import type { Settings } from '#/entities/tenant';

export interface OtpRead {
  data: Settings;
  etag: string;
  gone: boolean;
}

// What the one-time password section needs of the settings read, or nothing
// while they are not read.
export function otpRead(settings: {
  data: Settings | undefined;
  etag: string | null;
  gone: boolean;
}): OtpRead | null {
  if (settings.data === undefined || settings.etag === null) return null;
  return { data: settings.data, etag: settings.etag, gone: settings.gone };
}

export function settingsFailed(status: string): boolean {
  return status === 'failed';
}
