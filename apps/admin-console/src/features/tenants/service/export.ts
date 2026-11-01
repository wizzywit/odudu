import { utf8Length } from '#/shared/service/format';
import { lacking } from '#/shared/service/access';
import { type AdminCapability, type Authority } from '#/shared/service/principal';
import type { GatewayFailure } from '#/shared/service/result';
import { omittedOf } from '#/features/tenants/service/document';

// The UTC day, so one export taken twice in an evening is named the same
// wherever the person is.
export function exportFileName(tenant: string, now: Date): string {
  return `${tenant}-${now.toISOString().slice(0, 10)}.odudu-tenant.json`;
}

export interface Exported {
  fileName: string;
  bytes: number;
  omitted: readonly string[];
}

export function exportedOf(fileName: string, text: string): Exported {
  return { fileName, bytes: utf8Length(text), omitted: omittedOf(text) };
}

const EXPORT_NEEDS: readonly AdminCapability[] = ['manage-tenant', 'manage-clients'];

export function exportNeeds(authority: Authority | undefined): {
  needs: readonly AdminCapability[];
  subjectsNeed: AdminCapability | null;
} {
  return {
    needs: lacking(authority, EXPORT_NEEDS),
    subjectsNeed: lacking(authority, ['view-users'])[0] ?? null,
  };
}

// Subjects are asked for only while whoami does not rule them out.
export function exportsSubjects(include: boolean, subjectsNeed: AdminCapability | null): boolean {
  return include && subjectsNeed === null;
}

// The capability a refused export is blamed on: the last one it asked for.
export function exportBlame(withSubjects: boolean): AdminCapability {
  return withSubjects ? 'view-users' : 'manage-clients';
}

export function exportFailureText(
  failure: GatewayFailure,
  withSubjects: boolean,
  refused: boolean,
): string {
  if (refused) {
    return `The export needs manage-tenant and manage-clients${withSubjects ? ', and view-users with subjects' : ''}.`;
  }
  if (failure.kind === 'problem') return failure.problem.detail ?? failure.problem.title;
  return 'The export could not be read. Nothing was saved; try again.';
}

export function savedText(fileName: string): string {
  return `Saved ${fileName}.`;
}
