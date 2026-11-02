import { resourceAddress } from '#/shared/services/address';

const scopes = resourceAddress({ segment: 'scopes', group: 'Applications', label: 'Scopes' });

export const {
  listHref: scopesHref,
  newHref: newScopeHref,
  recordHref: scopeHref,
  trail: scopesTrail,
} = scopes;
