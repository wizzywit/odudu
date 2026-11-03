import { areaTitled, type Area } from '#/entities/area';

export function auditArea(): { area: Area; title: string } {
  return areaTitled('audit');
}
