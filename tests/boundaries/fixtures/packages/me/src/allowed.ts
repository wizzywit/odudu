import { identity } from '../../domain-identity/src/thing.js';
import { thing as tenant } from '../../domain-tenant/src/thing.js';
import { thing as oidc } from '../../protocol-oidc/src/thing.js';

export const allowed = [identity, tenant, oidc];
