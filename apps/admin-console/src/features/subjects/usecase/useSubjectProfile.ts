import type { Profile } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import {
  saveClaims,
  saveVerification,
  useProfileRecord,
  type ClaimValues,
  type VerificationValues,
} from '#/features/subjects/repository/useSubjectRecord.ts';
import {
  claimFields,
  PROFILE_SECTIONS,
  profileRecord,
  type ClaimField,
  verificationFields,
  type ProfileSection,
} from '#/features/subjects/service.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';

export type { SectionSave };

export function useSubjectProfileRead(tenant: string, id: string): RecordState<Profile> {
  return useProfileRecord(tenant, id);
}

export interface ClaimSection {
  id: string;
  title: string;
  claims: readonly ClaimField[];
  save: SectionSave<ClaimValues>;
}

export interface SubjectClaims {
  sections: readonly ClaimSection[];
  verification: SectionSave<VerificationValues>;
  updatedAt: string | null;
}

function useClaimSection(
  tenant: string,
  id: string,
  profile: Profile,
  etag: string,
  gone: boolean,
  section: ProfileSection,
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
    fields: claimFields(profile, section.claims),
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
  const [name, details, address] = PROFILE_SECTIONS;
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
    fields: verificationFields(profile),
    save: saveVerification(tenant, id),
  });
  return { sections, verification, updatedAt: profile.profile_updated_at };
}
