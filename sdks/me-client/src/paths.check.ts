import type { paths } from '#/index';

type ReadProfile = paths['/tenants/{tenant}/me/profile']['get'];

export const profileTenant: ReadProfile['parameters']['path']['tenant'] = 'acme';
export const profileName: ReadProfile['responses'][200]['content']['application/json']['name'] =
  null;
