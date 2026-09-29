import type { Profile } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session/index.ts';
import {
  profileRecord,
  saveClaims,
  saveVerification,
  useProfileRecord,
  type ClaimValues,
  type VerificationValues,
} from '#/features/subjects/repository/useSubjectRecord.ts';
import {
  ADDRESS_CLAIMS,
  DETAIL_CLAIMS,
  NAME_CLAIMS,
  type ClaimField,
} from '#/features/subjects/service.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';

export type { SectionSave };

export function useSubjectProfileRead(tenant: string, id: string): RecordState<Profile> {
  return useProfileRecord(tenant, id);
}

export interface ClaimSection {
  readonly id: string;
  readonly title: string;
  readonly claims: readonly ClaimField[];
  readonly save: SectionSave<ClaimValues>;
}

export interface SubjectClaims {
  readonly sections: readonly ClaimSection[];
  readonly verification: SectionSave<VerificationValues>;
  readonly updatedAt: string | null;
}

const SECTIONS = [
  { id: 'name', title: 'Name', claims: NAME_CLAIMS },
  { id: 'details', title: 'Details', claims: DETAIL_CLAIMS },
  { id: 'address', title: 'Address', claims: ADDRESS_CLAIMS },
] as const;

function useClaimSection(
  tenant: string,
  id: string,
  profile: Profile,
  etag: string,
  gone: boolean,
  section: (typeof SECTIONS)[number],
): ClaimSection {
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: profileRecord(id),
    section: section.id,
    label: section.title,
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    fields: Object.fromEntries(
      section.claims.map((claim) => [
        claim.id,
        { value: profile[claim.id] ?? '', label: claim.label, kind: 'plain' as const },
      ]),
    ),
    save: saveClaims(tenant, id),
  });
  return { ...section, save };
}

// Every section saves to the profile's own ETag, and each save's answer
// replaces the profile, so the others rebase on it.
export function useSubjectClaims(
  tenant: string,
  id: string,
  profile: Profile,
  etag: string,
  gone: boolean,
): SubjectClaims {
  const refusal = useRefusal(tenant);
  const [name, details, address] = SECTIONS;
  const sections = [
    useClaimSection(tenant, id, profile, etag, gone, name),
    useClaimSection(tenant, id, profile, etag, gone, details),
    useClaimSection(tenant, id, profile, etag, gone, address),
  ];
  const verification = useSectionSave({
    tenant,
    record: profileRecord(id),
    section: 'verification',
    label: 'Verification',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    fields: {
      email_verified: {
        value: profile.email_verified,
        label: 'Email verified',
        kind: 'plain',
        describe: (value) => (value === true ? 'verified' : 'not verified'),
      },
      phone_number_verified: {
        value: profile.phone_number_verified,
        label: 'Phone number verified',
        kind: 'plain',
        describe: (value) => (value === true ? 'verified' : 'not verified'),
      },
    },
    save: saveVerification(tenant, id),
  });
  return { sections, verification, updatedAt: profile.profile_updated_at };
}
