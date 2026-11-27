import { areaAt, areaHref } from '#/entities/area';

export function activityHref(tenant: string): string {
  return areaHref(tenant, areaAt('assistant-activity'));
}

export function replayHref(tenant: string, id: string): string {
  return `${activityHref(tenant)}/${encodeURIComponent(id)}`;
}
