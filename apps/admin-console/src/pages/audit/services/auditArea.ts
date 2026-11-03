import { areaAt, type Area } from '#/entities/area';

export function auditArea(): { area: Area; title: string } {
  const area = areaAt('audit');
  return { area, title: area.label };
}
