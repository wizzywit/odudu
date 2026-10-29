import type { ReactNode } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import {
  BRANDING_DESCRIPTION,
  BRANDING_NOUN,
  BRANDING_SECTIONS_LABEL,
  BRANDING_TAB_LABELS,
  BRANDING_TITLE,
  OFFERED_TABS,
  type OfferedTab,
} from '#/features/branding/service';
import { useBrandingPage } from '#/features/branding/usecase/useBrandingPage';
import { LanguagesTab } from '#/features/branding/view/LanguagesTab';
import { MailInherits, MailPreview } from '#/features/branding/view/MailTab';
import { PublicationBar } from '#/features/branding/view/PublicationBar';
import { PagesPanel, ThemePanel } from '#/features/branding/view/ScopePanels';
import { Workspace } from '#/features/branding/view/Workspace';
import { RecordPage } from '#/shared/view/RecordPage';

function Branding({ tenant }: { tenant: string }) {
  const page = useBrandingPage(tenant);
  const { branding, mail } = page;
  const { view, tag } = branding;
  const panels: Readonly<Record<OfferedTab, ReactNode>> | null =
    view === undefined || tag === null
      ? null
      : {
          theme: <ThemePanel tenant={tenant} branding={branding} view={view} tag={tag} />,
          pages: <PagesPanel tenant={tenant} branding={branding} view={view} tag={tag} />,
          mail: (
            <Workspace aside={<MailPreview mail={mail} />} editor={<MailInherits mail={mail} />} />
          ),
          languages: <LanguagesTab tenant={tenant} />,
        };
  return (
    <RecordPage
      record={branding.record}
      kicker={tenant}
      title={BRANDING_TITLE}
      description={BRANDING_DESCRIPTION}
      noun={BRANDING_NOUN}
      label={BRANDING_SECTIONS_LABEL}
      banner={
        view === undefined || tag === null ? null : (
          <PublicationBar tenant={tenant} branding={branding} view={view} tag={tag} />
        )
      }
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={OFFERED_TABS.map((tab) => ({
        id: tab,
        label: BRANDING_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        changed: branding.changed.has(tab),
        panel: panels === null ? null : panels[tab],
      }))}
    />
  );
}

export function BrandingPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('branding')} title={BRANDING_TITLE}>
      <Branding tenant={tenant} />
    </AreaGate>
  );
}
