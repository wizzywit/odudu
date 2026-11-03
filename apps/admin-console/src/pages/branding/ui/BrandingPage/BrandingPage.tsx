import {
  BRANDING_DESCRIPTION,
  BRANDING_NOUN,
  BRANDING_SECTIONS_LABEL,
  BRANDING_TAB_LABELS,
  OFFERED_TABS,
  type OfferedTab,
  PagesPanel,
  PublicationBar,
  ThemePanel,
  Workspace,
} from '#/features/branding-editor';
import type { ReactNode } from 'react';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useBrandingPage } from '#/pages/branding/use-cases/useBrandingPage';
import { LanguagesTab } from '#/pages/branding/ui/LanguagesTab';
import { MailInherits, MailPreview } from '#/pages/branding/ui/MailTab';
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
