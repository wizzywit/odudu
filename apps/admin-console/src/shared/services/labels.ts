import { TENANT_NAME_RULE } from '@odudu/contracts';
import { sentence } from '#/shared/services/format';

export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

export const NAME_TAKEN = 'That name is taken';

export const TENANT_NAME_RULE_TEXT = sentence(TENANT_NAME_RULE);
