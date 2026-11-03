import { FULL_SCOPE_LABEL } from '#/pages/clients/services/idTokenPolicy';

export const SECTIONS_ADVANCED = {
  auth: 'Client authentication',
  keys: 'Client keys',
  userinfo: 'UserInfo response',
  audiences: 'Audiences',
  exchange: 'Token exchange',
  secret: 'Client secret',
  fixed: 'Fixed by design',
} as const;

export const SECTIONS_TOKENS = {
  lifetimes: 'Token lifetimes',
  grants: 'Grant types',
  credentials: 'Client credentials',
  fullScope: 'Roles in tokens',
  idToken: 'ID token',
} as const;

export const TOKEN_FIELD = {
  credentials: 'Client credentials scopes',
  fullScope: FULL_SCOPE_LABEL,
  grants: 'Grant types',
} as const;

export const SECTIONS_LOGOUT = {
  postLogout: 'After sign-out',
  confirmation: 'Sign-out confirmation',
  backchannel: 'Back-channel logout',
  frontchannel: 'Front-channel logout',
} as const;
