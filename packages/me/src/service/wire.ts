import type {
  MeConsent,
  MeCredential,
  MeCredentialsResponse,
  MeProfile,
  MeSession,
  MeSessionEnded,
  MeSessionsEnded,
} from '@odudu/contracts/me';
import type { UserRecord } from '@odudu/domain-identity';
import type { SubjectConsent } from '@odudu/domain-tenant';
import type { CredentialView } from '#/service/credential-view';
import type { SessionView } from '#/service/session-view';

export interface Listed<Wire> {
  readonly items: Wire[];
  readonly next_cursor: string | null;
}

export function profileDto(user: UserRecord): MeProfile {
  return {
    sub: user.subjectId,
    username: user.username,
    email: user.email,
    email_verified: user.emailVerified,
    name: user.name,
    given_name: user.givenName,
    family_name: user.familyName,
    middle_name: user.middleName,
    nickname: user.nickname,
    preferred_username: user.preferredUsername,
    profile: user.profile,
    picture: user.picture,
    website: user.website,
    gender: user.gender,
    birthdate: user.birthdate,
    zoneinfo: user.zoneinfo,
    locale: user.locale,
    phone_number: user.phoneNumber,
    phone_number_verified: user.phoneNumberVerified,
    address_formatted: user.addressFormatted,
    address_street: user.addressStreet,
    address_locality: user.addressLocality,
    address_region: user.addressRegion,
    address_postal_code: user.addressPostalCode,
    address_country: user.addressCountry,
    profile_updated_at: user.profileUpdatedAt?.toISOString() ?? null,
  };
}

export function credentialDto(view: CredentialView): MeCredential {
  return {
    id: view.id,
    type: view.type,
    label: view.label,
    created_at: view.createdAt.toISOString(),
    last_used_at: view.lastUsedAt?.toISOString() ?? null,
  };
}

export function credentialsDto(
  views: readonly CredentialView[],
  next: string | null,
  recoveryCodesLeft: number,
): MeCredentialsResponse {
  return {
    items: views.map(credentialDto),
    next_cursor: next,
    recovery_codes_left: recoveryCodesLeft,
  };
}

function sessionDto(view: SessionView): MeSession {
  return {
    id: view.id,
    created_at: view.createdAt.toISOString(),
    last_active_at: view.lastActiveAt.toISOString(),
    expires_at: view.expiresAt.toISOString(),
    remembered: view.remembered,
    current: view.current,
    device: view.device,
  };
}

export function sessionsDto(views: readonly SessionView[], next: string | null): Listed<MeSession> {
  return { items: views.map(sessionDto), next_cursor: next };
}

function consentDto(consent: SubjectConsent): MeConsent {
  return {
    client_id: consent.clientKey,
    scope_names: [...consent.scopeNames],
    granted_at: consent.grantedAt.toISOString(),
  };
}

export function consentsDto(
  consents: readonly SubjectConsent[],
  next: string | null,
): Listed<MeConsent> {
  return { items: consents.map(consentDto), next_cursor: next };
}

export function sessionEndedDto(currentSessionEnded: boolean): MeSessionEnded {
  return { current_session_ended: currentSessionEnded };
}

export function sessionsEndedDto(ended: number, more: boolean): MeSessionsEnded {
  return { ended, more };
}
