import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SignedInContext } from '#/entities/session';
import { useTenantSettingsRead } from '#/entities/tenant';
import { SETTINGS_SECTIONS, type SettingsSection } from '#/pages/settings/services/sections';
import type { useSettingsSection } from '#/pages/settings/use-cases/useSettingsSection';
import { hookHarness } from '#/testing/hookHarness';
import { settingsRoutes } from '#/testing/settingsFixtures';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

type SectionInput = Parameters<typeof useSettingsSection>[0];

function sectionOf(id: string): SettingsSection {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (found === undefined) throw new Error(`no section ${id}`);
  return found;
}

// acme's settings read, and a hook that takes one section of them, its data
// and its ETag as its input, mounted once the read has answered.
export function settingsHarness(extra: Parameters<typeof settingsRoutes>[1] = {}) {
  const harness = hookHarness(settingsRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return {
    ...harness,
    render: <T,>(use: (input: SectionInput) => T, id: string) =>
      renderHook(
        () => {
          const read = useTenantSettingsRead('acme');
          const input: SectionInput = {
            tenant: 'acme',
            section: sectionOf(id),
            data: read.data ?? {},
            etag: read.etag ?? '',
            gone: read.gone,
          };
          return { ready: read.status === 'ready', used: use(input) };
        },
        { wrapper },
      ),
  };
}
