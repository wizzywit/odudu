import type { ReactNode } from 'react';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import {
  BRANDING_DESCRIPTION,
  BRANDING_NOUN,
  BRANDING_SECTIONS_LABEL,
} from '#/features/branding/services/brandingArea';
import {
  BRANDING_TAB_LABELS,
  OFFERED_TABS,
  type OfferedTab,
} from '#/features/branding/services/tabs';
import { useBrandingPage } from '#/features/branding/use-cases/useBrandingPage';
import { LanguagesTab } from '#/features/branding/ui/LanguagesTab';
import { MailInherits, MailPreview } from '#/features/branding/ui/MailTab';
import { PublicationBar } from '#/features/branding/ui/PublicationBar';
import { PagesPanel, ThemePanel } from '#/features/branding/ui/ScopePanels';
import { Workspace } from '#/features/branding/ui/Workspace';
import { RecordPage } from '#/shared/ui/RecordPage';
import { TouchTargets } from '#/shared/ui/TouchTargets';

const AREA = areaAt('branding');

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
    <TouchTargets>
      <RecordPage
        record={branding.record}
        kicker={tenant}
        title={AREA.label}
        description={BRANDING_DESCRIPTION}
        noun={BRANDING_NOUN}
        label={BRANDING_SECTIONS_LABEL}
        banner={
          view === undefined || tag === null ? null : (
            <PublicationBar
              tenant={tenant}
              branding={branding}
              view={view}
              tag={tag}
              tab={page.tab}
            />
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
    </TouchTargets>
  );
}

export function BrandingPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <Branding tenant={tenant} />
    </AreaGate>
  );
}
