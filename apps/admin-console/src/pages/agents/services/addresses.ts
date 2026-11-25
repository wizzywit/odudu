import { areaAt, areaHref } from '#/entities/area';

export function agentsHref(tenant: string): string {
  return areaHref(tenant, areaAt('agents'));
}

export function agentApprovalsHref(tenant: string): string {
  return `${agentsHref(tenant)}/approvals`;
}
